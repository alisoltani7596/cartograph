/**
 * Evaluation harness.
 *
 *   tsx eval/run.ts --dataset <dir> --method claude|ocr [--split dev|test|all]
 *                   [--variant clean|photo] [--model claude-haiku-5-5] [--limit N] [--out file.json] [--check]
 *
 * A dataset folder holds truth/<id>.json and images/<variant>/<id>.png|jpg.
 * The public synthetic set lives in eval/synthetic. The private set of real
 * receipts is kept outside the repository and is never committed.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { parseWithClaude, MODELS, type ModelId } from '../src/core/claude';
import { COSTCO_PACK } from '../src/core/packs';
import { parseReceiptText } from '../src/core/textParser';
import type { Receipt } from '../src/core/types';
import { aggregate, formatAggregate, scoreReceipt, type ReceiptScore, type TruthReceipt } from './lib/metrics';
import { imageToParts, ocrReady } from './lib/images-node';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true');
}
const dataset = args.get('dataset') ?? 'eval/synthetic';
const method = (args.get('method') ?? 'ocr') as 'claude' | 'ocr';
const split = args.get('split') ?? 'all';
const variant = args.get('variant') ?? 'clean';
const model = (args.get('model') ?? 'claude-haiku-5-5') as ModelId;
const limit = args.has('limit') ? Number(args.get('limit')) : Infinity;
const concurrency = Number(args.get('concurrency') ?? (method === 'claude' ? 4 : 2));
const out = args.get('out');
if (method === 'claude' && !MODELS[model]) throw new Error(`Unknown model ${model}`);

const truths: TruthReceipt[] = readdirSync(join(dataset, 'truth'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dataset, 'truth', f), 'utf8')))
  .filter((t: TruthReceipt) => split === 'all' || t.split === split)
  .slice(0, limit);

// Avoid leakage: when --pack-from dev is set, the store pack only knows item codes seen in dev receipts,
// so test-set names and categories have to come from the parser itself.
if (args.get('pack-from') === 'dev') {
  const devCodes = new Set<string>();
  for (const f of readdirSync(join(dataset, 'truth')).filter((x) => x.endsWith('.json'))) {
    const t: TruthReceipt = JSON.parse(readFileSync(join(dataset, 'truth', f), 'utf8'));
    if (t.split === 'dev') for (const i of t.items) if (i.code) devCodes.add(i.code);
  }
  for (const code of Object.keys(COSTCO_PACK.items)) if (!devCodes.has(code)) delete COSTCO_PACK.items[code];
  console.log(`pack restricted to ${Object.keys(COSTCO_PACK.items).length} dev codes`);
}

function imagePath(id: string): string {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const p = join(dataset, 'images', variant, `${id}.${ext}`);
    if (existsSync(p)) return p;
  }
  throw new Error(`No ${variant} image for ${id}`);
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (method === 'claude' && !apiKey) throw new Error('Set ANTHROPIC_API_KEY to evaluate the Claude parser.');
  type OcrWorker = { recognize: (img: Buffer) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };
  let worker: OcrWorker | null = null;
  if (method === 'ocr') {
    const req = createRequire(import.meta.url);
    const { createWorker } = await import('tesseract.js');
    const eng = req('@tesseract.js-data/eng');
    worker = (await createWorker('eng', 1, { langPath: eng.langPath, gzip: true, cacheMethod: 'none' })) as unknown as OcrWorker;
  }
  const scores: ReceiptScore[] = [];
  const preds: Record<string, Receipt | null> = {};
  let next = 0;
  const workers = Array.from({ length: method === 'ocr' ? 1 : concurrency }, async () => {
    while (next < truths.length) {
      const t = truths[next++];
      const t0 = Date.now();
      try {
        let r: Receipt;
        let cost = 0;
        if (method === 'claude') {
          const parts = await imageToParts(imagePath(t.id));
          const res = await parseWithClaude(parts, { apiKey, model, fileName: t.id });
          r = res.receipt;
          cost = res.costUsd;
        } else {
          const { data } = await worker!.recognize(await ocrReady(imagePath(t.id)));
          r = parseReceiptText(data.text, { method: 'ocr' });
        }
        preds[t.id] = r;
        scores.push(scoreReceipt(r, t, cost, Date.now() - t0));
      } catch (e) {
        preds[t.id] = null;
        scores.push(scoreReceipt(null, t, 0, Date.now() - t0, String(e)));
        console.error(t.id, String(e).slice(0, 200));
      }
      process.stdout.write('.');
    }
  });
  await Promise.all(workers);
  if (worker) await worker.terminate();
  process.stdout.write('\n');
  scores.sort((a, b) => a.id.localeCompare(b.id));
  const agg = aggregate(scores);
  console.log(`\n${dataset} | ${method}${method === 'claude' ? ` ${model}` : ''} | split ${split} | ${variant}`);
  console.log(formatAggregate(agg));
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ config: { dataset, method, model: method === 'claude' ? model : null, split, variant, date: new Date().toISOString() }, aggregate: agg, scores, preds }, null, 1));
  }
  if (args.has('check')) {
    // CI gate for the public synthetic set (free OCR path).
    const fails: string[] = [];
    if (agg.itemF1 < 0.9) fails.push(`item F1 ${agg.itemF1.toFixed(3)} < 0.90`);
    if (agg.totalAccuracy < 0.9) fails.push(`total accuracy ${agg.totalAccuracy.toFixed(3)} < 0.90`);
    if (agg.reconciliationPassRate < 0.8) fails.push(`reconciliation ${agg.reconciliationPassRate.toFixed(3)} < 0.80`);
    if (fails.length) {
      console.error('Eval check failed: ' + fails.join('; '));
      process.exit(1);
    }
    console.log('Eval check passed.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
