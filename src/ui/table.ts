import { esc } from './util';

export interface Col<T> {
  k: string;
  h: string;
  num?: boolean;
  f?: (r: T) => string;
  sv?: (r: T) => string | number;
}

/** Small sortable table. Returns a setter so callers can filter rows. */
export function table<T>(target: HTMLElement, cols: Col<T>[], rows: T[], opts: { sort?: string; dir?: 1 | -1; empty?: string } = {}): (rows: T[]) => void {
  let sortKey = opts.sort ?? null;
  let dir: 1 | -1 = opts.dir ?? -1;
  let data = rows;
  const render = () => {
    const r = data.slice();
    if (sortKey) {
      const c = cols.find((x) => x.k === sortKey)!;
      const get = (row: T) => (c.sv ? c.sv(row) : (row as Record<string, unknown>)[sortKey!]) as string | number;
      r.sort((a, b) => {
        const x = get(a), y = get(b);
        return (x > y ? 1 : x < y ? -1 : 0) * dir;
      });
    }
    target.innerHTML =
      `<thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}" data-k="${c.k}" aria-sort="${sortKey === c.k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(c.h)}${sortKey === c.k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>` +
      `<tbody>${r.length ? r.map((row) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.f ? c.f(row) : esc((row as Record<string, unknown>)[c.k])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="small">${esc(opts.empty ?? 'Nothing here yet.')}</td></tr>`}</tbody>`;
    target.querySelectorAll('th').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.k!;
        if (sortKey === k) dir = dir > 0 ? -1 : 1;
        else {
          sortKey = k;
          dir = -1;
        }
        render();
      });
    });
  };
  render();
  return (nr: T[]) => {
    data = nr;
    render();
  };
}
