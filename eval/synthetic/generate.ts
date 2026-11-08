/**
 * Generates the public synthetic receipt set: made-up stores, items and amounts.
 * Writes eval/synthetic/truth/*.json and eval/synthetic/html/*.html (rendered to PNG
 * by eval/synthetic/render.py). Deterministic: same seed, same receipts.
 *
 *   npx tsx eval/synthetic/generate.ts
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Category, Receipt, ReceiptItem, Tender } from '../../src/core/types';

const HERE = dirname(fileURLToPath(import.meta.url));
let seed = 20260601;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `${Math.abs(n).toFixed(2)}${n < 0 ? '-' : ''}`;

type Cat = [code: string, printed: string, name: string, category: Category, price: number, taxable: boolean, drift?: number];

// Northgate Warehouse Club: a made-up bulk store with Costco-style item codes.
const WAREHOUSE: Cat[] = [
  ['400112', 'NG CHKN THIGH', 'Chicken thighs, boneless', 'Meat & Seafood', 24.99, false, 0.06],
  ['400118', 'NG CHKN BRST', 'Chicken breasts', 'Meat & Seafood', 31.49, false, 0.08],
  ['401230', 'ATL SALMON PRT', 'Atlantic salmon portions', 'Meat & Seafood', 27.99, false],
  ['401577', 'LEAN GRND TURKEY', 'Lean ground turkey', 'Meat & Seafood', 18.49, false],
  ['300045', 'NG LG EGGS 30', 'Large eggs, 30 pack', 'Dairy & Eggs', 11.79, false, 0.1],
  ['300210', 'SKYR PLAIN 1KG', 'Plain skyr, 1 kg', 'Dairy & Eggs', 8.99, false],
  ['300377', 'AGED GOUDA 1KG', 'Aged gouda', 'Dairy & Eggs', 16.99, false],
  ['300481', 'OAT MILK 6X946', 'Oat milk, 6 pack', 'Dairy & Eggs', 12.49, false],
  ['200017', 'HONEYCRISP 3LB', 'Honeycrisp apples, 3 lb', 'Produce', 7.99, false, 0.15],
  ['200098', 'ORG RASPBRY 340G', 'Organic raspberries', 'Produce', 8.49, false, 0.2],
  ['200133', 'BABY BOK CHOY', 'Baby bok choy', 'Produce', 4.99, false],
  ['200215', 'SWEET POTATO 5LB', 'Sweet potatoes, 5 lb', 'Produce', 6.49, false],
  ['200302', 'ROMA TOM 2LB', 'Roma tomatoes', 'Produce', 4.79, false],
  ['200355', 'ORG CARROT 5LB', 'Organic carrots, 5 lb', 'Produce', 6.99, false],
  ['200410', 'HASS AVO 6CT', 'Avocados, 6 count', 'Produce', 8.99, false],
  ['200466', 'CLEMENTINE 2.5LB', 'Clementines', 'Produce', 7.49, false],
  ['500022', 'SPROUTED LOAF', 'Sprouted grain bread', 'Bakery', 6.99, false],
  ['500048', 'BUTTER CROISS 12', 'Butter croissants, 12', 'Bakery', 9.99, false],
  ['600091', 'JASMINE RICE 8KG', 'Jasmine rice, 8 kg', 'Pantry', 17.99, false],
  ['600150', 'EVOO 2L', 'Extra virgin olive oil, 2 L', 'Pantry', 21.99, false, 0.12],
  ['600218', 'PEANUT BTR 2KG', 'Peanut butter, 2 kg', 'Pantry', 10.99, false],
  ['600305', 'CHICKPEA 8X540', 'Chickpeas, 8 cans', 'Pantry', 9.49, false],
  ['700011', 'TRAIL MIX 1.1KG', 'Trail mix', 'Snacks', 13.99, false],
  ['700064', 'SEAWEED SNK 24', 'Roasted seaweed snacks', 'Snacks', 12.49, false],
  ['800030', 'SPARK WATER 24', 'Sparkling water, 24 cans', 'Beverages', 9.99, true],
  ['800071', 'COLD BREW 12PK', 'Cold brew coffee, 12 pack', 'Beverages', 19.99, true],
  ['900040', 'FRZ BLUEBRY 2KG', 'Frozen blueberries, 2 kg', 'Frozen', 15.99, false],
  ['900085', 'VEG DUMPLING 1.5', 'Vegetable dumplings', 'Frozen', 13.49, false],
  ['910002', 'PAPER TOWEL 12R', 'Paper towels, 12 rolls', 'Household', 24.99, true],
  ['910019', 'BATH TISSUE 30R', 'Bath tissue, 30 rolls', 'Household', 22.99, true],
  ['910044', 'LAUNDRY PODS 90', 'Laundry pods, 90', 'Household', 26.99, true],
  ['910078', 'DISH TABS 110', 'Dishwasher tablets, 110', 'Household', 21.49, true],
  ['920010', 'TOOTHPASTE 4PK', 'Toothpaste, 4 pack', 'Personal Care', 13.99, true],
  ['930055', 'COTTON THROW', 'Cotton throw blanket', 'Home & Garden', 29.99, true],
  ['940012', 'USB-C CABLE 3PK', 'USB-C cables, 3 pack', 'Electronics & Toys', 19.99, true],
];
// Fresh Fields Market: a made-up neighbourhood grocery store.
const MARKET: Cat[] = [
  ['', 'BANANAS', 'Bananas', 'Produce', 1.69, false],
  ['', 'GREEN GRAPES', 'Green grapes', 'Produce', 6.12, false],
  ['', 'BROCCOLI CROWNS', 'Broccoli crowns', 'Produce', 3.29, false],
  ['', 'RED PEPPERS', 'Red peppers', 'Produce', 4.49, false],
  ['', 'CILANTRO', 'Cilantro', 'Produce', 1.49, false],
  ['', 'LEMONS 2LB BAG', 'Lemons, 2 lb', 'Produce', 4.99, false],
  ['', 'WHOLE MILK 4L', 'Whole milk, 4 L', 'Dairy & Eggs', 6.29, false, 0.05],
  ['', 'GREEK YOGURT 750G', 'Greek yogurt', 'Dairy & Eggs', 5.99, false],
  ['', 'SOURDOUGH LOAF', 'Sourdough loaf', 'Bakery', 5.49, false],
  ['', 'BAGELS 6PK', 'Bagels, 6 pack', 'Bakery', 4.29, false],
  ['', 'PASTA SAUCE 650ML', 'Pasta sauce', 'Pantry', 3.99, false],
  ['', 'SPAGHETTI 900G', 'Spaghetti', 'Pantry', 2.49, false],
  ['', 'BLACK BEANS 540ML', 'Black beans', 'Pantry', 1.79, false],
  ['', 'TORTILLA CHIPS', 'Tortilla chips', 'Snacks', 4.49, true],
  ['', 'DARK CHOC BAR', 'Dark chocolate bar', 'Snacks', 3.29, true],
  ['', 'ORANGE JUICE 1.54L', 'Orange juice', 'Beverages', 5.49, false],
  ['', 'GROUND COFFEE 340G', 'Ground coffee', 'Beverages', 11.99, false, 0.1],
  ['', 'FROZEN PIZZA', 'Frozen pizza', 'Frozen', 7.99, false],
  ['', 'DISH SOAP 740ML', 'Dish soap', 'Household', 3.99, true],
  ['', 'GARBAGE BAGS 40', 'Garbage bags', 'Household', 8.99, true],
];
const PHARMACY: Cat[] = [
  ['', 'VITAMIN D3 1000IU', 'Vitamin D3', 'Health', 12.99, false],
  ['', 'ALLERGY TABS 30', 'Allergy tablets', 'Health', 15.49, false],
  ['', 'SUNSCREEN SPF50', 'Sunscreen SPF 50', 'Personal Care', 13.99, true],
  ['', 'SHAMPOO 750ML', 'Shampoo', 'Personal Care', 8.99, true],
  ['', 'BANDAGES 60CT', 'Bandages', 'Health', 6.49, true],
];
const HARDWARE: Cat[] = [
  ['', 'LED BULB 4PK', 'LED bulbs, 4 pack', 'Household', 11.99, true],
  ['', 'POTTING SOIL 28L', 'Potting soil', 'Home & Garden', 9.99, true],
  ['', 'WORK GLOVES', 'Work gloves', 'Home & Garden', 14.99, true],
  ['', 'AA BATTERY 8PK', 'AA batteries, 8 pack', 'Household', 10.49, true],
];

interface Spec {
  store: string;
  layout: 'warehouse' | 'market' | 'simple';
  date: string;
  time: string;
  lines: { c: Cat; qty: number; coupon?: number }[];
  kind?: 'purchase' | 'return';
}

const monthsAgo = (m: number, day: number) => {
  const d = new Date(Date.UTC(2026, 9, 1));
  d.setUTCMonth(d.getUTCMonth() - m);
  d.setUTCDate(day);
  return d.toISOString().slice(0, 10);
};

function priceAt(c: Cat, date: string): number {
  const months = (Date.parse('2026-10-31') - Date.parse(date)) / (30.4 * 864e5);
  const drift = c[6] ?? 0.02;
  return r2(c[4] * (1 - drift * (months / 11)));
}

const specs: Spec[] = [];
const staplesW = ['400118', '300045', '200017', '200355', '600150', '910002', '200410', '300210'];
for (let m = 10; m >= 0; m--) {
  if (m === 4) continue; // a skipped month, like real life
  const n = 14 + Math.floor(rnd() * 10);
  const chosen = new Map<string, { c: Cat; qty: number; coupon?: number }>();
  for (const code of staplesW) if (rnd() < 0.85) chosen.set(code, { c: WAREHOUSE.find((x) => x[0] === code)!, qty: 1 });
  while (chosen.size < n) {
    const c = pick(WAREHOUSE);
    if (!chosen.has(c[0])) chosen.set(c[0], { c, qty: rnd() < 0.12 ? 2 : 1 });
  }
  const lines = [...chosen.values()];
  for (const l of lines) if (rnd() < 0.18) l.coupon = pick([2, 3, 4, 5]);
  specs.push({ store: 'NORTHGATE WAREHOUSE CLUB', layout: 'warehouse', date: monthsAgo(m, 3 + Math.floor(rnd() * 22)), time: `${14 + Math.floor(rnd() * 5)}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`, lines });
}
for (let i = 0; i < 4; i++) {
  const n = 7 + Math.floor(rnd() * 6);
  const chosen = new Map<string, { c: Cat; qty: number; coupon?: number }>();
  while (chosen.size < n) {
    const c = pick(MARKET);
    if (!chosen.has(c[1])) chosen.set(c[1], { c, qty: rnd() < 0.2 ? 2 : 1, coupon: rnd() < 0.12 ? 1 : undefined });
  }
  specs.push({ store: 'FRESH FIELDS MARKET', layout: 'market', date: monthsAgo(9 - i * 3, 8 + Math.floor(rnd() * 15)), time: `${10 + Math.floor(rnd() * 9)}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`, lines: [...chosen.values()] });
}
specs.push({ store: 'CEDAR & PINE PHARMACY', layout: 'simple', date: monthsAgo(7, 12), time: '11:20', lines: PHARMACY.slice(0, 3).map((c) => ({ c, qty: 1 })) });
specs.push({ store: 'CEDAR & PINE PHARMACY', layout: 'simple', date: monthsAgo(2, 19), time: '17:45', lines: [PHARMACY[3], PHARMACY[4], PHARMACY[0]].map((c) => ({ c, qty: 1 })) });
specs.push({ store: 'HARBOUR HARDWARE', layout: 'simple', date: monthsAgo(5, 6), time: '13:05', lines: HARDWARE.map((c) => ({ c, qty: 1 })) });
// a warehouse refund
specs.push({ store: 'NORTHGATE WAREHOUSE CLUB', layout: 'warehouse', kind: 'return', date: monthsAgo(1, 27), time: '16:10', lines: [{ c: WAREHOUSE.find((x) => x[0] === '930055')!, qty: 1, coupon: 5 }, { c: WAREHOUSE.find((x) => x[0] === '940012')!, qty: 1 }] });

const outTruth = join(HERE, 'truth');
const outHtml = join(HERE, 'html');
rmSync(outTruth, { recursive: true, force: true });
rmSync(outHtml, { recursive: true, force: true });
mkdirSync(outTruth, { recursive: true });
mkdirSync(outHtml, { recursive: true });

specs.sort((a, b) => a.date.localeCompare(b.date));
specs.forEach((s, idx) => {
  const sign = s.kind === 'return' ? -1 : 1;
  const items: ReceiptItem[] = [];
  const rows: string[] = [];
  let taxable = 0;
  let gst = 0, pst = 0;
  for (const l of s.lines) {
    const unit = priceAt(l.c, s.date);
    const lineTotal = r2(sign * unit * l.qty);
    const discount = r2(sign * (l.coupon ?? 0));
    items.push({ raw: l.c[1], code: l.c[0] || undefined, name: l.c[2], category: l.c[3], qty: l.qty, unitPrice: r2(sign * unit), lineTotal, discount });
    const net = lineTotal - discount;
    if (l.c[5]) {
      taxable += net;
      gst += net * 0.05;
      pst += net * 0.07;
    }
    if (s.layout === 'warehouse') {
      if (l.qty > 1) rows.push(row('', `${l.qty} @ ${unit.toFixed(2)}`, '', ''));
      rows.push(row(l.c[0], l.c[1], money(lineTotal), l.c[5] ? 'Y' : 'N'));
      if (l.coupon) rows.push(row(String(500000 + idx * 37 + rows.length), `/ ${l.c[0]}`, money(-discount), ''));
    } else {
      if (l.qty > 1) rows.push(row('', `  ${l.qty} @ $${unit.toFixed(2)}`, '', ''));
      rows.push(row('', l.c[1], money(lineTotal), l.c[5] ? 'GP' : ''));
      if (l.coupon) rows.push(row('', `  COUPON ${l.c[1].split(' ')[0]}`, money(-discount), ''));
    }
  }
  // deposits on canned drinks at the warehouse
  if (s.layout === 'warehouse' && s.lines.some((l) => l.c[0] === '800030')) {
    const dep = r2(sign * 2.4);
    items.push({ raw: 'DEPOSIT 800030', code: '9002', name: 'Container deposit', category: 'Fees & Deposits', qty: 1, unitPrice: dep, lineTotal: dep, discount: 0 });
    rows.push(row('9002', 'DEPOSIT 800030', money(dep), ''));
  }
  void taxable;
  const subtotal = r2(items.reduce((a, i) => a + i.lineTotal - i.discount, 0));
  gst = r2(gst);
  pst = r2(pst);
  const tax = r2(gst + pst);
  const total = r2(subtotal + tax);
  const savings = r2(Math.abs(items.reduce((a, i) => a + i.discount, 0)));
  const tenders: Tender[] = [];
  if (s.layout === 'warehouse' && idx % 5 === 3 && sign > 0) {
    const reward = r2(Math.min(40, total * 0.3));
    tenders.push({ label: 'ANNUAL REWARD', amount: reward, kind: 'reward' });
    tenders.push({ label: 'VISA', amount: r2(total - reward), kind: 'card' });
  } else tenders.push({ label: s.layout === 'market' && idx % 2 ? 'DEBIT' : 'VISA', amount: total, kind: 'card' });

  const id = `${s.date}_${s.layout}_${String(idx + 1).padStart(2, '0')}`;
  const store = titleCase(s.store);
  const receipt: Receipt & { split: string } = {
    id, store, location: s.layout === 'warehouse' ? 'Lakeview, BC' : 'Lakeview, BC', date: s.date, time: s.time, kind: s.kind ?? 'purchase', currency: 'CAD',
    items, subtotal, tax, total, instantSavings: savings, tenders, source: { method: 'demo' }, flags: [], reconciled: true,
    createdAt: `${s.date}T${s.time}:00Z`, split: 'synthetic',
  };
  writeFileSync(join(outTruth, `${id}.json`), JSON.stringify(receipt, null, 1));
  writeFileSync(join(outHtml, `${id}.html`), page(s, rows, { subtotal, gst, pst, tax, total, savings, tenders, idx, sign }));
});
console.log(`wrote ${specs.length} synthetic receipts`);

function row(code: string, desc: string, price: string, flag: string) {
  return `<tr><td class="code">${esc(code)}</td><td>${esc(desc)}</td><td class="p">${price}</td><td class="f">${flag}</td></tr>`;
}
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
function titleCase(s: string) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function page(s: Spec, rows: string[], t: { subtotal: number; gst: number; pst: number; tax: number; total: number; savings: number; tenders: Tender[]; idx: number; sign: number }) {
  const [y, mo, d] = s.date.split('-');
  const [hh, mm] = s.time.split(':').map(Number);
  const stamp = `${mo}/${d}/${y} ${String(hh % 12 || 12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  const wh = s.layout === 'warehouse';
  const header = wh
    ? `<div class="c logo">NORTHGATE<small>WAREHOUSE CLUB</small></div><div class="c b">LAKEVIEW #118</div><div class="c">4410 HARBOUR RD</div><div class="c">LAKEVIEW, BC V0X 1A0</div><div style="margin:10px 0 4px">Member 404455667788</div>`
    : `<div class="c logo2">${esc(s.store)}</div><div class="c">220 Elm Street, Lakeview BC</div><div class="c">(250) 555-0142</div><div class="c" style="margin-bottom:8px">GST# 81234 5678 RT0001</div>`;
  const taxRows = wh ? `<tr><td></td><td>TAX</td><td class="p">${money(t.tax)}</td></tr>` : `<tr><td></td><td>GST 5%</td><td class="p">${money(t.gst)}</td></tr><tr><td></td><td>PST 7%</td><td class="p">${money(t.pst)}</td></tr>`;
  const tenders = t.tenders
    .map((x) => (x.kind === 'card' ? `<tr><td>${x.label} ************4821</td><td class="p">${money(x.amount)}</td></tr>` : `<tr><td>${x.label}</td><td class="p">${money(x.amount)}</td></tr>`))
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff}
.r{width:500px;padding:26px 22px 30px;font:15px/1.4 ${wh ? '"DejaVu Sans",Arial' : '"DejaVu Sans Mono",monospace'};color:#141414;background:#fff}
.c{text-align:center}.b{font-weight:700}.logo{font:900 30px/1 "DejaVu Sans",Arial;letter-spacing:-1px}.logo small{display:block;font-size:12px;letter-spacing:4px;margin-top:2px}
.logo2{font:700 22px/1.2 "DejaVu Serif",serif;margin-bottom:4px}
table{width:100%;border-collapse:collapse}td{padding:1px 0}td.code{width:74px;text-align:right;padding-right:10px}td.p{text-align:right;width:84px}td.f{width:24px;padding-left:4px}
.sp{height:10px}.tot td{font-weight:700}
</style></head><body><div class="r" id="r">${header}
${t.sign < 0 ? '<div class="b" style="margin:4px 0 8px">*** REFUND ***</div>' : ''}
<table>${rows.join('')}</table><div class="sp"></div>
<table><tr><td></td><td>SUBTOTAL</td><td class="p">${money(t.subtotal)}</td></tr>${taxRows}<tr class="tot"><td>${wh ? '****' : ''}</td><td>TOTAL</td><td class="p">${money(t.total)}</td></tr></table>
<div class="sp"></div><table>${tenders}</table><div class="sp"></div>
${t.savings ? `<div class="b">${wh ? 'INSTANT SAVINGS' : 'YOU SAVED'} $${t.savings.toFixed(2)}</div>` : ''}
<div style="margin-top:8px">${stamp}</div><div class="c" style="margin-top:12px">Thank you for shopping with us!</div></div></body></html>`;
}
