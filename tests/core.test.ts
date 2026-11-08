import { describe, expect, it } from 'vitest';
import { reconcile, withReconciliation } from '../src/core/reconcile';
import { scrubReceipt, scrubText } from '../src/core/privacy';
import { normalize, normDate, num } from '../src/core/normalize';
import { parseReceiptText } from '../src/core/textParser';
import { categorize, readableName } from '../src/core/categorize';
import { lookup, COSTCO_PACK } from '../src/core/packs';
import { planTiles } from '../src/core/tiling';
import { buildRequest, costOf } from '../src/core/claude';
import type { Receipt } from '../src/core/types';

const base = (over: Partial<Receipt> = {}): Receipt => ({
  id: 'x', store: 'Test', date: '2026-01-01', kind: 'purchase', currency: 'CAD', items: [], subtotal: null, tax: 0, total: 0,
  instantSavings: 0, tenders: [], source: { method: 'manual' }, flags: [], reconciled: false, createdAt: '2026-01-01T00:00:00Z', ...over,
});
const item = (lineTotal: number, discount = 0) => ({ raw: 'X', name: 'X', category: 'Other' as const, qty: 1, unitPrice: lineTotal, lineTotal, discount });

describe('reconcile', () => {
  it('passes when items minus discounts plus tax equal the total', () => {
    const r = reconcile(base({ items: [item(10), item(5.5, 1.5)], tax: 0.7, total: 14.7, subtotal: 14 }));
    expect(r.ok).toBe(true);
    expect(r.itemsNet).toBe(14);
  });
  it('flags a mismatch and explains it', () => {
    const r = reconcile(base({ items: [item(10)], tax: 0.5, total: 12 }));
    expect(r.ok).toBe(false);
    expect(r.diff).toBe(1.5);
    expect(r.issues[0]).toMatch(/off by \$1.50/);
  });
  it('tolerates a cent of rounding', () => {
    expect(reconcile(base({ items: [item(3.33), item(3.33), item(3.33)], tax: 0, total: 10.0 })).ok).toBe(true);
  });
  it('handles refunds with negative amounts and reversed discounts', () => {
    const r = reconcile(base({ items: [item(-39.98, -5), item(-17.99)], tax: -6.6, total: -59.57, subtotal: -52.97 }));
    expect(r.ok).toBe(true);
  });
  it('withReconciliation replaces stale reconciliation flags', () => {
    const r = withReconciliation(base({ items: [item(1)], total: 1, flags: ['Items plus tax come to old', 'Date not found. Please set it.'] }));
    expect(r.reconciled).toBe(true);
    expect(r.flags).toEqual(['Date not found. Please set it.']);
  });
});

describe('privacy', () => {
  it('masks membership and card numbers', () => {
    expect(scrubText('Member 111222333444')).toBe('Member XXXXXXXXXXXX');
    expect(scrubText('XXXXXXXXXXXX1234 CHIP read')).toBe('XXXXXXXXXXXXXXXX CHIP read');
    expect(scrubText('VISA ending in 4242')).toBe('VISA ending in XXXX');
    expect(scrubText('card 4111 1111 1111 1111')).toBe('card XXXX XXXX XXXX XXXX');
  });
  it('keeps item codes and prices', () => {
    expect(scrubText('1234567 KS GRK YGRT 11.99')).toBe('1234567 KS GRK YGRT 11.99');
  });
  it('scrubs every text field of a receipt', () => {
    const r = scrubReceipt(base({ items: [{ ...item(1), raw: 'Loyalty # 99887766' }], tenders: [{ label: 'MC ****9876', amount: 1, kind: 'card' }] }));
    expect(r.items[0].raw).not.toMatch(/9988/);
    expect(r.tenders[0].label).toBe('MC ****XXXX');
  });
});

describe('normalize', () => {
  it('folds discount lines into their item by code and applies the store pack', () => {
    const r = normalize(
      {
        store: 'COSTCO WHOLESALE',
        date: '10/13/2026',
        lines: [
          { raw: 'B/S BREASTS', code: '55503', total: 32.61, kind: 'item' },
          { raw: 'ORG BANANAS', code: '2619', total: 2.59, kind: 'item' },
          { raw: '/ 55503', total: -5, kind: 'discount', ref: '55503' },
          { raw: 'DEPOSIT CL/458', total: 0.1, kind: 'fee' },
        ],
        subtotal: 30.3,
        tax: 0,
        total: 30.3,
      },
      { source: { method: 'claude' } },
    );
    expect(r.store).toBe('Costco');
    expect(r.date).toBe('2026-10-13');
    expect(r.items).toHaveLength(3);
    expect(r.items[0].discount).toBe(5);
    expect(r.items[0].category).toBe('Meat & Seafood');
    expect(r.items[2].category).toBe('Fees & Deposits');
    expect(r.reconciled).toBe(true);
    expect(r.instantSavings).toBe(5);
  });
  it('keeps an unmatched discount as its own line so totals still reconcile', () => {
    const r = normalize({ store: 'Shop', date: '2026-02-01', lines: [{ raw: 'COUPON', total: -1, kind: 'discount' }], tax: 0, total: -1 }, { source: { method: 'ocr' } });
    expect(r.items).toHaveLength(1);
    expect(r.reconciled).toBe(true);
  });
  it('parses money and dates in common formats', () => {
    expect(num('$1,234.50')).toBe(1234.5);
    expect(num('5.00-')).toBe(-5);
    expect(num('3,49')).toBe(3.49);
    expect(normDate('2026-03-04')).toBe('2026-03-04');
    expect(normDate('03/04/2026')).toBe('2026-03-04');
    expect(normDate('25/12/2025')).toBe('2025-12-25');
    expect(normDate('nonsense')).toBeNull();
  });
  it('trusts the printed line total over a wrong unit price', () => {
    const r = normalize({ store: 'Shop', date: '2026-02-01', lines: [{ raw: 'APPLES', qty: 2, unitPrice: 9, total: 6.98, kind: 'item' }], tax: 0, total: 6.98 }, { source: { method: 'ocr' } });
    expect(r.items[0].unitPrice).toBe(3.49);
  });
});

describe('text parser', () => {
  it('parses a warehouse receipt with instant savings, fees and quantities', () => {
    const text = [
      'COSTCO', 'WHOLESALE', 'SOMEWHERE #123', 'Member 111122223333',
      '55503 B/S BREASTS 32.61 N',
      '1987654 / 55503 5.00-',
      '2 @ 6.99',
      '1764168 ACE BAKERY 13.98 N',
      '458 MILK 2% 5.95 N',
      '9481 DEPOSIT CL/458 0.10',
      'SUBTOTAL 47.64', 'TAX 0.00', '**** TOTAL 47.64',
      'XXXXXXXXXXXX1234 CHIP read', 'COSTCO MASTERCARD 47.64', 'CHANGE 0.00',
      'INSTANT SAVINGS $5.00', '10/13/2026 07:04',
    ].join('\n');
    const r = parseReceiptText(text);
    expect(r.store).toBe('Costco');
    expect(r.items.map((i) => i.lineTotal)).toEqual([32.61, 13.98, 5.95, 0.1]);
    expect(r.items[0].discount).toBe(5);
    expect(r.items[1].qty).toBe(2);
    expect(r.items[1].unitPrice).toBe(6.99);
    expect(r.items[3].category).toBe('Fees & Deposits');
    expect(r.total).toBe(47.64);
    expect(r.reconciled).toBe(true);
    expect(r.tenders[0]).toMatchObject({ label: 'COSTCO MASTERCARD', amount: 47.64, kind: 'card' });
    expect(JSON.stringify(r)).not.toMatch(/1111|1234 CHIP/);
  });
  it('parses a generic supermarket receipt with GST and PST', () => {
    const text = ['Maple Grocer', '123 Main St', 'BANANAS 1.29', 'WHOLE MILK 4L 6.49', 'DISH SOAP 4.99 GP', 'SUBTOTAL 12.77', 'GST 0.25', 'PST 0.35', 'TOTAL 13.37', 'VISA 13.37', '2026-05-02 14:31'].join('\n');
    const r = parseReceiptText(text);
    expect(r.store).toBe('Maple Grocer');
    expect(r.items).toHaveLength(3);
    expect(r.tax).toBe(0.6);
    expect(r.reconciled).toBe(true);
    expect(r.items[0].category).toBe('Produce');
    expect(r.items[2].category).toBe('Household');
  });
  it('handles a refund receipt', () => {
    const text = ['COSTCO WHOLESALE', '*** REFUND ***', '1990532 SPYDER SHORT 12.97-', '1990533 SPYDER SHORT 12.97-', 'SUBTOTAL 25.94-', 'TAX 3.11-', 'TOTAL 29.05-', '10/13/2026 05:50'].join('\n');
    const r = parseReceiptText(text);
    expect(r.kind).toBe('return');
    expect(r.total).toBe(-29.05);
    expect(r.reconciled).toBe(true);
  });
});

describe('categorize and packs', () => {
  it('categorizes common grocery words', () => {
    expect(categorize('ORGANIC BLUEBERRIES')).toBe('Produce');
    expect(categorize('Greek yogurt')).toBe('Dairy & Eggs');
    expect(categorize('PAPER TOWEL 12PK')).toBe('Household');
    expect(categorize('mystery thing')).toBe('Other');
  });
  it('expands abbreviations', () => {
    expect(readableName('KS GRK YGRT')).toBe('Kirkland greek yogurt');
  });
  it('looks up the Costco pack by code and by printed text', () => {
    expect(lookup(COSTCO_PACK, '426192', '')?.name).toBe('Broccoli');
    expect(lookup(COSTCO_PACK, undefined, 'BROCCOLI')?.category).toBe('Produce');
    expect(lookup(COSTCO_PACK, '0', 'DEPOSIT CL/999')?.category).toBe('Fees & Deposits');
  });
});

describe('tiling', () => {
  it('keeps short receipts whole', () => {
    expect(planTiles(600, 1800, () => 0).tiles).toEqual([[0, 1800]]);
  });
  it('cuts tall receipts on blank rows', () => {
    const ink = (y: number) => (y % 40 < 30 ? 0.5 : 0); // text bands with blank gaps
    const p = planTiles(600, 6000, ink);
    expect(p.tiles.length).toBeGreaterThan(2);
    for (const [, end] of p.tiles.slice(0, -1)) expect(ink(end)).toBe(0);
    expect(p.tiles[p.tiles.length - 1][1]).toBe(6000);
  });
});

describe('claude request', () => {
  it('forces the receipt tool and never asks for identifiers', () => {
    const req = buildRequest([{ kind: 'image', mediaType: 'image/png', base64: 'AAAA' }], 'claude-haiku-5-5');
    expect(req.tool_choice).toEqual({ type: 'tool', name: 'record_receipt' });
    expect(buildRequest([], 'claude-sonnet-5-5').tool_choice).toEqual({ type: 'auto' });
    expect(req.system).toMatch(/Never output membership/);
    expect(JSON.stringify(req.tools[0].input_schema)).not.toMatch(/member(ship)? ?(no|number|id)|card ?number/i);
  });
  it('prices tokens per model', () => {
    expect(costOf('claude-haiku-5-5', 1_000_000, 0)).toBeCloseTo(0.1);
    expect(costOf('claude-sonnet-5-5', 0, 1_000_000)).toBeCloseTo(10);
  });
});

describe('row ink profile', () => {
  it('treats a uniform dark background as blank and text rows as ink', async () => {
    const { rowInkProfile } = await import('../src/core/tiling');
    const W = 100, H = 3;
    const g = new Uint8Array(W * H).fill(60); // dark table
    for (let x = 20; x < 80; x++) g[W + x] = x % 4 < 2 ? 20 : 240; // text-like stripes on row 1
    const p = rowInkProfile(g, W, H);
    expect(p[0]).toBe(0);
    expect(p[1]).toBeGreaterThan(0);
    expect(p[2]).toBe(0);
  });
});
