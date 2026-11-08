import { netOf, round2, type Receipt } from './types';

/** Allowed rounding slack, in currency units. */
export const TOLERANCE = 0.02;

export interface Reconciliation {
  ok: boolean;
  itemsNet: number;
  expectedTotal: number;
  diff: number;
  subtotalDiff: number | null;
  issues: string[];
}

/**
 * The receipt adds up when the items (after their discounts) plus tax equal the
 * printed total. Savings are already inside each item's discount, so they are not
 * subtracted twice. A printed subtotal is checked as a second signal.
 */
export function reconcile(r: Pick<Receipt, 'items' | 'tax' | 'total' | 'subtotal'>): Reconciliation {
  const itemsNet = round2(r.items.reduce((a, i) => a + netOf(i), 0));
  const expectedTotal = round2(itemsNet + (r.tax || 0));
  const diff = round2(r.total - expectedTotal);
  const subtotalDiff = r.subtotal === null || r.subtotal === undefined ? null : round2(r.subtotal - itemsNet);
  const issues: string[] = [];
  if (!r.items.length) issues.push('No item lines were found.');
  if (Math.abs(diff) > TOLERANCE) {
    issues.push(`Items plus tax come to ${fmt(expectedTotal)}, but the receipt total is ${fmt(r.total)} (off by ${fmt(diff)}).`);
  }
  if (subtotalDiff !== null && Math.abs(subtotalDiff) > TOLERANCE) {
    issues.push(`Items add up to ${fmt(itemsNet)}, but the printed subtotal is ${fmt(r.subtotal as number)}.`);
  }
  for (const [i, it] of r.items.entries()) {
    if (Math.abs(round2(it.qty * it.unitPrice) - it.lineTotal) > TOLERANCE && it.qty !== 1) {
      issues.push(`Line ${i + 1} (${it.raw || it.name}): ${it.qty} x ${fmt(it.unitPrice)} is not ${fmt(it.lineTotal)}.`);
    }
  }
  return { ok: issues.length === 0, itemsNet, expectedTotal, diff, subtotalDiff, issues };
}

/** Recompute reconciliation and store the result on the receipt. */
export function withReconciliation<T extends Receipt>(r: T): T {
  const rec = reconcile(r);
  const other = r.flags.filter((f) => !f.startsWith('Items ') && !f.startsWith('Line ') && f !== 'No item lines were found.');
  return { ...r, reconciled: rec.ok, flags: [...other, ...rec.issues] };
}

function fmt(n: number): string {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
}
