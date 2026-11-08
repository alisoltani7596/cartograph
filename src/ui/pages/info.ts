import summaryJson from '../../../eval/results/summary.json';
import type { Aggregate } from '../../../eval/lib/metrics';

type Summary = { privateSet: { receipts: number; dev: number; test: number; testItemLines: number }; selectionOnDev: Record<string, Aggregate>; test: Record<string, Aggregate>; synthetic: Record<string, Aggregate> };
const summary = summaryJson as unknown as Summary;

const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export function renderPrivacy(root: HTMLElement): void {
  root.innerHTML = `<div class="prose">
  <div class="eyebrow">Privacy</div>
  <h1 style="font-size:34px">Your receipts stay with you</h1>
  <p class="lead">Cartograph has no server and no accounts. It's a static web page. Here's exactly what happens to your data.</p>
  <h2>What is stored, and where</h2>
  <p>Only the parsed receipt data (store, date, items, prices, totals) is saved, in your browser's IndexedDB on this device. Photos and PDFs are read in memory and then thrown away. Nothing is stored on any server, because there isn't one.</p>
  <h2>What is never stored</h2>
  <p>Membership numbers, loyalty numbers and card digits. The model is told never to return them, and every saved field is scrubbed again: any run of 8 or more digits and any masked card ending (like XXXX1234) is replaced with X before saving.</p>
  <h2>When anything leaves your browser</h2>
  <p><b>Only if you choose the Claude option.</b> Then the receipt image or PDF is sent directly from your browser to Anthropic's API with your own key, and the reply comes straight back. Anthropic's commercial terms say API inputs aren't used to train models. Your key is kept in this tab (or in IndexedDB if you tick "remember") and is only ever sent to api.anthropic.com.</p>
  <p>With the free OCR option nothing leaves your device at all. The OCR engine and its English language file are served from this same site, not a third-party CDN.</p>
  <h2>No tracking</h2>
  <p>No analytics, no cookies, no ads, no fonts or scripts from other sites.</p>
  <h2>You're in control</h2>
  <p>Export everything as JSON, import it on another device, or wipe it all with one button in <a href="#/settings">Settings</a>. Clearing your browser's site data does the same.</p>
  <h2>Check it yourself</h2>
  <p>The code is open source under the MIT license. Open your browser's network tab while adding a receipt: with OCR you'll see no requests leave the site; with Claude you'll see one request to api.anthropic.com.</p>
  </div>`;
}

export function renderHow(root: HTMLElement): void {
  const t = summary.test;
  const d = summary.selectionOnDev;
  const rows: [string, (a: Aggregate) => string][] = [
    ['Item lines found, right price (F1)', (a) => pct(a.itemF1)],
    ['Discounts matched to the right item', (a) => pct(a.discountAccuracy)],
    ['Category agrees with hand labels', (a) => pct(a.categoryAgreement)],
    ['Subtotal, tax and total exact', (a) => pct(Math.min(a.subtotalAccuracy, a.taxAccuracy, a.totalAccuracy))],
    ['Date exact', (a) => pct(a.dateAccuracy)],
    ['Receipts that reconcile', (a) => pct(a.reconciliationPassRate)],
    ['Receipts fully correct', (a) => pct(a.perfectRate)],
    ['Cost per receipt', (a) => `$${a.meanCostUsd.toFixed(4)}`],
    ['Time per receipt', (a) => `${a.meanSeconds.toFixed(1)} s`],
  ];
  root.innerHTML = `<div class="prose" style="max-width:860px">
  <div class="eyebrow">How it works</div>
  <h1 style="font-size:34px">From a crumpled receipt to a map of your spending</h1>
  <ol class="steps">
    <li><div><b>Read.</b> Long receipts are cut into tiles at blank lines so small print stays sharp. Then either Claude reads the image with your key, or Tesseract OCR runs in your browser and a rule-based parser reads the text.</div></li>
    <li><div><b>Understand.</b> A store pack turns cryptic lines like <code>KS GRK YGRT</code> into "Greek yogurt, Kirkland" and puts it in a category. Instant-savings lines (<code>/ 1234567  5.00-</code>) are folded into the item they belong to.</div></li>
    <li><div><b>Check.</b> Every receipt is reconciled: items minus discounts plus tax must equal the printed total. With Claude, a receipt that doesn't add up is read a second time. Anything still off is flagged with an editable table.</div></li>
    <li><div><b>Scrub and store.</b> Identifiers are masked and the result is saved in your browser only.</div></li>
    <li><div><b>Map.</b> The dashboard finds your staples, how often you buy them, price changes, what's running low, and where the money goes.</div></li>
  </ol>

  <h2>How accurate is it?</h2>
  <p>Measured on ${summary.privateSet.receipts} real warehouse receipts (${summary.privateSet.testItemLines} item lines in the test half), split by date: ${summary.privateSet.dev} older receipts for tuning, ${summary.privateSet.test} newer ones held out and scored once after everything was frozen. The real receipts are private and not in the repository. The receipt images were rebuilt from the digital receipts in the printed layout; "photo" adds tilt, perspective, uneven light, blur, noise and JPEG compression. The store pack only knew items from the tuning half, so names and categories on the test half had to be worked out.</p>
  <div class="card" style="padding:6px 8px"><div class="scroll" style="max-height:none"><table class="metric-table">
    <thead><tr><th>Held-out test set (${summary.privateSet.test} receipts)</th><th class="num">Claude Haiku 5.5, clean</th><th class="num">Claude Haiku 5.5, photo</th><th class="num">Free OCR, clean</th><th class="num">Free OCR, photo</th></tr></thead>
    <tbody>${rows.map(([l, f]) => `<tr><td>${l}</td><td class="num">${f(t.haiku_clean)}</td><td class="num">${f(t.haiku_photo)}</td><td class="num">${f(t.ocr_clean)}</td><td class="num">${f(t.ocr_photo)}</td></tr>`).join('')}</tbody>
  </table></div></div>
  <p class="small">When the free OCR got a receipt wrong, reconciliation flagged it ${pct(t.ocr_photo.errorsCaughtByReconciliation)} of the time on photos, so errors don't slip silently into the dashboard.</p>
  <h2>Why Haiku is the default</h2>
  <p>On the tuning half, Claude Sonnet 5.5 and Haiku 5.5 were both fully correct on every receipt (clean and photo), but Haiku cost $${d.haiku_clean.meanCostUsd.toFixed(4)} per receipt against $${d.sonnet_clean.meanCostUsd.toFixed(4)}, and took ${d.haiku_clean.meanSeconds.toFixed(1)} s against ${d.sonnet_clean.meanSeconds.toFixed(1)} s. The choice was made on the tuning half only. Sonnet is still available in Settings.</p>
  <h2>Other stores</h2>
  <p>The public synthetic set has made-up warehouse, grocery, pharmacy and hardware receipts. Claude Haiku: ${pct(summary.synthetic.haiku_photo.itemF1)} item F1 on photos. Free OCR: ${pct(summary.synthetic.ocr_photo.itemF1)} item F1, ${pct(summary.synthetic.ocr_photo.reconciliationPassRate)} of receipts reconcile. CI runs this set on every push.</p>
  <h2>Limits</h2>
  <ul>
    <li>Real phone photos can be harder than the simulated ones: creases, glare, faded thermal paper.</li>
    <li>One file is one receipt. A receipt photographed in two halves should be stitched first, or entered as two and merged by hand.</li>
    <li>The free OCR reads English only.</li>
  </ul>
  </div>`;
}
