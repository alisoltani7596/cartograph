import { createStore, del, get, set } from 'idb-keyval';
import { DEFAULT_MODEL, type ModelId } from '../core/claude';
import { scrubReceipt } from '../core/privacy';
import { withReconciliation } from '../core/reconcile';
import { isCategory, type Receipt } from '../core/types';

/**
 * All data lives in this browser's IndexedDB. Nothing is sent to any server
 * except the receipt image itself, and only to Anthropic, and only when the
 * user chooses the Claude parser with their own key.
 */
const db = createStore('cartograph', 'kv');
const RECEIPTS = 'receipts:v1';
const SETTINGS = 'settings:v1';
const KEY = 'anthropic-key';
const SESSION_KEY = 'cartograph.anthropic-key';

export interface Settings {
  model: ModelId;
  rememberKey: boolean;
  method: 'claude' | 'ocr';
}

let cache: Receipt[] | null = null;
const listeners = new Set<() => void>();
export const onChange = (f: () => void) => listeners.add(f);
const emit = () => listeners.forEach((f) => f());

export async function loadReceipts(): Promise<Receipt[]> {
  if (cache) return cache;
  try {
    cache = ((await get(RECEIPTS, db)) as Receipt[] | undefined) ?? [];
  } catch {
    cache = [];
  }
  return cache;
}

async function save(list: Receipt[]): Promise<void> {
  cache = list;
  await set(RECEIPTS, list, db);
  emit();
}

export async function getReceipt(id: string): Promise<Receipt | undefined> {
  return (await loadReceipts()).find((r) => r.id === id);
}

export function findDuplicate(list: Receipt[], r: Receipt): Receipt | undefined {
  return list.find((x) => x.id !== r.id && x.store === r.store && x.date === r.date && Math.abs(x.total - r.total) < 0.005 && x.items.length === r.items.length);
}

export async function addReceipt(r: Receipt): Promise<{ added: boolean; duplicateOf?: Receipt }> {
  const list = await loadReceipts();
  const dup = findDuplicate(list, r);
  if (dup) return { added: false, duplicateOf: dup };
  await save([...list, scrubReceipt(r)]);
  return { added: true };
}

export async function putReceipt(r: Receipt): Promise<void> {
  const list = await loadReceipts();
  const clean = withReconciliation(scrubReceipt({ ...r, updatedAt: new Date().toISOString() }));
  await save(list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? clean : x)) : [...list, clean]);
}

export async function deleteReceipt(id: string): Promise<void> {
  await save((await loadReceipts()).filter((r) => r.id !== id));
}

export async function deleteEverything(): Promise<void> {
  cache = [];
  await del(RECEIPTS, db);
  await del(SETTINGS, db);
  await del(KEY, db);
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('cartograph.theme');
  } catch {
    /* storage may be blocked */
  }
  emit();
}

export async function exportJson(): Promise<string> {
  const receipts = await loadReceipts();
  return JSON.stringify({ app: 'cartograph', version: 1, exportedAt: new Date().toISOString(), receipts }, null, 1);
}

/** Imports a Cartograph export. Validates shape, scrubs identifiers and re-runs reconciliation. */
export async function importJson(text: string): Promise<{ added: number; skipped: number }> {
  const data = JSON.parse(text);
  const incoming: unknown[] = Array.isArray(data) ? data : data?.receipts;
  if (!Array.isArray(incoming)) throw new Error('This file is not a Cartograph export.');
  const list = await loadReceipts();
  let added = 0, skipped = 0;
  const next = [...list];
  for (const x of incoming) {
    const r = x as Receipt;
    if (!r || typeof r !== 'object' || !Array.isArray(r.items) || typeof r.total !== 'number' || typeof r.date !== 'string') {
      skipped++;
      continue;
    }
    const clean = withReconciliation(
      scrubReceipt({
        ...r,
        id: r.id || `import-${Math.random().toString(36).slice(2)}`,
        store: String(r.store ?? 'Unknown store'),
        kind: r.kind === 'return' ? 'return' : 'purchase',
        currency: r.currency ?? 'CAD',
        tax: Number(r.tax) || 0,
        subtotal: r.subtotal ?? null,
        instantSavings: Number(r.instantSavings) || 0,
        tenders: Array.isArray(r.tenders) ? r.tenders : [],
        flags: Array.isArray(r.flags) ? r.flags : [],
        source: r.source ?? { method: 'import' },
        createdAt: r.createdAt ?? new Date().toISOString(),
        items: r.items.map((i) => ({
          raw: String(i.raw ?? ''), code: i.code ? String(i.code) : undefined, name: String(i.name ?? i.raw ?? ''),
          category: isCategory(i.category) ? i.category : 'Other', qty: Number(i.qty) || 1, unitPrice: Number(i.unitPrice) || 0,
          lineTotal: Number(i.lineTotal) || 0, discount: Number(i.discount) || 0,
        })),
      }),
    );
    if (next.some((y) => y.id === clean.id) || findDuplicate(next, clean)) {
      skipped++;
      continue;
    }
    next.push(clean);
    added++;
  }
  await save(next);
  return { added, skipped };
}

export async function getSettings(): Promise<Settings> {
  const s = ((await get(SETTINGS, db).catch(() => undefined)) as Partial<Settings> | undefined) ?? {};
  return { model: s.model ?? DEFAULT_MODEL, rememberKey: s.rememberKey ?? false, method: s.method ?? 'claude' };
}

export async function saveSettings(s: Settings): Promise<void> {
  await set(SETTINGS, s, db);
}

export async function getApiKey(): Promise<string> {
  try {
    const k = sessionStorage.getItem(SESSION_KEY);
    if (k) return k;
  } catch {
    /* ignore */
  }
  return ((await get(KEY, db).catch(() => '')) as string) || '';
}

export async function setApiKey(key: string, remember: boolean): Promise<void> {
  try {
    if (key) sessionStorage.setItem(SESSION_KEY, key);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  if (remember && key) await set(KEY, key, db);
  else await del(KEY, db);
}
