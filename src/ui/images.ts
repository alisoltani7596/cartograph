import { planTiles, rowInkProfile } from '../core/tiling';
import type { ImagePart, ReceiptPart } from '../core/claude';

export const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function isPdf(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

function grayOf(c: HTMLCanvasElement): Uint8Array {
  const { width: W, height: H } = c;
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const g = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return g;
}

/** Same tiling as eval/lib/images-node.ts: cut tall receipts on blank rows. */
export function canvasToParts(src: HTMLCanvasElement): ImagePart[] {
  // profile on a reduced copy for speed
  const probeW = Math.min(src.width, 800);
  const k = probeW / src.width;
  const probe = document.createElement('canvas');
  probe.width = probeW;
  probe.height = Math.max(1, Math.round(src.height * k));
  probe.getContext('2d')!.drawImage(src, 0, 0, probe.width, probe.height);
  const ink = rowInkProfile(grayOf(probe), probe.width, probe.height);
  const plan = planTiles(src.width, src.height, (y) => ink[Math.min(probe.height - 1, Math.max(0, Math.round(y * k)))]);
  const w = Math.round(src.width * plan.scale);
  const parts: ImagePart[] = [];
  for (const [y0, y1] of plan.tiles) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.max(1, y1 - y0);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, y0 / plan.scale, src.width, (y1 - y0) / plan.scale, 0, 0, w, y1 - y0);
    parts.push({ kind: 'image', mediaType: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.88).split(',')[1] });
  }
  return parts;
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** What gets sent to Claude: PDFs go as documents, images are tiled. */
export async function fileToClaudeParts(file: File): Promise<ReceiptPart[]> {
  if (isPdf(file)) {
    if (file.size > 9.5 * 1024 * 1024) throw new Error('PDF is larger than 9.5 MB.');
    return [{ kind: 'pdf', base64: await blobToBase64(file) }];
  }
  return canvasToParts(await fileToCanvas(file));
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import('pdfjs-dist');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      lib.GlobalWorkerOptions.workerSrc = worker;
      return lib;
    })();
  }
  return pdfjsPromise;
}

/** Text from a PDF's text layer (e-receipts), grouped into lines by position. */
export async function pdfText(file: File): Promise<{ text: string; pages: HTMLCanvasElement[] }> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  const pages: HTMLCanvasElement[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 6); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      (rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: it.transform[4], s: it.str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) lines.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join(' '));
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c } as never).promise;
    pages.push(c);
  }
  return { text: lines.join('\n'), pages };
}

/** Grayscale + contrast stretch, which helps OCR on photos. */
function ocrReady(c: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.min(1, 1600 / c.width);
  const out = document.createElement('canvas');
  out.width = Math.round(c.width * scale);
  out.height = Math.round(c.height * scale);
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, out.width, out.height);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  let lo = 255, hi = 0;
  const g = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    if (j % 7 === 0) {
      lo = Math.min(lo, g[j]);
      hi = Math.max(hi, g[j]);
    }
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = ((g[j] - lo) * 255) / span;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Free path: PDF text layer if there is one, otherwise in-browser OCR. */
export async function fileToText(file: File, onProgress?: (p: number) => void): Promise<string> {
  const { recognize } = await import('./ocr');
  if (isPdf(file)) {
    const { text, pages } = await pdfText(file);
    if (text.replace(/\s/g, '').length > 40) return text;
    const parts: string[] = [];
    for (const pg of pages) parts.push(await recognize(ocrReady(pg), onProgress));
    return parts.join('\n');
  }
  return recognize(ocrReady(await fileToCanvas(file)), onProgress);
}
