import { applicationDefault } from 'firebase-admin/app';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AiExtractionSchema } from '@bos/schemas';
import { AuthError, requireUser } from '@/server/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/extract → reads an invoice / ticket / receipt with Gemini on Vertex AI (Google Cloud,
 * same project, EU region) and returns structured fields. No API keys: the server's own service
 * account calls Vertex. The document is sent only for this reading; nothing is stored.
 */
const Body = z.object({
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  data: z.string().min(10).max(14_000_000),
  filename: z.string().max(260).default(''),
  path: z.string().max(500).default(''),
  owner: z.object({ name: z.string().max(160).default(''), taxId: z.string().max(32).default('') }).default({ name: '', taxId: '' }),
  clients: z.array(z.string().max(120)).max(200).default([]),
});

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
const REGION = process.env.VERTEX_REGION || 'europe-west4';
const MODEL = process.env.VERTEX_MODEL || 'gemini-2.5-flash';

const schema = {
  type: 'OBJECT',
  properties: {
    documentType: { type: 'STRING', enum: ['invoice', 'simplified_invoice', 'receipt', 'social_security', 'tax_payment', 'bank', 'other'] },
    issuerName: { type: 'STRING', nullable: true },
    issuerTaxId: { type: 'STRING', nullable: true },
    customerName: { type: 'STRING', nullable: true },
    customerTaxId: { type: 'STRING', nullable: true },
    invoiceNumber: { type: 'STRING', nullable: true },
    date: { type: 'STRING', nullable: true, description: 'Issue date as YYYY-MM-DD' },
    total: { type: 'NUMBER', nullable: true, description: 'Amount actually payable, in euros (after VAT and withholding)' },
    base: { type: 'NUMBER', nullable: true, description: 'Taxable base (base imponible) in euros' },
    vatRate: { type: 'NUMBER', nullable: true, description: 'VAT percentage: 0, 4, 10 or 21' },
    vatAmount: { type: 'NUMBER', nullable: true },
    irpfRate: { type: 'NUMBER', nullable: true, description: 'IRPF withholding percentage if present' },
    isRectificativa: { type: 'BOOLEAN' },
    category: { type: 'STRING', enum: ['software', 'hardware', 'material', 'impresion', 'transporte', 'formacion', 'telefono', 'gestoria', 'publicidad', 'comidas', 'otros'] },
    currency: { type: 'STRING', nullable: true },
  },
  required: ['documentType', 'total', 'vatRate', 'isRectificativa', 'category'],
};

function prompt(b: z.infer<typeof Body>) {
  return [
    'You read Spanish business documents (invoices, simplified invoices/tickets, receipts, Seguridad Social receipts) for a freelance designer\'s bookkeeping.',
    `The freelancer is "${b.owner.name || 'the owner'}"${b.owner.taxId ? ` with NIF ${b.owner.taxId}` : ''}. If that NIF is the issuer, it is an invoice he issued; if it is the customer, it is an expense.`,
    b.clients.length ? `His clients (venues) include: ${b.clients.join(', ')}.` : '',
    b.path ? `It was stored at "${b.path}" (folder names hint month and whether it is income/GASTOS/rectificativa).` : '',
    b.filename ? `File name: "${b.filename}".` : '',
    'Rules:',
    '- Read numbers exactly as printed; Spanish format uses comma decimals ("1.234,56" = 1234.56). Return euros as plain numbers.',
    '- total = the final amount to pay (TOTAL / Importe total / A pagar). For invoices with IRPF withholding, total = base + VAT − IRPF.',
    '- vatRate: the VAT % applied (21, 10, 4 or 0). Fuel, restaurants, shops normally include VAT even on tickets ("IVA incluido"): read the rate from the VAT breakdown. If several rates, return the one with the largest base.',
    '- Seguridad Social / cuota de autónomo / RETA, taxes (AEAT), insurance premiums and bank fees have no VAT: vatRate 0 and documentType social_security / tax_payment / bank.',
    '- date = issue date (fecha de factura/emisión, or the payment date on a receipt/ticket), never the due date (vencimiento), charge date of next bill, billing period or today. Read Spanish/Catalan/English month names ("13-SEP-2026", "September 13th, 2026", "13 de setembre de 2026"). Two-digit years are 20xx. If no date is printed, return null.',
    `- Today is ${new Date().toISOString().slice(0, 10)}: a document date cannot be later than today.`,
    '- issuerName = the company that charges (O2/Telefónica, Iberdrola, Tesorería General de la Seguridad Social…). A bank that only collected the payment (BBVA, CaixaBank…) is NOT the issuer of a Seguridad Social receipt.',
    '- If the freelancer appears as "titular", "cliente" or the person billed, it is an expense (he is the customer), even if his NIF appears first.',
    '- isRectificativa = true for corrective invoices (factura rectificativa / abono) or negative totals.',
    '- Use null for anything not printed. Never invent.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function POST(req: Request) {
  try {
    await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Petición no válida' }, { status: 400 });
    if (!PROJECT) return NextResponse.json({ ok: false, error: 'Proyecto no configurado', code: 'not_configured' }, { status: 501 });
    const b = parsed.data;
    const token = (await applicationDefault().getAccessToken()).access_token;
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: b.mimeType, data: b.data } }, { text: prompt(b) }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
    });
    const call = (loc: string) =>
      fetch(`https://${loc === 'global' ? '' : `${loc}-`}aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${loc}/publishers/google/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body,
      });
    let res = await call(REGION);
    // Model not offered in the EU region yet → the global endpoint.
    if (res.status === 404) res = await call('global');
    // Busy (429) or a hiccup (5xx): wait and retry twice.
    for (let attempt = 1; attempt <= 2 && (res.status === 429 || res.status >= 500); attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      res = await call(REGION);
    }
    if (!res.ok) console.error('[extract] vertex', res.status, (await res.clone().text().catch(() => '')).slice(0, 500));
    if (res.status === 403 || res.status === 404) {
      const detail = await res.text().catch(() => '');
      const code = /SERVICE_DISABLED|has not been used|is disabled/i.test(detail) ? 'api_disabled' : 'forbidden';
      return NextResponse.json({ ok: false, code, error: code === 'api_disabled' ? 'La API de Vertex AI no está activada en el proyecto' : 'La app no tiene permiso para usar Vertex AI' }, { status: 501 });
    }
    if (!res.ok) return NextResponse.json({ ok: false, error: res.status === 429 ? 'La IA está saturada, prueba en un minuto' : `La IA no pudo leer el documento (${res.status})` }, { status: 502 });
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    let raw: unknown = {};
    try {
      raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '') || '{}');
    } catch {
      console.error('[extract] bad json', text.slice(0, 300));
      return NextResponse.json({ ok: false, error: 'La IA devolvió una respuesta incompleta' }, { status: 502 });
    }
    const data = AiExtractionSchema.safeParse(raw);
    if (!data.success) return NextResponse.json({ ok: false, error: 'Respuesta de la IA no válida' }, { status: 502 });
    return NextResponse.json({ ok: true, data: data.data });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    console.error('[extract]', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
