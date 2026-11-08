import { detectPack } from './packs';
import { normalize, num, type DraftLine, type DraftReceipt, type DraftTender } from './normalize';
import type { ParseSource, Receipt } from './types';

/**
 * Rule-based parser for plain receipt text (from in-browser OCR or a text PDF).
 * It understands the Costco warehouse layout well and falls back to a generic
 * "description ... price" layout for other stores. Less accurate than the
 * vision model, but free and fully offline.
 */
export function parseReceiptText(text: string, source: ParseSource = { method: 'ocr' }): Receipt {
  return normalize(textToDraft(text), { source, text });
}

const PRICE = String.raw`(\d{1,4}(?:[.,]\d{3})*[.,]\d{2})`;
const NOT_ITEM = /\b(sub ?total|total|tax|gst|pst|hst|qst|change|amount|approved|visa|master ?card|debit|credit|cash|balance|tender|auth|items? sold|number of items|instant savings|you saved|savings|member|rebate|certificate|gift card|chip read|ref\s?#|terminal|trn|whse|thank|receipt|invoice|loyalty|points)\b/i;

export function cleanLine(s: string): string {
  return s
    .replace(/[|]/g, ' ')
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/(\d)\s*[.,]\s*(\d{2})\b/g, '$1.$2') // "12 .99" -> "12.99"
    .replace(/(\d)[oO](?=\d)/g, '$10')
    .replace(/\$\s+/g, '$')
    .replace(/\s+/g, ' ')
    .trim();
}

export function textToDraft(text: string): DraftReceipt {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const pack = detectPack(text);
  const isWarehouse = pack?.id === 'costco' || lines.filter((l) => /^\d{3,7}\s+\S/.test(l)).length >= 4;
  const draft: DraftReceipt = { store: pack?.storeName ?? guessStore(lines), lines: [], tenders: [] };
  const tenders: DraftTender[] = [];
  let pendingQty: { qty: number; unit: number } | null = null;
  let afterSubtotal = false;
  let afterTotal = false;
  let taxExplicit = false;

  for (const line of lines) {
    const up = line.toUpperCase();
    if (/REFUND|RETURN/.test(up) && !draft.kind) draft.kind = 'return';

    const date = line.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
    if (date && !draft.date) {
      draft.date = date[1];
      const t = line.match(/\b(\d{1,2}:\d{2})\s*([AP]\.?M\.?)?/i);
      if (t) draft.time = t[0];
    }

    // totals block
    let m = up.match(new RegExp(String.raw`^(?:\S{1,8}\s+)?\**\s*SUB\s?-?TOTAL\b[^\d-]*(-?)\$?${PRICE}(-?)`));
    if (m) {
      draft.subtotal = signed(m[2], m[1] || m[3]);
      afterSubtotal = true;
      continue;
    }
    m = up.match(new RegExp(String.raw`^\**\s*(?:TOTAL\s+)?(?:SALES\s+)?(TAX|GST|PST|HST|QST|GST/HST)\b[^\d-]*(?:\d{1,2}(?:\.\d+)?\s*%[^\d-]*)?(-?)\$?${PRICE}(-?)`));
    if (m && !/TOTAL TAX/.test(up)) {
      const v = signed(m[3], m[2] || m[4]) ?? 0;
      if (m[1] === 'TAX') {
        draft.tax = v;
        taxExplicit = true;
      } else if (!taxExplicit) {
        draft.tax = (draft.tax ?? 0) + v;
      }
      continue;
    }
    m = up.match(new RegExp(String.raw`^(?:[^\sA-Z0-9]{1,8}\s+|[A-Z*]{1,8}\s+(?=TOTAL))?\**\s*(?:GRAND\s+)?TOTAL\b(?!\s*(NUMBER|TAX|SAVINGS|ITEMS|DISCOUNT))[^\d-]*(-?)\$?${PRICE}(-?)`));
    if (m && draft.total === undefined) {
      draft.total = signed(m[3], m[2] || m[4]);
      afterTotal = true;
      continue;
    }
    m = up.match(new RegExp(String.raw`(INSTANT SAVINGS|YOU SAVED|TOTAL SAVINGS)[^\d]*\$?${PRICE}`));
    if (m) {
      draft.instantSavings = num(m[2]);
      continue;
    }
    if (afterTotal || afterSubtotal) {
      m = line.match(new RegExp(String.raw`^(.*?(MASTER ?CARD|VISA|AMEX|DEBIT|CREDIT|CASH|REBATE|REWARD|GIFT|CERTIFICATE|INTERAC)[A-Z /%]*?)\s+\$?(-?)${PRICE}(-?)$`, 'i'));
      if (m && !/AMOUNT:/i.test(line)) {
        tenders.push({ label: m[1].trim(), amount: signed(m[4], m[3] || m[5]) as number });
        continue;
      }
    }
    if (afterSubtotal) continue;

    // quantity line: "2 @ 6.99"
    m = line.match(new RegExp(String.raw`^(\d{1,3})\s*@\s*\$?${PRICE}`));
    if (m) {
      const qty = +m[1];
      const unit = num(m[2]) as number;
      const last = draft.lines[draft.lines.length - 1];
      if (last && last.kind === 'item' && Math.abs(Math.abs(last.total) - qty * unit) < 0.03) {
        last.qty = qty;
        last.unitPrice = unit;
      } else {
        pendingQty = { qty, unit };
      }
      continue;
    }

    if (isWarehouse) {
      // discount: "1234567 / 55503 5.00-" or "TPD/55503 5.00-"
      m = line.match(new RegExp(String.raw`^(?:E\s+)?(?:\d{3,8}\s+)?(?:TPD\s*)?[\/\[\(\{\\|]\s*(\d{3,8}|MULTIPLE)?\s*\$?${PRICE}\s*(-?)`, 'i'));
      if (m) {
        const v = num(m[2]) as number;
        const negative = m[3] === '-' || draft.kind !== 'return';
        draft.lines.push({ raw: line, kind: 'discount', ref: m[1] && /\d/.test(m[1]) ? m[1] : null, total: negative ? -Math.abs(v) : Math.abs(v) });
        continue;
      }
      m = line.match(new RegExp(String.raw`^(?:E\s+)?(\d{3,8})\s+(.+?)\s+\$?${PRICE}\s*(-?)\s*([A-Z0-9]{1,2})?$`));
      if (m && !NOT_ITEM.test(m[2])) {
        const v = signed(m[3], m[4]) as number;
        const raw = m[2].trim();
        // OCR sometimes turns the "/" of a discount line into 7, 1 or l: "2121338 74234499 4.00-"
        const ref = raw.replace(/^[/7lI1|[({\\]\s?/, '');
        if (/^[[({\\|]?\d{3,8}$/.test(raw) && (m[4] === '-' || draft.lines.some((x) => x.code && ref.endsWith(x.code)))) {
          const target = draft.lines.slice().reverse().find((x) => x.code && ref.endsWith(x.code));
          draft.lines.push({ raw: line, kind: 'discount', ref: target?.code ?? null, total: draft.kind === 'return' && m[4] !== '-' ? Math.abs(v) : -Math.abs(v) });
          continue;
        }
        const fee = /^(DEPOSIT|ENVIRO|ECO ?FEE)/i.test(raw);
        const l: DraftLine = { raw, code: m[1], total: v, kind: fee ? 'fee' : 'item' };
        applyPending(l);
        draft.lines.push(l);
        continue;
      }
    }

    if (isWarehouse) {
      m = line.match(/^(?:E\s+)?(\d{3,8})\s+(.+?)\s+(\d{3,6})([NB])$/);
      if (m && !NOT_ITEM.test(m[2])) {
        // OCR dropped the decimal point; warehouse prices always have cents.
        const l: DraftLine = { raw: m[2].trim(), code: m[1], total: +m[3] / 100, kind: /^(DEPOSIT|ENVIRO|ECO ?FEE)/i.test(m[2]) ? 'fee' : 'item' };
        applyPending(l);
        draft.lines.push(l);
        continue;
      }
    }

    // generic item: "DESCRIPTION 3.49" with an optional tax flag
    m = line.match(new RegExp(String.raw`^(.+?[A-Za-z].*?)\s+\$?(-?)${PRICE}\s*(-?)\s*([A-Z0-9]{0,2}|\*)?$`));
    if (m && !NOT_ITEM.test(m[1]) && m[1].replace(/[^A-Za-z]/g, '').length >= 2) {
      const raw = m[1].replace(/^\d{6,14}\s+/, '').trim();
      const code = (m[1].match(/^(\d{3,14})\s/) || [])[1];
      const v = signed(m[3], m[2] || m[4]) as number;
      const isDiscount = /\b(coupon|discount|savings|promo|off)\b/i.test(raw) && v < 0;
      const l: DraftLine = { raw, code: code ?? null, total: v, kind: isDiscount ? 'discount' : /deposit|enviro|eco fee|bottle/i.test(raw) ? 'fee' : 'item' };
      applyPending(l);
      draft.lines.push(l);
    }
  }
  draft.tenders = tenders;
  if (draft.kind === 'return') {
    // On refunds, item amounts are negative; make sure lines and totals agree in sign.
    for (const l of draft.lines) if (l.kind !== 'discount' && l.total > 0) l.total = -l.total;
    for (const k of ['subtotal', 'tax', 'total'] as const) {
      const v = draft[k];
      if (typeof v === 'number' && v > 0) draft[k] = -v;
    }
  }
  return draft;

  function applyPending(l: DraftLine) {
    if (pendingQty && Math.abs(Math.abs(l.total) - pendingQty.qty * pendingQty.unit) < 0.03) {
      l.qty = pendingQty.qty;
      l.unitPrice = pendingQty.unit;
    }
    pendingQty = null;
  }
}

function signed(v: string, minus: string | undefined): number | null {
  const n = num(v);
  if (n === null) return null;
  return minus === '-' ? -Math.abs(n) : n;
}

function guessStore(lines: string[]): string | null {
  for (const l of lines.slice(0, 6)) {
    const letters = l.replace(/[^A-Za-z ]/g, '').trim();
    if (letters.length >= 3 && !/\d{3,}/.test(l) && !/receipt|welcome|thank/i.test(l)) return titleCase(letters);
  }
  return null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
