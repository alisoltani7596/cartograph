import sharp from 'sharp';
import { planTiles, rowInkProfile } from '../../src/core/tiling';
import type { ImagePart } from '../../src/core/claude';

/** Same tiling as the browser (src/ui/images.ts), implemented with sharp for Node. */
export async function imageToParts(path: string): Promise<ImagePart[]> {
  const img = sharp(path).rotate();
  const meta = await img.metadata();
  const W = meta.width!, H = meta.height!;
  const gray = await sharp(path).rotate().greyscale().raw().toBuffer();
  const rowInk = rowInkProfile(gray, W, H);
  const plan = planTiles(W, H, (y) => rowInk[Math.min(H - 1, Math.max(0, y))]);
  const w = Math.round(W * plan.scale);
  const scaled = await sharp(path).rotate().resize({ width: w }).toBuffer();
  const parts: ImagePart[] = [];
  for (const [y0, y1] of plan.tiles) {
    const buf = await sharp(scaled).extract({ left: 0, top: y0, width: w, height: Math.max(1, y1 - y0) }).jpeg({ quality: 88 }).toBuffer();
    parts.push({ kind: 'image', mediaType: 'image/jpeg', base64: buf.toString('base64') });
  }
  return parts;
}

/** Light clean-up that helps OCR on photos: grayscale and contrast stretch. */
export async function ocrReady(path: string): Promise<Buffer> {
  return sharp(path).rotate().greyscale().normalise().png().toBuffer();
}
