'use client';
import type { Client, DriveLayout, Invoice, IssuerSettings, Subscription } from '@bos/schemas';
import { addDays, classifyDocument, nextSheetTitle, normalizeTaxId, parseSheetDoc, parseSheetTitle, todayISO, type SheetDoc, type SheetTitle } from '@bos/domain';
import { callAction } from '@/lib/actionsClient';
import { billingFolderId, copyFile, listChildren, pdfNameForSheet, sheetPdf, sheetRows, sheetTabs, uploadTo, writeCells, type DriveItem } from '@/lib/drive';
import { pdfText, sha256 } from '@/lib/fileTools';
import { looksPaid, norm } from '@/features/inbox/drafts';

export type SheetEntry = { file: DriveItem; t: SheetTitle; source: 'facturas' | 'rectificativas' | 'albaranes' };

export const digitsOf = (s: string | null | undefined) => (s ? Number(s.replace(/\D/g, '')) || null : null);

/** Sheets in 01 - FACTURAS and 03 - RECTIFICATIVAS, newest number first. */
export async function listInvoiceSheets(account: string, layout: DriveLayout, ownerName: string): Promise<SheetEntry[]> {
  const out: SheetEntry[] = [];
  for (const [id, source] of [
    [layout.editablesId, 'facturas'],
    [layout.rectificativasId, 'rectificativas'],
  ] as const) {
    if (!id) continue;
    const kids = await listChildren(account, id);
    for (const f of kids) if (f.mimeType === 'application/vnd.google-apps.spreadsheet') out.push({ file: f, t: parseSheetTitle(f.name, ownerName), source });
  }
  return out.sort((a, b) => (b.t.date ?? '').localeCompare(a.t.date ?? '') || (digitsOf(b.t.number) ?? 0) - (digitsOf(a.t.number) ?? 0));
}

/** Matches a sheet to a client: by NIF, then by the client's name/alias inside the title ("Otto JUNIO" → Otto). */
export function clientForSheet(t: SheetTitle, doc: SheetDoc, clients: Client[]): Client | null {
  const active = clients.filter((c) => c.status !== 'archived');
  if (doc.taxId) {
    const byTax = active.find((c) => c.taxId && normalizeTaxId(c.taxId) === normalizeTaxId(doc.taxId!));
    if (byTax) return byTax;
  }
  const hay = ` ${norm(t.label)} ${norm(doc.recipients[0] ?? '')} ${norm(doc.project ?? '')} `;
  let best: { c: Client; len: number } | null = null;
  for (const c of active)
    for (const n of [c.name, c.legalName, ...c.aliases].filter((x): x is string => !!x && x.length >= 3)) {
      const nn = norm(n);
      if (hay.includes(` ${nn} `) && (!best || nn.length > best.len)) best = { c, len: nn.length };
    }
  return best?.c ?? null;
}

const MONTH_WORD = /^(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\.?$/i;
/** "Descarada ABR MAY JUN JUL" → "Descarada" (name for a new client). */
export const labelName = (label: string) => label.split(/\s+/).filter((w) => !MONTH_WORD.test(w) && !/^20\d{2}$/.test(w)).join(' ').trim() || label;

type Ctx = { account: string; layout: DriveLayout; clients: Client[]; subs: Subscription[]; issuer: IssuerSettings | null };

/**
 * Exports a sheet's "Factura" tab to PDF into 00 - AÑOS/<year>/<month>/INGRESOS (or Rectificativas),
 * with the same name Sheets would give it, and registers the invoice in Facturación with the exact
 * figures from the sheet. Already exported (same name in that folder) → it's reused, not duplicated.
 */
export async function exportAndRegister(entry: SheetEntry, ctx: Ctx): Promise<{ invoiceNumber: string; folder: string; reused: boolean }> {
  const { account, layout } = ctx;
  const rows = await sheetRows(account, entry.file.id);
  const doc = parseSheetDoc(rows);
  const date = doc.date ?? entry.t.date ?? todayISO();
  const rect = entry.t.rectificativa || entry.source === 'rectificativas' || (doc.total ?? 0) < 0;
  const tabs = await sheetTabs(account, entry.file.id);
  const tab = tabs.find((x) => /factura|rectific/i.test(x.title)) ?? tabs[0]!;
  const name = pdfNameForSheet(entry.file.name, tab.title);
  const folder = await billingFolderId(account, layout, date, 'income', rect);
  const there = (await listChildren(account, folder.id)).find((f) => f.name === name);
  const pdf = await sheetPdf(account, entry.file.id, tab.gid);
  const file = new File([pdf], name, { type: 'application/pdf' });
  const ref = there
    ? { account, fileId: there.id, name: there.name, folder: folder.label, folderId: folder.id, webViewLink: there.webViewLink ?? `https://drive.google.com/file/d/${there.id}/view`, filed: true, keepName: true }
    : { ...(await uploadTo(account, file, name, folder)), filed: true, keepName: true };

  const text = await pdfText(file).catch(() => '');
  const invoiceNumber = entry.t.number ?? doc.number ?? entry.file.name.slice(0, 20);
  const total = Math.abs(doc.total ?? 0);
  const proposal = classifyDocument(
    { filename: name, mimeType: 'application/pdf', text, path: `${date.slice(0, 4)}/INGRESOS/${name}` },
    { issuer: { name: ctx.issuer?.name ?? '', legalName: ctx.issuer?.legalName ?? '', taxId: ctx.issuer?.taxId ?? '' }, clients: ctx.clients, subscriptions: ctx.subs, today: todayISO() },
  );
  const { id } = await callAction<{ id: string }>('inbox.create', {
    filename: name.slice(0, 250),
    mimeType: 'application/pdf',
    size: file.size,
    sha256: await sha256(file),
    storagePath: null,
    sourcePath: `Drive/${entry.source}/${entry.file.name}`.slice(0, 500),
    textExcerpt: text.slice(0, 20000),
    proposal: {
      ...proposal,
      kind: { value: 'income', confidence: 1, reason: 'Hoja de factura' },
      invoiceNumber: { value: invoiceNumber, confidence: 1, reason: 'Hoja de factura' },
      date: { value: date, confidence: 1, reason: 'Hoja de factura' },
      total: { value: total, confidence: 1, reason: 'Hoja de factura' },
      rectificativa: rect,
    },
  });
  await callAction('inbox.attachDrive', { id, drive: ref });
  const client = clientForSheet(entry.t, doc, ctx.clients);
  await callAction('inbox.confirm', {
    id,
    kind: 'income',
    date,
    vendor: doc.recipients[0] ?? '',
    taxId: doc.taxId ?? '',
    invoiceNumber,
    total,
    vatRate: doc.vatRate ?? 21,
    irpfRate: doc.irpfRate ?? 0,
    clientId: client?.id ?? null,
    newClient: client ? null : { name: labelName(entry.t.label), taxId: doc.taxId ?? '', legalName: doc.recipients[0] ?? '' },
    concept: name,
    rectificativa: rect,
    paid: looksPaid(date, todayISO()),
  });
  return { invoiceNumber, folder: folder.label, reused: !!there };
}

/** Next free number across the sheets and the invoices in the app, keeping the 4-digit style. */
export function nextNumber(sheets: SheetEntry[], invoices: Invoice[], issuerNext?: number): string {
  const nums = [...sheets.filter((s) => s.source === 'facturas').map((s) => digitsOf(s.t.number)), ...invoices.filter((i) => i.total >= 0).map((i) => digitsOf(i.invoiceNumber))].filter((n): n is number => !!n && n < 100000);
  const n = Math.max(0, ...nums, (issuerNext ?? 1) - 1) + 1;
  return String(n).padStart(4, '0');
}

export const firstOfMonth = (d = todayISO()) => `${d.slice(0, 7)}-01`;
export const prevMonth = (d: string) => Number(addDays(`${d.slice(0, 7)}-01`, -1).slice(5, 7));

/**
 * Copies a sheet (last month's invoice for that client) next to it with the next number and date,
 * and writes number and date into the sheet. You then change lines and amounts in Sheets as always.
 */
export async function duplicateSheet(account: string, entry: SheetEntry, opts: { number: string; date: string; workMonth: number; ownerName: string; albaran?: boolean }): Promise<{ id: string; name: string; url: string }> {
  const name = nextSheetTitle(entry.t, { number: opts.number, date: opts.date, workMonth: opts.workMonth, ownerName: opts.ownerName, albaran: opts.albaran });
  const parent = entry.file.parents?.[0];
  if (!parent) throw new Error('No se encuentra la carpeta de la hoja');
  const copy = await copyFile(account, entry.file.id, name, parent);
  const rows = await sheetRows(account, copy.id);
  const doc = parseSheetDoc(rows);
  const tabs = await sheetTabs(account, copy.id);
  const tab = tabs[0]!.title.replace(/'/g, "''");
  const [y, m, d] = opts.date.split('-');
  const cells: Record<string, string> = {};
  if (doc.numberCell && !opts.albaran) cells[`'${tab}'!${doc.numberCell}`] = String(Number(opts.number.replace(/\D/g, '')));
  if (doc.dateCell) cells[`'${tab}'!${doc.dateCell}`] = `${d}/${m}/${y}`;
  if (Object.keys(cells).length) await writeCells(account, copy.id, cells);
  return { id: copy.id, name, url: `https://docs.google.com/spreadsheets/d/${copy.id}/edit` };
}
