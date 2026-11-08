import { esc, hideTip, money, showTip } from './util';

const NS = 'http://www.w3.org/2000/svg';
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function el(tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  parent?.appendChild(n);
  return n as SVGElement;
}
function niceStep(v: number): number {
  const raw = v / 4;
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return Math.max(m * p, 1);
  return 10 * p;
}
function roundTop(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface Series {
  values: number[];
  color: string;
  label: string;
}

/** Vertical bars, stacked when several series are given. Hover shows a tooltip. */
export function vbars(svg: SVGSVGElement, labels: string[], series: Series[], opts: { fmtLabel?: (l: string, i: number) => string; tip?: (i: number) => string; money?: boolean } = {}): void {
  svg.innerHTML = '';
  const W = svg.clientWidth || 600;
  const H = +(svg.getAttribute('height') || 240);
  const m = { l: opts.money === false ? 30 : 52, r: 6, t: 8, b: 26 };
  const n = Math.max(1, labels.length);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0));
  const top = Math.max(...totals, 1);
  const step = niceStep(top);
  const max = step * Math.ceil(top / step);
  for (let v = 0; v <= max + 1e-9; v += step) {
    const y = m.t + ih - (ih * v) / max;
    el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: css('--grid') }, svg);
    el('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end' }, svg).textContent = opts.money === false ? String(v) : v >= 1000 ? `$${v / 1000}k` : `$${v}`;
  }
  const bw = iw / n, gap = Math.max(2, bw * 0.28), w = Math.max(2, bw - gap);
  const every = Math.ceil(n / Math.max(1, Math.floor(iw / 46)));
  labels.forEach((lab, i) => {
    const x = m.l + i * bw + gap / 2;
    let y0 = m.t + ih;
    const visible = series.map((s, si) => ({ s, si })).filter(({ s }) => (s.values[i] || 0) > 0);
    visible.forEach(({ s }, vi) => {
      const v = Math.max(0, s.values[i] || 0);
      const h = (ih * v) / max;
      const isTop = vi === visible.length - 1;
      const gapPx = vi > 0 ? 2 : 0;
      el('path', { d: isTop ? roundTop(x, y0 - h, w, Math.max(0, h - gapPx), 4) : `M${x},${y0 - gapPx}V${y0 - h}H${x + w}V${y0 - gapPx}Z`, fill: css(s.color) }, svg);
      y0 -= h;
    });
    if (i % every === 0) el('text', { x: x + w / 2, y: H - 7, 'text-anchor': 'middle' }, svg).textContent = opts.fmtLabel ? opts.fmtLabel(lab, i) : lab;
    const hit = el('rect', { x: m.l + i * bw, y: m.t, width: bw, height: ih, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', (e) => showTip(e as MouseEvent, opts.tip ? opts.tip(i) : `${esc(lab)}: ${money(totals[i])}`));
    hit.addEventListener('mouseleave', hideTip);
  });
}

/** Horizontal bars with direct value labels. */
export function hbars(svg: SVGSVGElement, rows: { label: string; v: number; tip?: string }[], opts: { left?: number; color?: string; fmt?: (v: number) => string; rowH?: number } = {}): void {
  svg.innerHTML = '';
  const W = svg.clientWidth || 500;
  const rowH = opts.rowH ?? 28;
  const left = Math.min(opts.left ?? 130, W * 0.42);
  const H = rows.length * rowH + 6;
  svg.setAttribute('height', String(H));
  const max = Math.max(...rows.map((r) => r.v), 1);
  const iw = W - left - 64;
  rows.forEach((r, i) => {
    const y = i * rowH;
    const t = el('text', { x: left - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end' }, svg);
    t.textContent = r.label.length > 22 && W < 500 ? r.label.slice(0, 20) + '…' : r.label;
    t.setAttribute('style', `fill:${css('--ink')};font-family:var(--sans);font-size:12.5px`);
    const w = Math.max(2, (iw * Math.max(0, r.v)) / max);
    el('path', { d: `M${left},${y + 7}H${left + w - 4}Q${left + w},${y + 7} ${left + w},${y + 11}V${y + rowH - 11}Q${left + w},${y + rowH - 7} ${left + w - 4},${y + rowH - 7}H${left}Z`, fill: css(opts.color ?? '--s1') }, svg);
    el('text', { x: left + w + 6, y: y + rowH / 2 + 4 }, svg).textContent = opts.fmt ? opts.fmt(r.v) : money(r.v);
    const hit = el('rect', { x: 0, y, width: W, height: rowH, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', (e) => showTip(e as MouseEvent, r.tip ?? `${esc(r.label)}: ${money(r.v)}`));
    hit.addEventListener('mouseleave', hideTip);
  });
}

/** Decorative topographic contours for the hero, generated deterministically. */
export function contours(seed = 7): string {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const paths: string[] = [];
  const cx = 860, cy = 40;
  for (let k = 1; k <= 14; k++) {
    const r = k * 46;
    const pts: string[] = [];
    const wob = 10 + k * 1.6;
    const phase = rnd() * 6;
    for (let a = 0; a <= 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const rr = r + Math.sin(t * 3 + phase) * wob + Math.cos(t * 5 + phase * 0.7) * wob * 0.5;
      pts.push(`${(cx + Math.cos(t) * rr * 1.25).toFixed(1)},${(cy + Math.sin(t) * rr * 0.8).toFixed(1)}`);
    }
    paths.push(`<path d="M${pts.join('L')}Z"/>`);
  }
  return `<svg class="contours" viewBox="0 0 1000 360" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">${paths.join('')}</svg>`;
}
