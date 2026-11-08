import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, monthRange } from '../src/core/analytics';
import { reconcile } from '../src/core/reconcile';
import type { Receipt } from '../src/core/types';

const dir = join(__dirname, '..', 'eval', 'synthetic', 'truth');
const demo: Receipt[] = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));

describe('synthetic fixtures', () => {
  it('has 15 to 20 receipts and every one reconciles', () => {
    expect(demo.length).toBeGreaterThanOrEqual(15);
    expect(demo.length).toBeLessThanOrEqual(20);
    for (const r of demo) expect(reconcile(r).ok, r.id).toBe(true);
  });
});

describe('analyze', () => {
  const a = analyze(demo, new Date('2026-11-07T12:00:00Z'));
  it('summarizes spend and trips', () => {
    expect(a.empty).toBe(false);
    expect(a.summary.receipts).toBe(demo.length);
    expect(a.summary.returns).toBe(1);
    expect(a.summary.net).toBeCloseTo(demo.reduce((x, r) => x + r.total, 0), 2);
    expect(a.summary.stores).toBe(4);
  });
  it('monthly series cover every month and add up to item spend', () => {
    expect(a.months).toEqual(monthRange(a.summary.firstDate, a.summary.lastDate));
    const series = a.monthlyFood.reduce((x, y) => x + y, 0) + a.monthlyOther.reduce((x, y) => x + y, 0);
    const items = a.categories.filter((c) => c.category !== 'Fees & Deposits' && c.category !== 'Membership').reduce((x, c) => x + c.total, 0);
    expect(series).toBeCloseTo(items, 1);
  });
  it('finds staples, price increases and insights', () => {
    expect(a.staples.length).toBeGreaterThan(3);
    expect(a.staples.every((s) => s.tripShare >= 0.4)).toBe(true);
    expect(a.priceChanges.some((p) => p.pct > 0)).toBe(true);
    expect(a.insights.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(a.insights)).not.toMatch(/\u2014/);
  });
  it('handles no receipts', () => {
    expect(analyze([]).empty).toBe(true);
  });
});
