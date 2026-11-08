// Browser smoke test: renders every page at desktop and phone width in light and
// dark mode, runs the free OCR path on a sample receipt, and fails on console errors
// or horizontal overflow. Usage: node scripts/smoke.mjs <base-url> [outDir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/cartograph/';
const out = process.argv[3] ?? 'smoke-out';
mkdirSync(out, { recursive: true });
const pages = ['', 'receipts', 'add', 'settings', 'how', 'privacy'];
const problems = [];
const browser = await chromium.launch();
for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${name}/${scheme}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && problems.push(`${name}/${scheme} console: ${m.text()}`));
    for (const p of pages) {
      await page.goto(`${base}#/${p}`);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`${name}/${scheme} #/${p}: horizontal overflow ${overflow}px`);
      if (scheme === 'light' || p === '') await page.screenshot({ path: `${out}/${name}-${scheme}-${p || 'dashboard'}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
// functional: free OCR on a sample receipt, then the editor
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`ocr: ${e.message}`));
await page.goto(`${base}#/add`);
await page.click('button[data-sample="sample-warehouse.jpg"]');
await page.waitForSelector('.qitem .status', { timeout: 120000 });
const result = await page.textContent('.qitem');
console.log('OCR sample:', result?.replace(/\s+/g, ' ').trim());
await page.screenshot({ path: `${out}/flow-add.png`, fullPage: true });
await page.click('.qitem a.btn');
await page.waitForSelector('#rec');
await page.screenshot({ path: `${out}/flow-editor.png`, fullPage: true });
await page.goto(`${base}#/`);
await page.waitForTimeout(500);
const h1 = await page.textContent('h1');
console.log('Dashboard after upload:', h1);
await page.screenshot({ path: `${out}/flow-mine.png`, fullPage: true });
// browser can reach Anthropic (CORS) using an obviously fake key: expect an auth error, not a network error
await page.goto(`${base}#/settings`);
await page.fill('#key', 'sk-ant-fake-key-for-cors-check');
await page.click('#test');
await page.waitForFunction(() => !/Testing/.test(document.querySelector('#keyMsg')?.textContent ?? 'Testing'), null, { timeout: 30000 });
console.log('Key test message:', await page.textContent('#keyMsg'));
await browser.close();
if (problems.length) {
  console.error('Problems:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('Smoke test passed.');
