import { categorize, readableName } from './categorize';
import { detectPack, lookup, packByStoreName, type StorePack } from './packs';
import { scrubReceipt } from './privacy';
import { withReconciliation } from './reconcile';
import { isCategory, round2, type Category, type ParseSource, type Receipt, type ReceiptItem, type Tender, type TenderKind } from './types';

/** A line as read off the receipt, before discounts are folded into their items. */
export interface DraftLine {
  raw: string;
  code?: string | null;
  qty?: number | null;
  unitPrice?: number | null;
  total: number;
  kind: 'item' | 'discount' | 'fee';
  /** For discounts: the item code (or printed text) the discount belongs to. */
  ref?: string | null;
  name?: string | null;
  category?: string | null;
}

export interface DraftTender {
  label: string;
  amount: number;
  kind?: string | null;
}

export interface DraftReceipt {
  store?: string | null;
  location?: string | null;
  date?: string | null;
  time?: string | null;
  kind?: string | null;
  currency?: string | null;
  lines: DraftLine[];
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  instantSavings?: number | null;
  tenders?: DraftTender[];
}

export interface NormalizeOptions {
  source: ParseSource;
  /** Raw OCR/PDF text, used only to detect the store. Never stored. */
  text?: string;
  now?: Date;
}

/** Models occasionally return nested arrays as JSON strings or wrap the object; undo that. */
export function coerceDraft(input: unknown): DraftReceipt {
  let d = input as Record<string, unknown>;
  if (typeof d === 'string') d = (safeParse(d) as Record<string, unknown>) ?? {};
  if (d && typeof d === 'object' && !('lines' in d) && typeof d.receipt === 'object') d = d.receipt as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? (safeParse(v) as unknown[]) ?? [] : []);
  return { ...(d as object), lines: arr(d?.lines) as DraftLine[], tenders: arr(d?.tenders) as DraftTender[] } as DraftReceipt;
}

function safeParse(s: string): Record<string, unknown> | unknown[] | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function normalize(input: DraftReceipt, opts: NormalizeOptions): Receipt {
  const d = coerceDraft(input);
  const flags: string[] = [];
  const pack: StorePack | null = packByStoreName(d.store ?? undefined) ?? (opts.text ? detectPack(opts.text) : null);
  const store = cleanStore(d.store) || pack?.storeName || 'Unknown store';
  const date = normDate(d.date);
  if (!date) flags.push('Date not found. Please set it.');

  const items: ReceiptItem[] = [];
  const orphanDiscounts: DraftLine[] = [];
  for (const l of d.lines ?? []) {
    const total = num(l.total);
    if (total === null) continue;
    if (l.kind === 'discount') {
      const target = findTarget(items, l.ref ?? null);
      if (target) {
        // A discount line printed as "5.00-" is -5 on a purchase; it reduces the item.
        target.discount = round2(target.discount - total);
      } else {
        orphanDiscounts.push(l);
      }
      continue;
    }
    const raw = (l.raw ?? '').trim();
    const code = l.code ? String(l.code).replace(/\D/g, '') || undefined : undefined;
    const packHit = lookup(pack, code, raw);
    let category: Category;
    let name: string;
    if (l.kind === 'fee') {
      category = 'Fees & Deposits';
      name = packHit?.name ?? (l.name?.trim() || readableName(raw));
    } else if (packHit) {
      category = packHit.category;
      name = packHit.name;
    } else {
      category = isCategory(l.category) ? l.category : categorize(`${l.name ?? ''} ${raw}`);
      name = l.name?.trim() || readableName(raw);
    }
    let qty = num(l.qty) ?? 1;
    if (qty <= 0) qty = 1;
    let unitPrice = num(l.unitPrice) ?? round2(total / qty);
    if (Math.abs(round2(qty * unitPrice) - total) > 0.02) {
      // keep the printed line total as the source of truth
      unitPrice = round2(total / qty);
    }
    items.push({ raw, code, name, category, qty, unitPrice, lineTotal: round2(total), discount: 0 });
  }
  // A discount always shrinks its line: same sign as the line (positive on purchases, negative on refunds).
  for (const it of items) {
    if (it.discount !== 0 && Math.sign(it.discount) !== Math.sign(it.lineTotal)) it.discount = round2(-it.discount);
  }
  for (const o of orphanDiscounts) {
    // Discount with no matching item: keep it as its own negative line so totals still add up.
    items.push({ raw: o.raw || 'Discount', name: 'Discount', category: 'Other', qty: 1, unitPrice: round2(o.total), lineTotal: round2(o.total), discount: 0 });
  }

  const itemsNet = round2(items.reduce((a, i) => a + i.lineTotal - i.discount, 0));
  const tax = num(d.tax) ?? 0;
  let total = num(d.total);
  if (total === null) {
    total = round2(itemsNet + tax);
    flags.push('Total not found; using items plus tax.');
  }
  const kindRaw = (d.kind ?? '').toLowerCase();
  const kind = kindRaw.includes('return') || kindRaw.includes('refund') || total < 0 ? 'return' : 'purchase';

  const tenders: Tender[] = (d.tenders ?? [])
    .filter((t) => t && num(t.amount) !== null && t.label)
    .map((t) => ({ label: t.label.trim(), amount: num(t.amount) as number, kind: tenderKind(t.label, t.kind ?? undefined) }));

  const now = (opts.now ?? new Date()).toISOString();
  const r: Receipt = {
    id: makeId(store, date, total),
    store,
    location: d.location?.trim() || undefined,
    date: date ?? now.slice(0, 10),
    time: normTime(d.time),
    kind,
    currency: (d.currency || 'CAD').toUpperCase().slice(0, 3),
    items,
    subtotal: num(d.subtotal),
    tax,
    total,
    instantSavings: Math.abs(num(d.instantSavings) ?? round2(items.reduce((a, i) => a + Math.max(0, i.discount), 0))),
    tenders,
    source: opts.source,
    flags,
    reconciled: false,
    createdAt: now,
  };
  return withReconciliation(scrubReceipt(r));
}

function findTarget(items: ReceiptItem[], ref: string | null): ReceiptItem | undefined {
  if (!items.length) return undefined;
  if (ref) {
    const r = String(ref).replace(/^TPD\s*\/?\s*/i, '').replace(/^\/\s*/, '').trim();
    const digits = r.replace(/\D/g, '');
    for (let i = items.length - 1; i >= 0; i--) {
      if (digits && items[i].code === digits) return items[i];
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (r && items[i].raw.toUpperCase() === r.toUpperCase()) return items[i];
    }
  }
  return items[items.length - 1];
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null;
  const s = String(v).trim();
  const neg = /^-|-$|^\(.*\)$/.test(s);
  const m = s.replace(/[^\d.,]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '');
  if (!m) return null;
  const n = parseFloat(m);
  return Number.isFinite(n) ? round2(neg ? -n : n) : null;
}

export function normDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2];
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    // North American receipts are month/day; swap only when the first part cannot be a month.
    if (a > 12 && b <= 12) [a, b] = [b, a];
    return iso(y, a, b);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function normTime(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i);
  if (!m) return undefined;
  let h = +m[1];
  if (m[3]) {
    const pm = m[3].toLowerCase().startsWith('p');
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return h > 23 ? undefined : `${String(h).padStart(2, '0')}:${m[2]}`;
}

function cleanStore(s: string | null | undefined): string {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  if (/costco/i.test(t)) return 'Costco';
  return t.length > 40 ? t.slice(0, 40) : t;
}

export function tenderKind(label: string, hint?: string): TenderKind {
  const h = (hint ?? '').toLowerCase();
  if (['card', 'cash', 'reward', 'gift', 'other'].includes(h)) return h as TenderKind;
  const l = label.toLowerCase();
  if (/rebate|reward|points|cash ?back|2%/.test(l)) return 'reward';
  if (/gift|certificate|voucher/.test(l)) return 'gift';
  if (/cash/.test(l)) return 'cash';
  if (/visa|master|amex|debit|credit|card|interac|apple pay|google pay/.test(l)) return 'card';
  return 'other';
}

function makeId(store: string, date: string | null, total: number): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${(store || 'store').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 16)}-${date ?? 'nodate'}-${Math.round(Math.abs(total) * 100)}-${rnd}`;
}
