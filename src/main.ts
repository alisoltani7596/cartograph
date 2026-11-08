import './styles.css';
import type { Receipt } from './core/types';
import { renderDashboard } from './ui/pages/dashboard';
import { renderAdd } from './ui/pages/add';
import { renderEditor, renderReceipts } from './ui/pages/receipts';
import { renderSettings } from './ui/pages/settings';
import { renderHow, renderPrivacy } from './ui/pages/info';
import { loadReceipts } from './ui/store';

// The landing page shows the public synthetic receipts (eval/synthetic) as demo data.
const demo = Object.values(import.meta.glob('../eval/synthetic/truth/*.json', { eager: true, import: 'default' })) as Receipt[];

const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="var(--accent)"/><g fill="none" stroke="var(--accent-ink)" stroke-width="3.2" stroke-linecap="round"><path d="M14 44c6-9 12-3 18-9s6-14 18-15"/><path d="M14 33c7-7 11-1 16-6s5-11 12-12"/><path d="M14 22c4-4 7-1 10-4s3-6 7-6"/></g><circle cx="46" cy="44" r="5" fill="var(--accent-ink)"/></svg>`;
const NAV: [string, string][] = [
  ['#/', 'Dashboard'],
  ['#/receipts', 'Receipts'],
  ['#/add', 'Add receipts'],
  ['#/settings', 'Settings'],
  ['#/how', 'How it works'],
  ['#/privacy', 'Privacy'],
];

function applyTheme(t: string | null) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
let theme: string | null = null;
try {
  theme = localStorage.getItem('cartograph.theme');
} catch {
  /* storage blocked */
}
applyTheme(theme);

const app = document.getElementById('app')!;
app.innerHTML = `
<header class="topbar"><div class="topbar-in">
  <a class="brand" href="#/" aria-label="Cartograph home">${LOGO}<b>Cartograph</b></a>
  <nav class="main" aria-label="Main">${NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</nav>
  <button class="iconbtn" id="theme" aria-label="Toggle light or dark theme" title="Theme">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
  </button>
</div></header>
<main id="view" tabindex="-1"></main>
<footer class="site"><span>Cartograph · open source, MIT · by Ali Soltaninezhad</span><span>Works with Costco receipts and most others. Not affiliated with any store.</span><a href="https://github.com/alisoltani7596/cartograph">Source on GitHub</a></footer>`;

document.getElementById('theme')!.addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem('cartograph.theme', next);
  } catch {
    /* ignore */
  }
  redraw?.();
});

const view = document.getElementById('view')!;
let redraw: (() => void) | null = null;

async function route() {
  const hash = location.hash || '#/';
  const [path, query] = hash.slice(1).split('?');
  const params = new URLSearchParams(query ?? '');
  redraw = null;
  document.querySelectorAll('nav.main a').forEach((a) => {
    const h = (a as HTMLAnchorElement).getAttribute('href')!.slice(1);
    a.toggleAttribute('aria-current', h === '/' ? path === '/' : path.startsWith(h));
    if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page');
  });
  const mine = await loadReceipts();
  if (path === '/' || path === '') {
    const showDemo = !mine.length || params.get('demo') === '1';
    redraw = renderDashboard(view, showDemo ? demo : mine, showDemo ? 'demo' : 'mine', mine.length > 0);
    document.title = 'Cartograph';
  } else if (path === '/add') {
    await renderAdd(view);
    document.title = 'Add receipts · Cartograph';
  } else if (path.startsWith('/receipts/')) {
    await renderEditor(view, decodeURIComponent(path.slice('/receipts/'.length)));
    document.title = 'Edit receipt · Cartograph';
  } else if (path === '/receipts') {
    await renderReceipts(view);
    document.title = 'Receipts · Cartograph';
  } else if (path === '/settings') {
    await renderSettings(view);
    document.title = 'Settings · Cartograph';
  } else if (path === '/privacy') {
    renderPrivacy(view);
    document.title = 'Privacy · Cartograph';
  } else if (path === '/how') {
    renderHow(view);
    document.title = 'How it works · Cartograph';
  } else {
    view.innerHTML = `<div class="card empty"><h3>Page not found</h3><a class="btn" href="#/">Go home</a></div>`;
  }
  window.scrollTo({ top: 0 });
}

addEventListener('hashchange', route);
let rt = 0;
addEventListener('resize', () => {
  clearTimeout(rt);
  rt = window.setTimeout(() => redraw?.(), 150);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => redraw?.());
route();
