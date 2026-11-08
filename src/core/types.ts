export const CATEGORIES = [
  'Produce',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Bakery',
  'Pantry',
  'Snacks',
  'Beverages',
  'Frozen',
  'Deli & Prepared',
  'Household',
  'Personal Care',
  'Health',
  'Baby & Pet',
  'Clothing',
  'Home & Garden',
  'Electronics & Toys',
  'Fuel',
  'Fees & Deposits',
  'Membership',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const FOOD_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'Produce',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Bakery',
  'Pantry',
  'Snacks',
  'Beverages',
  'Frozen',
  'Deli & Prepared',
]);

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

/**
 * One printed product line. Amounts follow the receipt's sign: purchases are
 * positive, refunded lines are negative. `discount` is the amount taken off this
 * line by coupons or instant savings (positive on purchases, negative on refunds),
 * so the net amount paid for the line is `lineTotal - discount`.
 */
export interface ReceiptItem {
  raw: string;
  code?: string;
  name: string;
  category: Category;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
}

export type TenderKind = 'card' | 'cash' | 'reward' | 'gift' | 'other';

export interface Tender {
  label: string;
  amount: number;
  kind: TenderKind;
}

export type ReceiptKind = 'purchase' | 'return';
export type ParseMethod = 'claude' | 'ocr' | 'manual' | 'demo' | 'import';

export interface ParseSource {
  method: ParseMethod;
  model?: string;
  fileName?: string;
  costUsd?: number;
  ms?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface Receipt {
  id: string;
  store: string;
  location?: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  /** 24h time, HH:MM */
  time?: string;
  kind: ReceiptKind;
  currency: string;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number;
  total: number;
  /** Sum of instant savings printed on the receipt (informational, already inside item discounts). */
  instantSavings: number;
  tenders: Tender[];
  source: ParseSource;
  /** Problems found during parsing or reconciliation. Empty means clean. */
  flags: string[];
  reconciled: boolean;
  createdAt: string;
  updatedAt?: string;
}

export function netOf(item: Pick<ReceiptItem, 'lineTotal' | 'discount'>): number {
  return round2(item.lineTotal - item.discount);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
