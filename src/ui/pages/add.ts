import { MODELS, parseWithClaude, type ModelId } from '../../core/claude';
import { parseReceiptText } from '../../core/textParser';
import type { Receipt } from '../../core/types';
import { ACCEPT, fileToClaudeParts, fileToText } from '../images';
import { addReceipt, getApiKey, getSettings, saveSettings } from '../store';
import { esc, money2, niceDate } from '../util';

const SAMPLES = ['sample-warehouse.jpg', 'sample-market.jpg', 'sample-pharmacy.jpg'];

export async function renderAdd(root: HTMLElement): Promise<void> {
  const settings = await getSettings();
  const key = await getApiKey();
  const method = key ? settings.method : 'ocr';
  root.innerHTML = `
  <div class="eyebrow">Add receipts</div>
  <h1 style="font-size:34px">Drop your receipts here</h1>
  <p class="lead">Photos, screenshots or PDFs. One file per receipt. Long receipts are fine; they get split at blank lines so small print stays readable.</p>

  <div class="method" role="radiogroup" aria-label="How to read receipts">
    <label>
      <input type="radio" name="method" value="claude" ${method === 'claude' ? 'checked' : ''} ${key ? '' : 'disabled'}>
      <b>Claude, with your API key</b> <span class="pill">most accurate</span>
      <div class="small" style="margin-top:6px">${key ? `Uses ${esc(MODELS[settings.model].label)}. The image goes straight from your browser to Anthropic, about $0.002 per receipt.` : `Add your Anthropic API key in <a href="#/settings">Settings</a> first. It stays in your browser.`}</div>
    </label>
    <label>
      <input type="radio" name="method" value="ocr" ${method === 'ocr' ? 'checked' : ''}>
      <b>Free, in-browser OCR</b> <span class="pill">less accurate</span>
      <div class="small" style="margin-top:6px">Text recognition runs on your device and a rule-based parser reads it. No key, nothing uploaded. Check flagged receipts by hand.</div>
    </label>
  </div>

  <div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose receipt files">
    <h3>Drop files or click to choose</h3>
    <p class="small" style="margin:6px 0 0">JPG, PNG, WebP or PDF</p>
    <input id="file" type="file" accept="${ACCEPT}" multiple hidden>
  </div>
  <div class="row" style="margin-top:12px"><span class="small">No receipts handy? Try a made-up one:</span>${SAMPLES.map((s) => `<button class="btn" data-sample="${s}">${s.replace('sample-', '').replace('.jpg', '')}</button>`).join('')}</div>
  <div class="queue" id="queue" aria-live="polite"></div>
  <div class="row" id="done" style="margin-top:16px" hidden><a class="btn primary" href="#/">See dashboard</a><a class="btn" href="#/receipts">Review receipts</a></div>`;

  const drop = root.querySelector('#drop') as HTMLElement;
  const input = root.querySelector('#file') as HTMLInputElement;
  const queue = root.querySelector('#queue') as HTMLElement;
  const chosen = () => (root.querySelector('input[name=method]:checked') as HTMLInputElement).value as 'claude' | 'ocr';
  root.querySelectorAll('input[name=method]').forEach((r) => r.addEventListener('change', () => saveSettings({ ...settings, method: chosen() })));

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && input.click());
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files.length) run([...e.dataTransfer.files]);
  });
  input.addEventListener('change', () => input.files && run([...input.files]));
  root.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach((b) =>
    b.addEventListener('click', async () => {
      const name = b.dataset.sample!;
      const blob = await (await fetch(`${import.meta.env.BASE_URL}samples/${name}`)).blob();
      run([new File([blob], name, { type: 'image/jpeg' })]);
    }),
  );

  async function run(files: File[]) {
    const m = chosen();
    const apiKey = await getApiKey();
    const model: ModelId = settings.model;
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'qitem';
      row.innerHTML = `<span class="spinner" aria-hidden="true"></span><span class="name">${esc(file.name)}</span><span class="small st">Reading…</span>`;
      queue.prepend(row);
      const st = row.querySelector('.st') as HTMLElement;
      try {
        let r: Receipt;
        if (m === 'claude') {
          st.textContent = 'Sending to Claude…';
          const parts = await fileToClaudeParts(file);
          r = (await parseWithClaude(parts, { apiKey, model, fileName: file.name })).receipt;
        } else {
          const text = await fileToText(file, (p) => (st.textContent = `Recognizing text ${Math.round(p * 100)}%`));
          r = parseReceiptText(text, { method: 'ocr', fileName: file.name });
        }
        const res = await addReceipt(r);
        row.querySelector('.spinner')?.remove();
        if (!res.added) {
          row.innerHTML += '';
          st.innerHTML = `Already added (${esc(res.duplicateOf!.store)}, ${niceDate(res.duplicateOf!.date)}). Skipped.`;
          continue;
        }
        st.innerHTML = `${esc(r.store)} · ${niceDate(r.date)} · ${r.items.length} items · <b class="num">${money2(r.total)}</b>`;
        row.insertAdjacentHTML('beforeend', `<span class="spacer"></span>${r.reconciled ? '<span class="status ok">Adds up</span>' : `<span class="status review">Needs review</span>`}<a class="btn" href="#/receipts/${encodeURIComponent(r.id)}">${r.reconciled ? 'Open' : 'Fix'}</a>`);
      } catch (e) {
        row.querySelector('.spinner')?.remove();
        st.innerHTML = `<span style="color:var(--bad)">${esc((e as Error).message || 'Could not read this file.')}</span>`;
      }
      (root.querySelector('#done') as HTMLElement).hidden = false;
    }
  }
}
