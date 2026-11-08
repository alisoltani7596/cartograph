import { FOOD_CATEGORIES, netOf, round2, type Category, type Receipt } from './types';

export interface ProductStat {
  key: string;
  name: string;
  store: string;
  code?: string;
  category: Category;
  trips: number;
  lines: number;
  units: number;
  spend: number;
  avgUnitPrice: number;
  firstDate: string;
  lastDate: string;
  intervalDays: number | null;
  firstUnitPrice: number;
  lastUnitPrice: number;
  /** Share of this store's trips that included the product, 0..1 */
  tripShare: number;
  returned: number;
  saved: number;
}

export interface Trip {
  date: string;
  store: string;
  total: number;
  items: number;
  receipts: number;
}

export interface Insight {
  tag: string;
  title: string;
  body: string;
}

export interface Analysis {
  empty: boolean;
  summary: {
    firstDate: string;
    lastDate: string;
    months: number;
    receipts: number;
    returns: number;
    trips: number;
    stores: number;
    spend: number;
    refunded: number;
    net: number;
    perMonth: number;
    avgBasket: number;
    avgGapDays: number | null;
    uniqueProducts: number;
    lineItems: number;
    food: number;
    foodShare: number;
    instantSavings: number;
    rewards: number;
    tax: number;
    biggestTrip: Trip | null;
    needsReview: number;
  };
  months: string[];
  monthlyFood: number[];
  monthlyOther: number[];
  monthlyByCategory: Record<string, number[]>;
  categories: { category: Category; total: number; lines: number }[];
  stores: { store: string; total: number; trips: number }[];
  products: ProductStat[];
  staples: ProductStat[];
  due: (ProductStat & { nextDate: string; daysOver: number })[];
  priceChanges: { product: ProductStat; change: number; pct: number }[];
  trips: Trip[];
  weekday: number[];
  hour: Record<number, number>;
  rewardTenders: { date: string; store: string; label: string; amount: number }[];
  returns: { date: string; store: string; total: number; items: string[] }[];
  bigTickets: { date: string; store: string; name: string; price: number }[];
  insights: Insight[];
}

const DAY = 864e5;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const NON_SHOPPING = new Set<Category>(['Fees & Deposits', 'Membership']);

export function productKey(store: string, code: string | undefined, name: string): string {
  return `${store.toLowerCase()}|${code ? `#${code}` : name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

export function analyze(receipts: Receipt[], today = new Date()): Analysis {
  const rs = [...receipts].sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
  const purchases = rs.filter((r) => r.kind === 'purchase');
  const returns = rs.filter((r) => r.kind === 'return');
  if (!rs.length) return emptyAnalysis();

  // trips: one per store per day
  const tripMap = new Map<string, Trip>();
  for (const r of purchases) {
    const k = `${r.date}|${r.store}`;
    const t = tripMap.get(k) ?? { date: r.date, store: r.store, total: 0, items: 0, receipts: 0 };
    t.total = round2(t.total + r.total);
    t.items += r.items.length;
    t.receipts++;
    tripMap.set(k, t);
  }
  const trips = [...tripMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const shopTrips = trips.filter((t) => t.items >= 3);
  const tripsByStore = new Map<string, number>();
  for (const t of trips) tripsByStore.set(t.store, (tripsByStore.get(t.store) ?? 0) + 1);

  const spend = round2(purchases.reduce((a, r) => a + r.total, 0));
  const refunded = round2(returns.reduce((a, r) => a + r.total, 0));
  const first = rs[0].date;
  const last = rs[rs.length - 1].date;
  const months = monthRange(first, last);
  const gaps: number[] = [];
  for (let i = 1; i < shopTrips.length; i++) gaps.push(days(shopTrips[i - 1].date, shopTrips[i].date));

  // categories and monthly
  const catTotals = new Map<Category, { total: number; lines: number }>();
  const monthlyByCategory: Record<string, number[]> = {};
  const mIndex = new Map(months.map((m, i) => [m, i]));
  for (const r of rs) {
    const mi = mIndex.get(r.date.slice(0, 7))!;
    for (const it of r.items) {
      const v = netOf(it);
      const c = catTotals.get(it.category) ?? { total: 0, lines: 0 };
      c.total += v;
      if (r.kind === 'purchase') c.lines++;
      catTotals.set(it.category, c);
      (monthlyByCategory[it.category] ??= months.map(() => 0))[mi] += v;
    }
  }
  const monthlyFood = months.map((_, i) => round2(Object.entries(monthlyByCategory).filter(([c]) => FOOD_CATEGORIES.has(c as Category)).reduce((a, [, v]) => a + v[i], 0)));
  const monthlyOther = months.map((_, i) =>
    round2(Object.entries(monthlyByCategory).filter(([c]) => !FOOD_CATEGORIES.has(c as Category) && !NON_SHOPPING.has(c as Category)).reduce((a, [, v]) => a + v[i], 0)),
  );
  const categories = [...catTotals.entries()].map(([category, v]) => ({ category, total: round2(v.total), lines: v.lines })).sort((a, b) => b.total - a.total);

  // products
  const pm = new Map<string, { s: ProductStat; dates: Set<string>; prices: [string, number][] }>();
  for (const r of rs) {
    for (const it of r.items) {
      if (NON_SHOPPING.has(it.category)) continue;
      const key = productKey(r.store, it.code, it.name);
      let e = pm.get(key);
      if (!e) {
        e = {
          s: { key, name: it.name, store: r.store, code: it.code, category: it.category, trips: 0, lines: 0, units: 0, spend: 0, avgUnitPrice: 0, firstDate: r.date, lastDate: r.date, intervalDays: null, firstUnitPrice: 0, lastUnitPrice: 0, tripShare: 0, returned: 0, saved: 0 },
          dates: new Set(),
          prices: [],
        };
        pm.set(key, e);
      }
      e.s.name = it.name;
      e.s.category = it.category;
      e.s.spend += netOf(it);
      if (r.kind === 'purchase') {
        e.dates.add(r.date);
        e.s.lines++;
        e.s.units += it.qty;
        e.s.saved += it.discount;
        if (it.unitPrice > 0) e.prices.push([r.date, it.unitPrice]);
      } else {
        e.s.returned += -netOf(it);
      }
    }
  }
  const products: ProductStat[] = [];
  for (const { s, dates, prices } of pm.values()) {
    const ds = [...dates].sort();
    s.trips = ds.length;
    s.spend = round2(s.spend);
    s.saved = round2(s.saved);
    s.returned = round2(s.returned);
    if (ds.length) {
      s.firstDate = ds[0];
      s.lastDate = ds[ds.length - 1];
    }
    if (ds.length > 1) s.intervalDays = Math.round(days(ds[0], ds[ds.length - 1]) / (ds.length - 1));
    prices.sort((a, b) => a[0].localeCompare(b[0]));
    s.avgUnitPrice = prices.length ? round2(prices.reduce((a, p) => a + p[1], 0) / prices.length) : 0;
    s.firstUnitPrice = prices[0]?.[1] ?? 0;
    s.lastUnitPrice = prices[prices.length - 1]?.[1] ?? 0;
    s.tripShare = s.trips / Math.max(1, tripsByStore.get(s.store) ?? 1);
    products.push(s);
  }
  products.sort((a, b) => b.trips - a.trips || b.spend - a.spend);

  const staples = products.filter((p) => p.trips >= 3 && p.tripShare >= 0.4);
  const todayIso = today.toISOString().slice(0, 10);
  const due = products
    .filter((p) => p.trips >= 4 && p.intervalDays && days(p.lastDate, todayIso) < 270)
    .map((p) => {
      const next = new Date(Date.parse(p.lastDate) + (p.intervalDays as number) * DAY).toISOString().slice(0, 10);
      return { ...p, nextDate: next, daysOver: days(next, todayIso) };
    })
    .filter((p) => p.daysOver > -14)
    .sort((a, b) => b.daysOver - a.daysOver);

  const priceChanges = products
    .filter((p) => p.trips >= 3 && p.firstUnitPrice > 0 && p.category !== 'Meat & Seafood')
    .map((p) => ({ product: p, change: round2(p.lastUnitPrice - p.firstUnitPrice), pct: (p.lastUnitPrice - p.firstUnitPrice) / p.firstUnitPrice }))
    .filter((x) => Math.abs(x.change) >= 0.3 && Math.abs(x.pct) >= 0.03)
    .sort((a, b) => b.pct - a.pct);

  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const hour: Record<number, number> = {};
  for (const t of shopTrips) {
    weekday[(new Date(t.date + 'T12:00:00Z').getUTCDay() + 6) % 7]++;
    const r = purchases.find((x) => x.date === t.date && x.store === t.store && x.time);
    if (r?.time) {
      const h = +r.time.slice(0, 2);
      hour[h] = (hour[h] ?? 0) + 1;
    }
  }

  const rewardTenders = purchases.flatMap((r) => r.tenders.filter((t) => t.kind === 'reward' || t.kind === 'gift').map((t) => ({ date: r.date, store: r.store, label: t.label, amount: t.amount })));
  const instantSavings = round2(purchases.reduce((a, r) => a + r.items.reduce((b, i) => b + Math.max(0, i.discount), 0), 0));
  const rewards = round2(rewardTenders.reduce((a, t) => a + t.amount, 0));
  const food = round2(categories.filter((c) => FOOD_CATEGORIES.has(c.category)).reduce((a, c) => a + c.total, 0));
  const shopTotal = categories.filter((c) => !NON_SHOPPING.has(c.category)).reduce((a, c) => a + c.total, 0);
  const storeMap = new Map<string, { total: number; trips: number }>();
  for (const t of trips) {
    const s = storeMap.get(t.store) ?? { total: 0, trips: 0 };
    s.total = round2(s.total + t.total);
    s.trips++;
    storeMap.set(t.store, s);
  }

  const bigTickets = purchases
    .flatMap((r) => r.items.filter((i) => i.unitPrice >= 45 && i.category !== 'Meat & Seafood' && !NON_SHOPPING.has(i.category)).map((i) => ({ date: r.date, store: r.store, name: i.name, price: i.lineTotal })))
    .sort((a, b) => b.price - a.price);

  const monthsCount = Math.max(1, months.length);
  const a: Analysis = {
    empty: false,
    summary: {
      firstDate: first,
      lastDate: last,
      months: monthsCount,
      receipts: rs.length,
      returns: returns.length,
      trips: trips.length,
      stores: storeMap.size,
      spend,
      refunded,
      net: round2(spend + refunded),
      perMonth: round2((spend + refunded) / monthsCount),
      avgBasket: shopTrips.length ? round2(shopTrips.reduce((x, t) => x + t.total, 0) / shopTrips.length) : 0,
      avgGapDays: gaps.length ? Math.round(gaps.reduce((x, g) => x + g, 0) / gaps.length) : null,
      uniqueProducts: products.length,
      lineItems: purchases.reduce((x, r) => x + r.items.length, 0),
      food,
      foodShare: shopTotal > 0 ? food / shopTotal : 0,
      instantSavings,
      rewards,
      tax: round2(rs.reduce((x, r) => x + r.tax, 0)),
      biggestTrip: trips.reduce<Trip | null>((m, t) => (!m || t.total > m.total ? t : m), null),
      needsReview: rs.filter((r) => !r.reconciled).length,
    },
    months,
    monthlyFood,
    monthlyOther,
    monthlyByCategory,
    categories,
    stores: [...storeMap.entries()].map(([store, v]) => ({ store, ...v })).sort((x, y) => y.total - x.total),
    products,
    staples,
    due,
    priceChanges,
    trips,
    weekday,
    hour,
    rewardTenders,
    returns: returns.map((r) => ({ date: r.date, store: r.store, total: r.total, items: r.items.filter((i) => !NON_SHOPPING.has(i.category)).map((i) => i.name) })),
    bigTickets,
    insights: [],
  };
  a.insights = buildInsights(a);
  return a;
}

const money0 = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
const money2 = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

function buildInsights(a: Analysis): Insight[] {
  const out: Insight[] = [];
  const s = a.summary;
  const n = a.months.length;
  if (n >= 6) {
    const half = Math.floor(n / 2);
    const total = (i: number) => a.monthlyFood[i] + a.monthlyOther[i];
    const recent = a.months.slice(n - half).reduce((x, _, i) => x + total(n - half + i), 0) / half;
    const before = a.months.slice(0, n - half).reduce((x, _, i) => x + total(i), 0) / (n - half);
    if (before > 0) {
      const pct = (recent - before) / before;
      out.push({
        tag: 'Trend',
        title: Math.abs(pct) < 0.08 ? 'Spending is steady' : pct > 0 ? `Spending is up ${Math.round(pct * 100)}% lately` : `Spending is down ${Math.round(-pct * 100)}% lately`,
        body: `The last ${half} months averaged ${money0(recent)} a month, compared with ${money0(before)} a month before that.`,
      });
    }
  }
  if (a.staples.length) {
    const top = a.staples[0];
    out.push({
      tag: 'Habit',
      title: `${top.name} is in ${Math.round(top.tripShare * 100)}% of your ${top.store} trips`,
      body: `Your regulars: ${a.staples.slice(0, 6).map((p) => p.name.toLowerCase()).join(', ')}.`,
    });
  }
  const bySpend = [...a.products].sort((x, y) => y.spend - x.spend);
  if (bySpend[0]) out.push({ tag: 'Biggest item', title: `${bySpend[0].name} is your top spend`, body: `${money0(bySpend[0].spend)} across ${bySpend[0].trips} trips. Next: ${bySpend.slice(1, 4).map((p) => `${p.name.toLowerCase()} (${money0(p.spend)})`).join(', ')}.` });
  const topCat = a.categories.find((c) => c.category !== 'Fees & Deposits');
  if (topCat) out.push({ tag: 'Category', title: `${topCat.category} leads at ${money0(topCat.total)}`, body: `Groceries are ${Math.round(s.foodShare * 100)}% of what you buy. ${a.categories.slice(1, 3).map((c) => `${c.category} ${money0(c.total)}`).join(', ')} come next.` });
  const ups = a.priceChanges.filter((p) => p.pct > 0).slice(0, 3);
  if (ups.length) out.push({ tag: 'Prices', title: `${ups.length} regular item${ups.length > 1 ? 's' : ''} got pricier`, body: ups.map((u) => `${u.product.name.toLowerCase()} ${money2(u.product.firstUnitPrice)} to ${money2(u.product.lastUnitPrice)} (+${Math.round(u.pct * 100)}%)`).join(', ') + '.' });
  if (s.instantSavings + s.rewards > 0) out.push({ tag: 'Savings', title: `${money0(s.instantSavings + s.rewards)} saved or earned back`, body: `${money0(s.instantSavings)} in instant savings at the register${s.rewards ? ` and ${money0(s.rewards)} paid with rewards or gift certificates` : ''}.` });
  if (s.avgGapDays) out.push({ tag: 'Rhythm', title: `A shop about every ${s.avgGapDays} days`, body: `${a.trips.length} trips, averaging ${money0(s.avgBasket)} each. Busiest day: ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][a.weekday.indexOf(Math.max(...a.weekday))]}.` });
  if (a.due.length) out.push({ tag: 'Next trip', title: `${a.due.length} regular${a.due.length > 1 ? 's are' : ' is'} probably running low`, body: `${a.due.slice(0, 5).map((d) => d.name.toLowerCase()).join(', ')}.` });
  if (s.refunded < 0) out.push({ tag: 'Returns', title: `${money0(-s.refunded)} came back as refunds`, body: `${s.returns} return${s.returns > 1 ? 's' : ''}, mostly ${mode(a.returns.flatMap((r) => r.items)) ?? 'mixed items'}.` });
  return out;
}

function mode(xs: string[]): string | null {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x.toLowerCase(), (m.get(x.toLowerCase()) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of m) if (v > n) [best, n] = [k, v];
  return best;
}

export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let y = +first.slice(0, 4), m = +first.slice(5, 7);
  const ly = +last.slice(0, 4), lm = +last.slice(5, 7);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m === 13) {
      y++;
      m = 1;
    }
  }
  return out;
}

function emptyAnalysis(): Analysis {
  return {
    empty: true,
    summary: { firstDate: '', lastDate: '', months: 0, receipts: 0, returns: 0, trips: 0, stores: 0, spend: 0, refunded: 0, net: 0, perMonth: 0, avgBasket: 0, avgGapDays: null, uniqueProducts: 0, lineItems: 0, food: 0, foodShare: 0, instantSavings: 0, rewards: 0, tax: 0, biggestTrip: null, needsReview: 0 },
    months: [], monthlyFood: [], monthlyOther: [], monthlyByCategory: {}, categories: [], stores: [], products: [], staples: [], due: [], priceChanges: [], trips: [], weekday: [0, 0, 0, 0, 0, 0, 0], hour: {}, rewardTenders: [], returns: [], bigTickets: [], insights: [],
  };
}
