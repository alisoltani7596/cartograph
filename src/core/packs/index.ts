import type { Category } from '../types';
import { COSTCO_ITEMS } from './costco-items';

/**
 * A store pack teaches Cartograph one store's receipts: how to recognise them,
 * what its cryptic item codes mean, and hints for the vision model.
 * See README "Adding a store pack".
 */
export interface StorePack {
  id: string;
  /** Display name of the store as it should appear in the dashboard. */
  storeName: string;
  /** True when OCR text or a parsed store name belongs to this store. */
  detect: (text: string) => boolean;
  /** Item code -> [printed text, readable name, category]. */
  items: Record<string, [string, string, Category]>;
  /** Extra rules applied to printed text before the generic categorizer. */
  rules?: [RegExp, string | null, Category][];
  /** Extra instructions appended to the vision prompt when this store is likely. */
  promptHints: string;
}

export const COSTCO_PACK: StorePack = {
  id: 'costco',
  storeName: 'Costco',
  detect: (t) => /\bcostco\b|\bwholesale\b[\s\S]*\bwhse\b|\bkirkland signature\b/i.test(t),
  items: COSTCO_ITEMS,
  rules: [
    [/^(DEPOSIT|DEP)\b/i, 'Container deposit', 'Fees & Deposits'],
    [/^(ENVIRO|ECO) ?FEE\b/i, 'Environmental fee', 'Fees & Deposits'],
    [/\bEX(EC)? ?(GS|GOLD STAR)? ?S\/U\b|\bMEMBERSHIP\b/i, 'Executive membership upgrade', 'Membership'],
    [/^KS\b/i, null, 'Other'],
  ],
  promptHints: [
    'This looks like a Costco warehouse receipt.',
    'Item lines are: item number, abbreviated description, price, then a one-character tax flag (like N, B, 2) that is NOT part of the price and NOT a quantity. "7.99 2" means one item at 7.99.',
    'An optional leading "E" means an exempt item; ignore it.',
    'Instant savings appear as their own line whose description is "/ <item number>" (sometimes "TPD/<item number>") with an amount ending in "-". These are discounts on the item number after the slash: output them as kind "discount" with ref set to that item number.',
    'DEPOSIT and ENVIRO FEE / ECO FEE lines are kind "fee".',
    'A line like "2 @ 6.99" belongs to the item line next to it: set qty 2 and unit price 6.99 on that item.',
    'On a refund receipt the item amounts are printed with a trailing "-"; report them as negative, and a discount reversal printed without "-" as positive.',
    '"KS" means Kirkland Signature, "B/S" boneless skinless, "ORG" organic.',
  ].join(' '),
};

export const PACKS: StorePack[] = [COSTCO_PACK];

export function detectPack(text: string): StorePack | null {
  return PACKS.find((p) => p.detect(text)) ?? null;
}

export function packByStoreName(store: string | undefined): StorePack | null {
  if (!store) return null;
  return PACKS.find((p) => p.storeName.toLowerCase() === store.toLowerCase() || p.detect(store)) ?? null;
}

/** Looks an item up in a pack, by code first, then by its printed text. */
export function lookup(pack: StorePack | null, code: string | undefined, raw: string): { name: string; category: Category } | null {
  if (!pack) return null;
  if (code && pack.items[code]) {
    const [, name, category] = pack.items[code];
    return { name, category };
  }
  const key = norm(raw);
  if (key) {
    for (const [, [printed, name, category]] of Object.entries(pack.items)) {
      if (printed && norm(printed) === key) return { name, category };
    }
  }
  for (const [re, name, category] of pack.rules ?? []) {
    if (re.test(raw) && name) return { name, category };
  }
  return null;
}

function norm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9/%.]+/g, ' ').trim();
}
