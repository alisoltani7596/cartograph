import { createWorker, type Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;
let progressCb: ((p: number) => void) | undefined;

/** Tesseract runs in a Web Worker, loaded from this site (public/ocr), not a CDN. */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;
    workerPromise = createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base,
      gzip: true,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') progressCb?.(m.progress);
      },
    });
  }
  return workerPromise;
}

export async function recognize(canvas: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<string> {
  const w = await getWorker();
  progressCb = onProgress;
  const { data } = await w.recognize(canvas);
  progressCb = undefined;
  return data.text;
}
