import type { Receipt, ReceiptItem } from '../../src/core/types';

export interface TruthReceipt {
  id: string;
  date: string;
  kind: 'purchase' | 'return';
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number;
  total: number;
  split?: 'dev' | 'test';
}

export interface ReceiptScore {
  id: string;
  gtItems: number;
  predItems: number;
  tp: number;
  priceWrong: number;
  discountOk: number;
  discountGt: number;
  categoryOk: number;
  subtotalOk: boolean;
  taxOk: boolean;
  totalOk: boolean;
  dateOk: boolean;
  kindOk: boolean;
  reconciled: boolean;
  perfect: boolean;
  costUsd: number;
  ms: number;
  error?: string;
}

const eq = (a: number | null | undefined, b: number | null | undefined) => a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) < 0.005;

function tokens(s: string): Set<string> {
  return new Set(s.toUpperCase().replace(/[^A-Z0-9%]+/g, ' ').split(' ').filter((t) => t.length > 1));
}
function sim(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / Math.max(A.size, B.size);
}

/** Matches predicted lines to truth lines. A true positive needs the right line amount and the right item (code or text). */
export function scoreReceipt(pred: Receipt | null, gt: TruthReceipt, costUsd = 0, ms = 0, error?: string): ReceiptScore {
  const s: ReceiptScore = {
    id: gt.id, gtItems: gt.items.length, predItems: pred?.items.length ?? 0, tp: 0, priceWrong: 0, discountOk: 0,
    discountGt: gt.items.filter((i) => Math.abs(i.discount) > 0.004).length, categoryOk: 0,
    subtotalOk: false, taxOk: false, totalOk: false, dateOk: false, kindOk: false, reconciled: false, perfect: false, costUsd, ms, error,
  };
  if (!pred) return s;
  const used = new Set<number>();
  const pairs: [ReceiptItem, ReceiptItem][] = [];
  const passes: ((g: ReceiptItem, p: ReceiptItem) => boolean)[] = [
    (g, p) => !!g.code && g.code === p.code && eq(g.lineTotal, p.lineTotal),
    (g, p) => eq(g.lineTotal, p.lineTotal) && sim(g.raw, p.raw) >= 0.5,
  ];
  const remaining = new Set(gt.items.map((_, i) => i));
  for (const pass of passes) {
    for (const gi of [...remaining]) {
      const g = gt.items[gi];
      const pi = pred.items.findIndex((p, j) => !used.has(j) && pass(g, p));
      if (pi >= 0) {
        used.add(pi);
        remaining.delete(gi);
        pairs.push([g, pred.items[pi]]);
      }
    }
  }
  // right item, wrong amount (counts against recall and precision, tracked separately)
  for (const gi of remaining) {
    const g = gt.items[gi];
    const pi = pred.items.findIndex((p, j) => !used.has(j) && ((!!g.code && g.code === p.code) || sim(g.raw, p.raw) >= 0.8));
    if (pi >= 0) {
      used.add(pi);
      s.priceWrong++;
    }
  }
  s.tp = pairs.length;
  for (const [g, p] of pairs) {
    if (Math.abs(g.discount) > 0.004 && eq(g.discount, p.discount)) s.discountOk++;
    if (g.category === p.category) s.categoryOk++;
  }
  const spurious = pairs.some(([g, p]) => Math.abs(g.discount) <= 0.004 && Math.abs(p.discount) > 0.004);
  s.subtotalOk = gt.subtotal === null ? true : eq(gt.subtotal, pred.subtotal);
  s.taxOk = eq(gt.tax, pred.tax);
  s.totalOk = eq(gt.total, pred.total);
  s.dateOk = gt.date === pred.date;
  s.kindOk = gt.kind === pred.kind;
  s.reconciled = pred.reconciled;
  s.perfect = s.tp === s.gtItems && s.predItems === s.gtItems && s.discountOk === s.discountGt && !spurious && s.subtotalOk && s.taxOk && s.totalOk && s.dateOk;
  return s;
}

export interface Aggregate {
  receipts: number;
  errors: number;
  itemPrecision: number;
  itemRecall: number;
  itemF1: number;
  discountAccuracy: number;
  categoryAgreement: number;
  subtotalAccuracy: number;
  taxAccuracy: number;
  totalAccuracy: number;
  dateAccuracy: number;
  reconciliationPassRate: number;
  perfectRate: number;
  /** Of receipts with any error, the share that reconciliation flagged. */
  errorsCaughtByReconciliation: number | null;
  /** Of receipts that passed reconciliation, the share that were actually perfect. */
  passedAndPerfect: number | null;
  meanCostUsd: number;
  totalCostUsd: number;
  meanSeconds: number;
  medianSeconds: number;
}

export function aggregate(scores: ReceiptScore[]): Aggregate {
  const n = scores.length || 1;
  const sum = (f: (s: ReceiptScore) => number) => scores.reduce((a, s) => a + f(s), 0);
  const tp = sum((s) => s.tp), gt = sum((s) => s.gtItems), pr = sum((s) => s.predItems);
  const P = pr ? tp / pr : 0, R = gt ? tp / gt : 0;
  const pct = (f: (s: ReceiptScore) => boolean) => scores.filter(f).length / n;
  const imperfect = scores.filter((s) => !s.perfect);
  const passed = scores.filter((s) => s.reconciled);
  const secs = scores.map((s) => s.ms / 1000).sort((a, b) => a - b);
  return {
    receipts: scores.length,
    errors: scores.filter((s) => s.error).length,
    itemPrecision: P,
    itemRecall: R,
    itemF1: P + R ? (2 * P * R) / (P + R) : 0,
    discountAccuracy: sum((s) => s.discountGt) ? sum((s) => s.discountOk) / sum((s) => s.discountGt) : 1,
    categoryAgreement: tp ? sum((s) => s.categoryOk) / tp : 0,
    subtotalAccuracy: pct((s) => s.subtotalOk),
    taxAccuracy: pct((s) => s.taxOk),
    totalAccuracy: pct((s) => s.totalOk),
    dateAccuracy: pct((s) => s.dateOk),
    reconciliationPassRate: pct((s) => s.reconciled),
    perfectRate: pct((s) => s.perfect),
    errorsCaughtByReconciliation: imperfect.length ? imperfect.filter((s) => !s.reconciled).length / imperfect.length : null,
    passedAndPerfect: passed.length ? passed.filter((s) => s.perfect).length / passed.length : null,
    meanCostUsd: sum((s) => s.costUsd) / n,
    totalCostUsd: sum((s) => s.costUsd),
    meanSeconds: sum((s) => s.ms) / 1000 / n,
    medianSeconds: secs.length ? secs[Math.floor(secs.length / 2)] : 0,
  };
}

export function formatAggregate(a: Aggregate): string {
  const p = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  return [
    `receipts ${a.receipts} (errors ${a.errors})`,
    `items  P ${p(a.itemPrecision)}  R ${p(a.itemRecall)}  F1 ${p(a.itemF1)}`,
    `discounts ${p(a.discountAccuracy)}  categories ${p(a.categoryAgreement)}`,
    `subtotal ${p(a.subtotalAccuracy)}  tax ${p(a.taxAccuracy)}  total ${p(a.totalAccuracy)}  date ${p(a.dateAccuracy)}`,
    `reconciliation pass ${p(a.reconciliationPassRate)}  perfect ${p(a.perfectRate)}  errors caught ${p(a.errorsCaughtByReconciliation)}  passed&perfect ${p(a.passedAndPerfect)}`,
    `cost/receipt $${a.meanCostUsd.toFixed(4)} (total $${a.totalCostUsd.toFixed(3)})  time mean ${a.meanSeconds.toFixed(1)}s median ${a.medianSeconds.toFixed(1)}s`,
  ].join('\n');
}
