import { analyze, type Analysis, type ProductStat } from '../../core/analytics';
import { CATEGORIES, type Receipt } from '../../core/types';
import { contours, hbars, vbars } from '../charts';
import { table } from '../table';
import { esc, money, money2, niceDate, niceMonth } from '../util';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function renderDashboard(root: HTMLElement, receipts: Receipt[], mode: 'demo' | 'mine', hasMine: boolean): () => void {
  const a = analyze(receipts);
  const s = a.summary;
  const showStores = a.stores.length > 1;
  root.innerHTML = `
  ${mode === 'demo' ? hero(hasMine) : ''}
  ${mode === 'mine' ? `<div class="row" style="margin-bottom:14px"><h1 style="margin:0;font-size:32px">Your shopping map</h1><span class="spacer"></span>${s.needsReview ? `<a class="btn" href="#/receipts">${s.needsReview} receipt${s.needsReview > 1 ? 's' : ''} need${s.needsReview > 1 ? '' : 's'} review</a>` : ''}<a class="btn" href="#/?demo=1">View demo</a><a class="btn primary" href="#/add">Add receipts</a></div>` : ''}
  ${mode === 'demo' && hasMine ? `<div class="banner">You're viewing the demo. <a href="#/">Back to your dashboard</a></div>` : ''}
  <p class="sub">${niceDate(s.firstDate)} to ${niceDate(s.lastDate)} · ${s.receipts} receipts · ${s.trips} trips${showStores ? ` at ${s.stores} stores` : ''} · ${s.uniqueProducts} different products</p>
  <div class="kpis">
    ${kpi('Total spent', money(s.net), 'after refunds, tax included')}
    ${kpi('Per month', money(s.perMonth), `over ${s.months} month${s.months > 1 ? 's' : ''}`)}
    ${kpi('Average trip', money(s.avgBasket), s.avgGapDays ? `about every ${s.avgGapDays} days` : `${a.trips.length} trips`)}
    ${kpi('Groceries', `${Math.round(s.foodShare * 100)}%`, `${money(s.food)} on food`)}
    ${kpi('Saved and earned back', money(s.instantSavings + s.rewards), 'instant savings + rewards')}
    ${kpi('Biggest trip', s.biggestTrip ? money(s.biggestTrip.total) : '-', s.biggestTrip ? `${esc(s.biggestTrip.store)}, ${niceDate(s.biggestTrip.date)}` : '')}
  </div>

  <h2>What stands out</h2>
  <p class="sub">Generated from your receipts. Nothing here is sent anywhere.</p>
  <div class="insights">${a.insights.map((i) => `<div class="card ins"><span class="tag">${esc(i.tag)}</span><h3>${esc(i.title)}</h3><p>${esc(i.body)}</p></div>`).join('')}</div>

  <h2>Spending by month</h2>
  <p class="sub">Net of refunds and savings, before tax. Fees, deposits and memberships are left out.</p>
  <div class="card">
    <div class="legend"><span style="--c:var(--s1)">Groceries</span><span style="--c:var(--s2)">Everything else</span></div>
    <svg class="chart" id="c-monthly" height="250" role="img" aria-label="Monthly spending, groceries and everything else"></svg>
  </div>

  <div class="grid2" style="margin-top:14px">
    <div class="card"><h3>Every trip</h3><p class="small" style="margin:0 0 8px">One bar per shopping trip</p><svg class="chart" id="c-trips" height="210" role="img" aria-label="Spend per trip"></svg></div>
    <div class="card"><h3>${showStores ? 'By store' : 'When you shop'}</h3><p class="small" style="margin:0 0 8px">${showStores ? 'Total spent at each store' : 'Trips by day of the week'}</p><svg class="chart" id="c-side" height="210" role="img" aria-label="${showStores ? 'Spend by store' : 'Trips by weekday'}"></svg></div>
  </div>

  <h2>Where the money goes</h2>
  <p class="sub">Net spend by category, before tax.</p>
  <div class="grid2">
    <div class="card"><svg class="chart" id="c-cats" role="img" aria-label="Spend by category"></svg></div>
    <div class="card"><div class="scroll" style="max-height:420px"><table id="t-cats"></table></div></div>
  </div>

  <h2>What you buy every time</h2>
  <p class="sub">Items in at least 40% of trips to that store. "Every" is the usual gap between buys.</p>
  <div class="card"><div class="scroll"><table id="t-staples"></table></div></div>

  <div class="grid2">
    <div>
      <h2>Probably running low</h2>
      <p class="sub">Regulars whose usual repurchase gap has passed. A head start on the next list.</p>
      <div class="card"><div class="scroll" style="max-height:380px"><table id="t-due"></table></div></div>
    </div>
    <div>
      <h2>Price changes</h2>
      <p class="sub">Same item, first unit price you paid vs latest. Meat sold by weight is left out.</p>
      <div class="card"><div class="scroll" style="max-height:380px"><table id="t-prices"></table></div></div>
    </div>
  </div>

  <div class="grid2">
    <div>
      <h2>Savings and rewards</h2>
      <p class="sub">Money taken off or paid with rewards.</p>
      <div class="card"><div class="scroll" style="max-height:340px"><table id="t-save"></table></div></div>
    </div>
    <div>
      <h2>Returns and big tickets</h2>
      <p class="sub">Refunds, and single lines of $45 or more.</p>
      <div class="card"><div class="scroll" style="max-height:340px"><table id="t-big"></table></div></div>
    </div>
  </div>

  <h2>Everything you've bought</h2>
  <p class="sub">Every product across every receipt. Click a column to sort.</p>
  <div class="card">
    <div class="controls">
      <label class="sr-only" for="q">Search items</label><input id="q" type="text" placeholder="Search items">
      <label class="sr-only" for="catSel">Category</label><select id="catSel"><option value="">All categories</option>${CATEGORIES.filter((c) => a.categories.some((x) => x.category === c)).map((c) => `<option>${esc(c)}</option>`).join('')}</select>
    </div>
    <div class="scroll tall"><table id="t-all"></table></div>
    <p class="small" id="allCount" style="margin:10px 0 0"></p>
  </div>`;

  const maxTrips = Math.max(1, ...a.products.map((p) => p.trips));
  const freq = (p: ProductStat) => `<div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bartrack"><div class="bar" style="width:${(100 * p.trips) / maxTrips}%"></div></div><span class="num">${p.trips}</span></div>`;
  const nameCell = (p: ProductStat) => `${esc(p.name)}${showStores ? ` <span class="small">${esc(p.store)}</span>` : ''}`;

  table(root.querySelector('#t-cats')!, [
    { k: 'category', h: 'Category' },
    { k: 'lines', h: 'Lines', num: true },
    { k: 'total', h: 'Spent', num: true, f: (r) => money(r.total) },
  ], a.categories.filter((c) => Math.abs(c.total) >= 0.5), { sort: 'total' });

  table(root.querySelector('#t-staples')!, [
    { k: 'name', h: 'Item', f: nameCell },
    { k: 'trips', h: 'Trips', f: freq },
    { k: 'tripShare', h: 'Of trips', num: true, f: (r) => `${Math.round(r.tripShare * 100)}%` },
    { k: 'intervalDays', h: 'Every', num: true, f: (r) => (r.intervalDays ? `${r.intervalDays} days` : '') },
    { k: 'avgUnitPrice', h: 'Avg price', num: true, f: (r) => money2(r.avgUnitPrice) },
    { k: 'spend', h: 'Spent', num: true, f: (r) => money(r.spend) },
  ], a.staples, { sort: 'trips', empty: 'Staples show up after a few trips.' });

  table(root.querySelector('#t-due')!, [
    { k: 'name', h: 'Item', f: nameCell },
    { k: 'intervalDays', h: 'Usual gap', num: true, f: (r) => `${r.intervalDays} d` },
    { k: 'daysOver', h: 'Status', num: true, f: (r) => (r.daysOver > 0 ? `<span class="up">${r.daysOver} days past</span>` : `<span class="small">in ${-r.daysOver} days</span>`) },
  ], a.due, { sort: 'daysOver', empty: 'Nothing due right now.' });

  table(root.querySelector('#t-prices')!, [
    { k: 'name', h: 'Item', f: (r) => esc(r.product.name), sv: (r) => r.product.name },
    { k: 'first', h: 'First', num: true, f: (r) => money2(r.product.firstUnitPrice), sv: (r) => r.product.firstUnitPrice },
    { k: 'last', h: 'Latest', num: true, f: (r) => money2(r.product.lastUnitPrice), sv: (r) => r.product.lastUnitPrice },
    { k: 'pct', h: 'Change', num: true, f: (r) => `<span class="${r.pct > 0 ? 'up' : 'down'}">${r.pct > 0 ? '▲ +' : '▼ '}${Math.round(r.pct * 100)}%</span>` },
  ], a.priceChanges, { sort: 'pct', empty: 'Price changes show up once you buy the same item a few times.' });

  const saveRows = [
    { what: 'Instant savings at the register', when: `${niceDate(s.firstDate)} to ${niceDate(s.lastDate)}`, amount: s.instantSavings },
    ...a.rewardTenders.map((t) => ({ what: `${t.label} (${t.store})`, when: niceDate(t.date), amount: t.amount })),
  ];
  table(root.querySelector('#t-save')!, [
    { k: 'what', h: 'What' },
    { k: 'when', h: 'When', f: (r) => `<span class="small">${esc(r.when)}</span>` },
    { k: 'amount', h: 'Amount', num: true, f: (r) => `<span class="down">${money2(r.amount)}</span>` },
  ], saveRows);

  const bigRows = [
    ...a.returns.map((r) => ({ kind: 'Refund', name: r.items.join(', ') || 'Refund', date: r.date, amount: r.total })),
    ...a.bigTickets.slice(0, 12).map((b) => ({ kind: 'Bought', name: b.name, date: b.date, amount: b.price })),
  ];
  table(root.querySelector('#t-big')!, [
    { k: 'kind', h: 'Type', f: (r) => `<span class="pill">${r.kind}</span>` },
    { k: 'name', h: 'Item' },
    { k: 'date', h: 'Date', f: (r) => niceDate(r.date) },
    { k: 'amount', h: 'Amount', num: true, f: (r) => `<span class="${r.amount < 0 ? 'down' : ''}">${money2(r.amount)}</span>` },
  ], bigRows, { sort: 'date', empty: 'No refunds or big tickets.' });

  const setAll = table(root.querySelector('#t-all')!, [
    { k: 'name', h: 'Item', f: nameCell },
    { k: 'category', h: 'Category', f: (r) => `<span class="pill">${esc(r.category)}</span>` },
    { k: 'trips', h: 'Trips', f: freq },
    { k: 'avgUnitPrice', h: 'Avg price', num: true, f: (r) => money2(r.avgUnitPrice) },
    { k: 'spend', h: 'Spent', num: true, f: (r) => money2(r.spend) },
    { k: 'lastDate', h: 'Last bought', f: (r) => niceDate(r.lastDate) },
  ], a.products, { sort: 'trips' });
  const q = root.querySelector('#q') as HTMLInputElement;
  const sel = root.querySelector('#catSel') as HTMLSelectElement;
  const filter = () => {
    const t = q.value.toLowerCase();
    const rows = a.products.filter((p) => (!sel.value || p.category === sel.value) && (!t || p.name.toLowerCase().includes(t)));
    setAll(rows);
    root.querySelector('#allCount')!.textContent = `${rows.length} products · ${money2(rows.reduce((x, p) => x + p.spend, 0))}`;
  };
  q.addEventListener('input', filter);
  sel.addEventListener('change', filter);
  filter();

  const draw = () => drawCharts(root, a, showStores);
  draw();
  return draw;
}

function drawCharts(root: HTMLElement, a: Analysis, showStores: boolean) {
  const q = (id: string) => root.querySelector(id) as SVGSVGElement | null;
  const monthly = q('#c-monthly');
  if (!monthly) return;
  vbars(monthly, a.months, [
    { values: a.monthlyFood, color: '--s1', label: 'Groceries' },
    { values: a.monthlyOther, color: '--s2', label: 'Everything else' },
  ], {
    fmtLabel: (l, i) => (i === 0 || l.endsWith('-01') ? niceMonth(l, true) : niceMonth(l).slice(0, 3)),
    tip: (i) => `<b>${niceMonth(a.months[i])}</b><br>Groceries ${money(a.monthlyFood[i])}<br>Everything else ${money(Math.max(0, a.monthlyOther[i]))}`,
  });
  const trips = a.trips.filter((t) => t.items >= 1);
  vbars(q('#c-trips')!, trips.map((t) => t.date), [{ values: trips.map((t) => t.total), color: '--s1', label: 'Trip' }], {
    fmtLabel: (l) => niceMonth(l.slice(0, 7), true),
    tip: (i) => `<b>${niceDate(trips[i].date)}</b><br>${esc(trips[i].store)}<br>${money2(trips[i].total)} · ${trips[i].items} lines`,
  });
  if (showStores) {
    hbars(q('#c-side')!, a.stores.map((s) => ({ label: s.store, v: s.total, tip: `<b>${esc(s.store)}</b><br>${money2(s.total)} · ${s.trips} trips` })), { left: 150, color: '--s3' });
  } else {
    vbars(q('#c-side')!, WEEKDAYS, [{ values: a.weekday, color: '--s3', label: 'Trips' }], { money: false, tip: (i) => `<b>${WEEKDAYS[i]}</b><br>${a.weekday[i]} trips` });
  }
  hbars(q('#c-cats')!, a.categories.filter((c) => c.total > 0.5 && c.category !== 'Fees & Deposits').map((c) => ({ label: c.category, v: c.total, tip: `<b>${esc(c.category)}</b><br>${money2(c.total)} · ${c.lines} lines` })), { left: 130 });
}

function kpi(l: string, v: string, n: string) {
  return `<div class="card kpi"><div class="l">${esc(l)}</div><div class="v">${v}</div><div class="n">${esc(n)}</div></div>`;
}

function hero(hasMine: boolean) {
  return `<section class="hero">
    ${contours()}
    <div class="eyebrow">Demo data · 18 made-up receipts</div>
    <h1>Map where your grocery money goes.</h1>
    <p class="lead">Drop in photos, screenshots or PDFs of your receipts and Cartograph turns them into this dashboard. Works best with Costco receipts, and reads most others too. Your receipts never leave your browser.</p>
    <div class="row" style="margin-top:18px">
      <a class="btn primary" href="#/add">Add your receipts</a>
      ${hasMine ? '<a class="btn" href="#/">Your dashboard</a>' : ''}
      <a class="btn" href="#/how">How it works</a>
      <a class="btn" href="#/privacy">Privacy</a>
    </div>
  </section>`;
}
