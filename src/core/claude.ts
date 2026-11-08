import { CATEGORIES, type Receipt } from './types';
import { coerceDraft, normalize, type DraftReceipt } from './normalize';
import { PACKS } from './packs';

export const MODELS = {
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (fast, cheapest)', inputPerM: 0.1, outputPerM: 0.5, forcedTool: true },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (larger model)', inputPerM: 2, outputPerM: 10, forcedTool: false },
} as const;
export type ModelId = keyof typeof MODELS;
export const DEFAULT_MODEL: ModelId = 'claude-sonnet-5-5';

export interface ImagePart {
  kind: 'image';
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}
export interface PdfPart {
  kind: 'pdf';
  base64: string;
}
export type ReceiptPart = ImagePart | PdfPart;

export const PROMPT_VERSION = 'v5';

export function systemPrompt(): string {
  return [
    'You transcribe shopping receipts into structured data by calling the record_receipt tool exactly once.',
    'Rules:',
    '1. Copy every printed product line, in order, including fees and deposits. Do not skip, merge or invent lines.',
    '2. raw is the line text as printed, without the item number and without the price or tax flag.',
    '3. code is the item number or SKU printed on the line, digits only, or null.',
    '4. total is the printed amount for the line, signed: a trailing or leading "-" means negative. Never recompute it.',
    '5. Coupon, instant savings, markdown and discount lines are kind "discount" with a negative total on a purchase. Set ref to the item number (or product text) the discount applies to.',
    '6. Bottle deposits, environmental or eco fees, bag fees are kind "fee". Everything else is kind "item".',
    '7. qty and unitPrice come from lines like "2 @ 3.49" or "1.234 kg @ $5.99/kg"; otherwise qty 1 and unitPrice equal to total.',
    '8. name is a short readable product name in plain English, expanding abbreviations (for example "KS GRK YGRT" becomes "Kirkland Greek yogurt"). category is one of the allowed values.',
    '9. subtotal, tax and total are the printed values. tax is the sum of all tax lines (GST, PST, HST, sales tax). If the receipt is a refund, these are negative.',
    '10. instantSavings is the printed total savings if shown, else null.',
    '11. tenders are the payment lines after the total (card, cash, gift certificate, rewards), with the amount paid by each. Never output card numbers.',
    '12. Never output membership, loyalty, customer or card numbers anywhere.',
    '13. date is YYYY-MM-DD (receipts from Canada and the US print month/day/year). time is 24h HH:MM.',
    '14. store is the store brand (for example "Costco", "Walmart"); location is the city and province or state if printed.',
    'If several images are given, they are consecutive parts of one long receipt, top to bottom, cut at blank lines. Do not repeat a line that appears twice at a cut.',
    'Store-specific notes:',
    ...PACKS.map((p) => `- ${p.storeName}: ${p.promptHints}`),
  ].join('\n');
}

export const RECEIPT_TOOL = {
  name: 'record_receipt',
  description: 'Record the transcribed receipt.',
  input_schema: {
    type: 'object',
    properties: {
      store: { type: 'string' },
      location: { type: ['string', 'null'] },
      date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      time: { type: ['string', 'null'], description: 'HH:MM, 24h' },
      kind: { type: 'string', enum: ['purchase', 'return'] },
      currency: { type: 'string', description: 'ISO code like CAD or USD' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            raw: { type: 'string' },
            code: { type: ['string', 'null'] },
            qty: { type: 'number' },
            unitPrice: { type: 'number' },
            total: { type: 'number' },
            kind: { type: 'string', enum: ['item', 'discount', 'fee'] },
            ref: { type: ['string', 'null'] },
            name: { type: 'string' },
            category: { type: 'string', enum: [...CATEGORIES] },
          },
          required: ['raw', 'total', 'kind'],
        },
      },
      subtotal: { type: ['number', 'null'] },
      tax: { type: ['number', 'null'] },
      total: { type: 'number' },
      instantSavings: { type: ['number', 'null'] },
      tenders: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            amount: { type: 'number' },
            kind: { type: 'string', enum: ['card', 'cash', 'reward', 'gift', 'other'] },
          },
          required: ['label', 'amount'],
        },
      },
    },
    required: ['store', 'lines', 'total'],
  },
} as const;

export function buildRequest(parts: ReceiptPart[], model: ModelId) {
  const content: unknown[] = parts.map((p) =>
    p.kind === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } },
  );
  content.push({ type: 'text', text: parts.length > 1 ? `These ${parts.length} images are one receipt, top to bottom. Transcribe it.` : 'Transcribe this receipt.' });
  return {
    model,
    max_tokens: 16000,
    system: systemPrompt(),
    tools: [RECEIPT_TOOL],
    // Some models only accept "auto"; the system prompt still requires exactly one tool call.
    tool_choice: MODELS[model].forcedTool ? { type: 'tool', name: 'record_receipt' } : { type: 'auto' },
    messages: [{ role: 'user', content }],
  };
}

export interface ClaudeResult {
  receipt: Receipt;
  draft: DraftReceipt;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
}

export class ClaudeError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export function costOf(model: ModelId, inputTokens: number, outputTokens: number): number {
  const p = MODELS[model];
  return (inputTokens * p.inputPerM + outputTokens * p.outputPerM) / 1e6;
}

async function callOnce(parts: ReceiptPart[], model: ModelId, apiKey: string, f: typeof fetch, signal?: AbortSignal) {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(buildRequest(parts, model)),
    });
    if (res.status !== 429 && res.status !== 529 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2));
  }
  if (!res || !res.ok) {
    let msg = `Anthropic API error ${res?.status ?? ''}`;
    try {
      const j = await res!.json();
      msg = j?.error?.message ? `${msg}: ${j.error.message}` : msg;
    } catch {
      /* ignore */
    }
    throw new ClaudeError(msg, res?.status);
  }
  const body = await res.json();
  const block = (body.content ?? []).find((c: { type: string }) => c.type === 'tool_use');
  if (!block) return { input: { lines: [] } as unknown, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
  if (body.stop_reason === 'max_tokens') throw new ClaudeError('The receipt was too long for one request. Try splitting it into two photos.');
  return { input: block.input as unknown, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
}

/**
 * Sends the receipt straight from the browser to Anthropic with the user's own key.
 * Nothing goes through a Cartograph server (there is none). If the result does not
 * add up, it asks once more and keeps the attempt that reconciles.
 */
export async function parseWithClaude(
  parts: ReceiptPart[],
  opts: { apiKey: string; model?: ModelId; fileName?: string; fetchImpl?: typeof fetch; signal?: AbortSignal; retryOnMismatch?: boolean },
): Promise<ClaudeResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const f = opts.fetchImpl ?? fetch;
  const t0 = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let best: { receipt: Receipt; draft: DraftReceipt } | null = null;
  const attempts = opts.retryOnMismatch === false ? 1 : 2;
  for (let i = 0; i < attempts; i++) {
    const r = await callOnce(parts, model, opts.apiKey, f, opts.signal);
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    const draft = coerceDraft(r.input);
    const receipt = normalize(draft, { source: { method: 'claude', model, fileName: opts.fileName } });
    if (!best || (receipt.reconciled && !best.receipt.reconciled) || (!best.receipt.items.length && receipt.items.length)) best = { receipt, draft };
    if (best.receipt.reconciled) break;
  }
  const ms = Date.now() - t0;
  const costUsd = costOf(model, inputTokens, outputTokens);
  const receipt = { ...best!.receipt, source: { ...best!.receipt.source, costUsd, ms, inputTokens, outputTokens } };
  return { receipt, draft: best!.draft, inputTokens, outputTokens, costUsd, ms };
}
