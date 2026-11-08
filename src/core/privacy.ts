import type { Receipt } from './types';

/**
 * Masks anything that looks like a membership, loyalty or payment card number.
 * Store item codes are at most 7 digits, so runs of 8 or more digits (allowing
 * spaces or dashes inside) are treated as identifiers and replaced with X.
 */
export function scrubText(s: string): string {
  if (!s) return s;
  let out = s;
  // 8+ digit identifiers, possibly grouped like "1234 5678 9012 3456"
  out = out.replace(/\b\d(?:[ -]?\d){7,}\b/g, (m) => m.replace(/\d/g, 'X'));
  // masked cards that still show the last digits: XXXX1234, ****1234, ending in 1234
  out = out.replace(/([X*•#]{3,}[ -]?)(\d{2,6})\b/gi, (_m, a: string, d: string) => a + 'X'.repeat(d.length));
  out = out.replace(/\b(ending(?: in)?|last ?4|acct|account|card(?: no\.?| number)?)[:#\s]*(\d{4,})\b/gi, (_m, a: string, d: string) => `${a} ${'X'.repeat(d.length)}`);
  // member / membership / loyalty / customer number labels
  out = out.replace(/\b(member(?:ship)?|loyalty|customer|rewards?)(\s*(?:no\.?|number|#|id)?\s*[:#]?\s*)(\d{4,})\b/gi, (_m, a: string, b: string, d: string) => a + b + 'X'.repeat(d.length));
  return out;
}

/** Returns a copy of the receipt with identifiers masked in every free-text field. */
export function scrubReceipt<T extends Receipt>(r: T): T {
  return {
    ...r,
    store: scrubText(r.store),
    location: r.location ? scrubText(r.location) : r.location,
    items: r.items.map((i) => ({ ...i, raw: scrubText(i.raw), name: scrubText(i.name) })),
    tenders: r.tenders.map((t) => ({ ...t, label: scrubText(t.label) })),
    flags: r.flags.map(scrubText),
  };
}
