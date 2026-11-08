export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const money = (v: number, d = 0): string =>
  `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const money2 = (v: number): string => money(v, 2);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (i: number) => MON[i];
export const niceDate = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${MON[+m - 1]} ${+d}, ${y}`;
};
export const niceMonth = (ym: string, short = false): string => {
  const [y, m] = ym.split('-');
  return short ? `${MON[+m - 1]} ${y.slice(2)}` : `${MON[+m - 1]} ${y}`;
};

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as HTMLElement;
}

let toastTimer = 0;
export function toast(msg: string): void {
  let t = document.querySelector('.toast') as HTMLElement | null;
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t && (t.hidden = true), 3200);
}

const tipEl = () => {
  let t = document.querySelector('.tip') as HTMLElement | null;
  if (!t) {
    t = document.createElement('div');
    t.className = 'tip';
    document.body.appendChild(t);
  }
  return t;
};
export function showTip(e: MouseEvent, html: string): void {
  const t = tipEl();
  t.innerHTML = html;
  t.style.opacity = '1';
  const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8);
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, e.clientY - 40)}px`;
}
export function hideTip(): void {
  tipEl().style.opacity = '0';
}

/** A two-step button: first click arms it, second click within 4s confirms. */
export function armButton(btn: HTMLButtonElement, armedLabel: string, onConfirm: () => void): void {
  const label = btn.textContent;
  let armed = false;
  let timer = 0;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.classList.add('armed');
      btn.textContent = armedLabel;
      timer = window.setTimeout(() => {
        armed = false;
        btn.classList.remove('armed');
        btn.textContent = label;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
}

export function download(name: string, text: string, type = 'application/json'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
