import { MODELS, type ModelId } from '../../core/claude';
import { deleteEverything, exportJson, getApiKey, getSettings, importJson, loadReceipts, saveSettings, setApiKey } from '../store';
import { armButton, download, esc, toast } from '../util';

export async function renderSettings(root: HTMLElement): Promise<void> {
  const s = await getSettings();
  const key = await getApiKey();
  const n = (await loadReceipts()).length;
  root.innerHTML = `
  <div class="eyebrow">Settings</div>
  <h1 style="font-size:34px">Your key, your data</h1>
  <div class="grid2">
    <div class="card">
      <h3>Anthropic API key</h3>
      <p class="small">Used only to send receipt images from this browser straight to Anthropic. Get one at console.anthropic.com. Never sent anywhere else.</p>
      <label class="field">Key<input type="password" id="key" autocomplete="off" spellcheck="false" placeholder="sk-ant-..." value="${esc(key)}"></label>
      <label class="row small" style="margin:10px 0"><input type="checkbox" id="remember" ${s.rememberKey ? 'checked' : ''}> Remember on this device (otherwise it's forgotten when you close the tab)</label>
      <label class="field">Model<select id="model">${Object.entries(MODELS).map(([id, m]) => `<option value="${id}" ${id === s.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="saveKey">Save</button><button class="btn" id="test">Test key</button><button class="btn" id="clearKey">Forget key</button></div>
      <p class="small" id="keyMsg" role="status"></p>
    </div>
    <div class="card">
      <h3>Your receipts (${n})</h3>
      <p class="small">Stored in this browser's IndexedDB. Clearing site data or using another browser starts fresh, so export a backup now and then.</p>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="export" ${n ? '' : 'disabled'}>Export JSON</button>
        <label class="btn" for="import" style="cursor:pointer">Import JSON</label><input id="import" type="file" accept="application/json,.json" hidden>
      </div>
      <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
      <h3>Delete everything</h3>
      <p class="small">Removes all receipts, settings and your key from this browser. This can't be undone.</p>
      <button class="btn danger" id="nuke">Delete everything</button>
    </div>
  </div>`;
  const msg = root.querySelector('#keyMsg') as HTMLElement;
  const val = () => (root.querySelector('#key') as HTMLInputElement).value.trim();
  const remember = () => (root.querySelector('#remember') as HTMLInputElement).checked;
  const model = () => (root.querySelector('#model') as HTMLSelectElement).value as ModelId;
  root.querySelector('#saveKey')!.addEventListener('click', async () => {
    await setApiKey(val(), remember());
    await saveSettings({ ...s, model: model(), rememberKey: remember(), method: val() ? 'claude' : s.method });
    msg.textContent = val() ? 'Saved. New receipts will be read by Claude.' : 'Saved.';
  });
  root.querySelector('#test')!.addEventListener('click', async () => {
    msg.textContent = 'Testing…';
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': val(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: model(), max_tokens: 5, messages: [{ role: 'user', content: 'Reply OK' }] }),
      });
      msg.textContent = res.ok ? 'The key works.' : `Anthropic said: ${(await res.json())?.error?.message ?? res.status}`;
    } catch (e) {
      msg.textContent = `Could not reach Anthropic: ${(e as Error).message}`;
    }
  });
  root.querySelector('#clearKey')!.addEventListener('click', async () => {
    await setApiKey('', false);
    (root.querySelector('#key') as HTMLInputElement).value = '';
    await saveSettings({ ...s, rememberKey: false, method: 'ocr' });
    msg.textContent = 'Key forgotten.';
  });
  root.querySelector('#export')!.addEventListener('click', async () => download(`cartograph-${new Date().toISOString().slice(0, 10)}.json`, await exportJson()));
  root.querySelector('#import')!.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const r = await importJson(await f.text());
      toast(`Imported ${r.added} receipt${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped}` : ''}`);
      renderSettings(root);
    } catch (err) {
      toast((err as Error).message);
    }
  });
  armButton(root.querySelector('#nuke') as HTMLButtonElement, 'Click again to delete everything', async () => {
    await deleteEverything();
    toast('Everything deleted');
    renderSettings(root);
  });
}
