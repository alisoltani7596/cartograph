import { reconcile } from '../../core/reconcile';
import { CATEGORIES, netOf, round2, type Receipt, type ReceiptItem } from '../../core/types';
import { deleteReceipt, getReceipt, loadReceipts, putReceipt } from '../store';
import { table } from '../table';
import { armButton, esc, money2, niceDate, toast } from '../util';

export async function renderReceipts(root: HTMLElement): Promise<void> {
  const list = await loadReceipts();
  const review = list.filter((r) => !r.reconciled).length;
  root.innerHTML = `
  <div class="row"><div><div class="eyebrow">Receipts</div><h1 style="font-size:34px">${list.length} receipt${list.length === 1 ? '' : 's'}</h1></div><span class="spacer"></span><a class="btn primary" href="#/add">Add receipts</a></div>
  ${review ? `<div class="banner warn">${review} receipt${review > 1 ? 's' : ''} ${review > 1 ? "don't" : "doesn't"} add up yet. Open ${review > 1 ? 'them' : 'it'} to fix the lines by hand.</div>` : ''}
  ${list.length ? '<div class="card"><div class="scroll tall"><table id="t-r"></table></div></div>' : `<div class="card empty"><h3>No receipts yet</h3><p>Add a few and your dashboard appears. Until then, the home page shows demo data.</p><a class="btn primary" href="#/add">Add receipts</a></div>`}`;
  if (!list.length) return;
  table(root.querySelector('#t-r')!, [
    { k: 'date', h: 'Date', f: (r) => `<a href="#/receipts/${encodeURIComponent(r.id)}">${niceDate(r.date)}</a>` },
    { k: 'store', h: 'Store', f: (r) => `${esc(r.store)}${r.kind === 'return' ? ' <span class="pill">refund</span>' : ''}` },
    { k: 'items', h: 'Items', num: true, f: (r) => String(r.items.length), sv: (r) => r.items.length },
    { k: 'total', h: 'Total', num: true, f: (r) => `<span class="num">${money2(r.total)}</span>` },
    { k: 'reconciled', h: 'Status', f: (r) => (r.reconciled ? '<span class="status ok">Adds up</span>' : '<span class="status review">Needs review</span>'), sv: (r) => (r.reconciled ? 1 : 0) },
    { k: 'method', h: 'Read by', f: (r) => `<span class="small">${r.source.method === 'claude' ? 'Claude' : r.source.method === 'ocr' ? 'OCR' : esc(r.source.method)}</span>`, sv: (r) => r.source.method },
  ], list, { sort: 'date' });
}

export async function renderEditor(root: HTMLElement, id: string): Promise<void> {
  const found = await getReceipt(id);
  if (!found) {
    root.innerHTML = `<div class="card empty"><h3>Receipt not found</h3><a class="btn" href="#/receipts">Back to receipts</a></div>`;
    return;
  }
  const r: Receipt = structuredClone(found);
  root.innerHTML = `
  <a href="#/receipts" class="small">← All receipts</a>
  <div class="row" style="margin-top:6px"><h1 style="font-size:30px;margin:6px 0">${esc(r.store)}, ${niceDate(r.date)}</h1></div>
  <p class="sub">Read by ${r.source.method === 'claude' ? `Claude (${esc(r.source.model ?? '')})` : r.source.method === 'ocr' ? 'in-browser OCR' : esc(r.source.method)}${r.source.fileName ? ` from ${esc(r.source.fileName)}` : ''}${r.source.costUsd ? ` · cost $${r.source.costUsd.toFixed(4)}` : ''}. Edit anything below; the check updates as you type.</p>
  <div id="rec"></div>
  <div class="card" style="margin-top:14px">
    <div class="fields">
      <label class="field">Store<input type="text" data-f="store" value="${esc(r.store)}"></label>
      <label class="field">Date<input type="date" data-f="date" value="${esc(r.date)}"></label>
      <label class="field">Type<select data-f="kind"><option value="purchase" ${r.kind === 'purchase' ? 'selected' : ''}>Purchase</option><option value="return" ${r.kind === 'return' ? 'selected' : ''}>Refund</option></select></label>
      <label class="field">Subtotal<input type="number" step="0.01" data-f="subtotal" value="${r.subtotal ?? ''}"></label>
      <label class="field">Tax<input type="number" step="0.01" data-f="tax" value="${r.tax}"></label>
      <label class="field">Total<input type="number" step="0.01" data-f="total" value="${r.total}"></label>
    </div>
    <div class="scroll tall editor"><table><thead><tr><th>Printed text</th><th>Name</th><th>Category</th><th class="num">Qty</th><th class="num">Line total</th><th class="num">Discount</th><th class="num">Net</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody id="lines"></tbody></table></div>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="addLine">Add line</button>
      <span class="spacer"></span>
      <button class="btn danger" id="del">Delete receipt</button>
      <button class="btn primary" id="save">Save</button>
    </div>
  </div>`;
  const tbody = root.querySelector('#lines') as HTMLElement;
  const rec = root.querySelector('#rec') as HTMLElement;

  const lineRow = (it: ReceiptItem, i: number) => `<tr data-i="${i}">
    <td class="w-raw"><input type="text" data-k="raw" value="${esc(it.raw)}" aria-label="Printed text"></td>
    <td class="w-name"><input type="text" data-k="name" value="${esc(it.name)}" aria-label="Name"></td>
    <td class="w-cat"><select data-k="category" aria-label="Category">${CATEGORIES.map((c) => `<option ${c === it.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
    <td class="num w-n"><input type="number" step="any" data-k="qty" value="${it.qty}" aria-label="Quantity"></td>
    <td class="num w-n"><input type="number" step="0.01" data-k="lineTotal" value="${it.lineTotal}" aria-label="Line total"></td>
    <td class="num w-n"><input type="number" step="0.01" data-k="discount" value="${it.discount}" aria-label="Discount"></td>
    <td class="num net">${money2(netOf(it))}</td>
    <td><button class="iconbtn" data-rm="${i}" aria-label="Remove line" title="Remove line">×</button></td></tr>`;
  const drawLines = () => {
    tbody.innerHTML = r.items.map(lineRow).join('');
  };
  const drawRec = () => {
    const c = reconcile(r);
    rec.className = `recbox ${c.ok ? 'ok' : 'bad'}`;
    rec.innerHTML = c.ok
      ? `<b>Adds up.</b> Items ${money2(c.itemsNet)} + tax ${money2(r.tax)} = ${money2(r.total)}.`
      : `<div><b>Doesn't add up yet.</b><ul style="margin:6px 0 0;padding-left:18px">${c.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  };
  drawLines();
  drawRec();

  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-f]').forEach((inp) =>
    inp.addEventListener('input', () => {
      const f = inp.dataset.f!;
      if (f === 'subtotal') r.subtotal = inp.value === '' ? null : round2(+inp.value);
      else if (f === 'tax' || f === 'total') (r as unknown as Record<string, number>)[f] = round2(+inp.value || 0);
      else if (f === 'kind') r.kind = inp.value as Receipt['kind'];
      else (r as unknown as Record<string, string>)[f] = inp.value;
      drawRec();
    }),
  );
  tbody.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const tr = t.closest('tr') as HTMLElement;
    if (!tr || !t.dataset.k) return;
    const it = r.items[+tr.dataset.i!];
    const k = t.dataset.k as keyof ReceiptItem;
    if (k === 'qty' || k === 'lineTotal' || k === 'discount') {
      (it as unknown as Record<string, number>)[k] = round2(+t.value || 0);
      if (k !== 'discount') it.unitPrice = it.qty ? round2(it.lineTotal / it.qty) : it.lineTotal;
      tr.querySelector('.net')!.textContent = money2(netOf(it));
    } else (it as unknown as Record<string, string>)[k] = t.value;
    drawRec();
  });
  tbody.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-rm]') as HTMLElement | null;
    if (!b) return;
    r.items.splice(+b.dataset.rm!, 1);
    drawLines();
    drawRec();
  });
  root.querySelector('#addLine')!.addEventListener('click', () => {
    r.items.push({ raw: '', name: 'New item', category: 'Other', qty: 1, unitPrice: 0, lineTotal: 0, discount: 0 });
    drawLines();
    drawRec();
    (tbody.querySelector('tr:last-child input') as HTMLInputElement)?.focus();
  });
  root.querySelector('#save')!.addEventListener('click', async () => {
    await putReceipt({ ...r, source: { ...r.source, method: r.source.method } });
    toast('Saved');
    location.hash = '#/receipts';
  });
  armButton(root.querySelector('#del') as HTMLButtonElement, 'Click again to delete', async () => {
    await deleteReceipt(r.id);
    toast('Receipt deleted');
    location.hash = '#/receipts';
  });
}
