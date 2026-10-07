import type { Client, ID, InboxKind, InboxProposal, ISODate, Subscription } from '@bos/schemas';
import { parseEuro, splitVat } from './money';

/**
 * Rule-based document classifier (no AI). Reads the text of a PDF (or just the file name for
 * images) and proposes: income vs expense, vendor, tax id, date, invoice number, amounts, VAT,
 * client and category, each with a confidence. Never invents: unknown → null with confidence 0.
 */

export interface ClassifyContext {
  issuer: { name: string; legalName: string; taxId: string };
  clients: readonly Pick<Client, 'id' | 'name' | 'legalName' | 'taxId' | 'aliases' | 'status'>[];
  subscriptions: readonly Pick<Subscription, 'id' | 'name' | 'vendor'>[];
  today: ISODate;
}

export interface ClassifyInput {
  filename: string;
  mimeType: string;
  text: string;
  /** Relative path when the file came inside a folder, e.g. "2026/03 MARZO/Ingresos/f.pdf". */
  path?: string;
}

/* ---------- hints from the folder the file came in ---------- */

export interface PathHints {
  kind: 'income' | 'expense' | null;
  rectificativa: boolean;
  year: number | null;
  month: number | null;
}

const MONTH_WORDS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/** Reads "2026/03 MARZO/Gastos/…" style paths (only the folders, not the file name). */
export function pathHints(path: string | undefined): PathHints {
  const out: PathHints = { kind: null, rectificativa: false, year: null, month: null };
  if (!path) return out;
  const folders = path.split(/[\\/]/).slice(0, -1).map((f) => norm(f));
  for (const f of folders) {
    if (/rectificativ|abono/.test(f)) out.rectificativa = true;
    if (/ingreso|emitid|ventas?\b|clientes/.test(f)) out.kind = 'income';
    else if (/gasto|recibid|compras?\b|proveedor|tickets?\b/.test(f)) out.kind = 'expense';
    const y = f.match(/\b(20\d{2})\b/);
    if (y) out.year = Number(y[1]);
    const word = Object.keys(MONTH_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(f));
    if (word) out.month = MONTH_WORDS[word]!;
    else {
      const m = f.match(/^(0?[1-9]|1[0-2])(?:\s|[-_.]|$)/);
      if (m && !y) out.month = Number(m[1]);
    }
  }
  if (out.rectificativa && !out.kind) out.kind = 'income';
  return out;
}

type Guess<T> = { value: T | null; confidence: number; reason: string };
const none = <T>(reason = ''): Guess<T> => ({ value: null, confidence: 0, reason });
const guess = <T>(value: T, confidence: number, reason: string): Guess<T> => ({ value, confidence, reason });

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/* ---------- known vendors → category ---------- */

export const KNOWN_VENDORS: { name: string; match: RegExp; category: string }[] = [
  { name: 'Adobe', match: /\badobe\b/, category: 'software' },
  { name: 'Apple', match: /\bapple\b|itunes|icloud/, category: 'software' },
  { name: 'Google', match: /\bgoogle\b|workspace/, category: 'software' },
  { name: 'Microsoft', match: /\bmicrosoft\b|office 365/, category: 'software' },
  { name: 'Canva', match: /\bcanva\b/, category: 'software' },
  { name: 'Figma', match: /\bfigma\b/, category: 'software' },
  { name: 'Envato', match: /\benvato\b/, category: 'software' },
  { name: 'Freepik', match: /\bfreepik\b/, category: 'software' },
  { name: 'Shutterstock', match: /\bshutterstock\b/, category: 'software' },
  { name: 'Dropbox', match: /\bdropbox\b/, category: 'software' },
  { name: 'OpenAI', match: /\bopenai\b|chatgpt/, category: 'software' },
  { name: 'Anthropic', match: /\banthropic\b/, category: 'software' },
  { name: 'Midjourney', match: /\bmidjourney\b/, category: 'software' },
  { name: 'Spotify', match: /\bspotify\b/, category: 'otros' },
  { name: 'Netflix', match: /\bnetflix\b/, category: 'otros' },
  { name: 'IONOS', match: /\bionos\b|1&1/, category: 'software' },
  { name: 'Hostinger', match: /\bhostinger\b/, category: 'software' },
  { name: 'GoDaddy', match: /\bgodaddy\b/, category: 'software' },
  { name: 'Amazon', match: /\bamazon\b|\bamzn\b/, category: 'material' },
  { name: 'MediaMarkt', match: /media\s?markt/, category: 'hardware' },
  { name: 'PcComponentes', match: /pc\s?componentes/, category: 'hardware' },
  { name: 'Fnac', match: /\bfnac\b/, category: 'hardware' },
  { name: 'El Corte Inglés', match: /corte ingles/, category: 'material' },
  { name: 'IKEA', match: /\bikea\b/, category: 'material' },
  { name: 'Leroy Merlin', match: /leroy merlin/, category: 'material' },
  { name: 'Vistaprint', match: /\bvistaprint\b/, category: 'impresion' },
  { name: 'Pixartprinting', match: /pixart\s?printing/, category: 'impresion' },
  { name: 'Movistar', match: /\bmovistar\b|telefonica/, category: 'telefono' },
  { name: 'Vodafone', match: /\bvodafone\b/, category: 'telefono' },
  { name: 'Orange', match: /\borange\b/, category: 'telefono' },
  { name: 'Digi', match: /\bdigi\b/, category: 'telefono' },
  { name: 'Renfe', match: /\brenfe\b/, category: 'transporte' },
  { name: 'Cabify', match: /\bcabify\b/, category: 'transporte' },
  { name: 'Uber', match: /\buber\b/, category: 'transporte' },
  { name: 'Repsol', match: /\brepsol\b/, category: 'transporte' },
  { name: 'Cepsa', match: /\bcepsa\b|moeve/, category: 'transporte' },
  { name: 'Correos', match: /\bcorreos\b/, category: 'otros' },
];

/* ---------- extractors ---------- */

const TAX_ID = /\b(?:ES)?([A-HJ-NP-SUVW]-?\d{7}-?[0-9A-J]|\d{8}-?[A-Z]|[XYZ]-?\d{7}-?[A-Z])\b/g;
const EU_VAT = /\b(IE\d{7}[A-Z]{1,2}|LU\d{8}|NL\d{9}B\d{2}|DE\d{9}|FR[A-Z0-9]{2}\d{9})\b/g;

export function normalizeTaxId(s: string): string {
  return s.toUpperCase().replace(/[\s.-]/g, '').replace(/^ES(?=[A-Z0-9]{9}$)/, '');
}

/** Tax ids in order of appearance (the first one is usually the issuer). */
export function findTaxIds(text: string): string[] {
  const found: { at: number; id: string }[] = [];
  const up = text.toUpperCase();
  for (const m of up.matchAll(TAX_ID)) found.push({ at: m.index ?? 0, id: normalizeTaxId(m[1]!) });
  for (const m of up.matchAll(EU_VAT)) found.push({ at: m.index ?? 0, id: m[1]! });
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.id))];
}

const MONTHS_ES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
function validDate(y: number, m: number, d: number): ISODate | null {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** All dates found, in order of appearance. */
export function findDates(text: string): ISODate[] {
  const out: ISODate[] = [];
  const t = norm(text);
  for (const m of t.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b|\b(\d{1,2})\s+(?:de\s+)?([a-z]{3,10})\.?\s+(?:de\s+)?(\d{4})\b/g)) {
    let d: ISODate | null = null;
    if (m[1]) d = validDate(+m[1], +m[2]!, +m[3]!);
    else if (m[4]) d = validDate(+m[6]!, +m[5]!, +m[4]);
    else if (m[7]) {
      const month = MONTHS_ES[m[8]!] ?? MONTHS_ES[m[8]!.slice(0, 3)];
      if (month) d = validDate(+m[9]!, month, +m[7]);
    }
    if (d) out.push(d);
  }
  return out;
}

const AMOUNT = /(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:[.,]\d{2}))\s*(?:€|eur\b)?/gi;

function amountsIn(line: string): number[] {
  return [...line.matchAll(AMOUNT)].map((m) => parseEuro(m[1]!)).map((x) => (x === null ? null : Math.abs(x))).filter((x): x is number => x !== null && x > 0);
}

/** Best "total" amount: last amount on lines that say total (not subtotal/base), else the largest € amount. */
export function findTotal(text: string): Guess<number> {
  const lines = text.split(/\r?\n/);
  const candidates: number[] = [];
  lines.forEach((line, i) => {
    const n = norm(line);
    if (/\b(total|importe total|total factura|total a pagar|a pagar|amount due|grand total)\b/.test(n) && !/\b(sub\s?total|base|total iva|total impuestos)\b/.test(n)) {
      const here = amountsIn(line);
      const next = here.length ? here : amountsIn(lines[i + 1] ?? '');
      if (next.length) candidates.push(next[next.length - 1]!);
    }
  });
  if (candidates.length) return guess(Math.max(...candidates), 0.85, 'Línea de total');
  const all = lines.filter((l) => /€|eur/i.test(l)).flatMap(amountsIn);
  if (all.length) return guess(Math.max(...all), 0.5, 'Mayor importe en euros del documento');
  return none('No se encontró ningún importe');
}

export function findBase(text: string): number | null {
  for (const line of text.split(/\r?\n/)) {
    const n = norm(line);
    if (/\b(base imponible|subtotal|base)\b/.test(n)) {
      const a = amountsIn(line);
      if (a.length) return a[a.length - 1]!;
    }
  }
  return null;
}

export function findVatRate(text: string): Guess<number> {
  const t = norm(text);
  const m = t.match(/\b(?:iva|vat|igic)\b[^%\n]{0,20}?(\d{1,2}(?:[.,]\d)?)\s*%/) ?? t.match(/(\d{1,2})\s*%\s*(?:de\s+)?(?:iva|vat)/);
  if (m) {
    const r = Number(m[1]!.replace(',', '.'));
    if ([0, 4, 5, 10, 21, 20, 23].includes(r)) return guess(r, 0.9, `Pone IVA ${r} %`);
  }
  if (/\bexento\b|exenta de iva|inversion del sujeto pasivo|reverse charge/.test(t)) return guess(0, 0.8, 'Documento exento de IVA');
  return guess(21, 0.4, 'IVA general por defecto');
}

export function findIrpf(text: string): Guess<number> {
  const t = norm(text);
  const m = t.match(/\b(?:irpf|retencion)\b[^%\n]{0,20}?(\d{1,2})\s*%/);
  if (m) return guess(Number(m[1]), 0.9, `Retención IRPF ${m[1]} %`);
  return guess(0, 0.5, 'Sin retención');
}

export function findInvoiceNumber(text: string): Guess<string> {
  const m = text.match(/(?:n[º°o.]\s*(?:de\s+)?factura|factura\s*(?:n[º°o.]|num(?:ero)?\.?|#)|n[uú]mero\s+de\s+factura|invoice\s*(?:number|no\.?|#))\s*[:#]?\s*([A-Z0-9][A-Z0-9/\-_.]{2,30})/i);
  return m ? guess(m[1]!.replace(/[.,]$/, ''), 0.8, 'Número de factura indicado') : none();
}

const LEGAL_FORM = /\b(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?c\.?\s?p?\.?|s\.?\s?coop|sociedad|limitada|associacio|asociacion|fundacio|fundacion|c\.?\s?b\.?)$/;
const NOT_A_NAME = /cif|nif|dni|n\.i\.f|c\.i\.f|calle|c\/|avda|avinguda|avenida|plaza|pla[cç]a|passeig|paseo|tel[eé]?f?|tlf|m[oó]vil|e-?mail|@|www\.|\bcp\b|\d{5}|fecha|date|factura|invoice|n[ºo°]|iban|total|base|iva|concepto|descripci/i;

/** Name of the other party (the client on your invoices, the vendor on received ones). */
export function findCounterparty(text: string, taxId: string | null): Guess<string> {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const labelled = text.match(/(?:cliente|facturar a|datos del cliente|bill to|destinatario|receptor)\s*:?\s*\n?\s*([^\n]{3,80})/i);
  if (labelled) {
    const v = labelled[1]!.replace(/\s{2,}/g, ' ').trim();
    if (v && !NOT_A_NAME.test(v)) return guess(v, 0.8, 'Indicado como cliente');
  }
  if (taxId) {
    const at = lines.findIndex((l) => normalizeTaxId(l).includes(taxId));
    if (at >= 0) {
      const window = [at, at - 1, at - 2, at - 3, at + 1].filter((i) => i >= 0 && i < lines.length);
      const sameLine = lines[at]!.replace(/(?:CIF|NIF|DNI|N\.I\.F\.?|C\.I\.F\.?)\s*:?\s*\S+/gi, '').replace(/[\s,;:·-]+$/, '').trim();
      for (const i of window) {
        const l = i === at ? sameLine : lines[i]!;
        if (l.length >= 3 && l.length <= 80 && LEGAL_FORM.test(norm(l))) return guess(l.replace(/\s{2,}/g, ' '), 0.85, 'Razón social junto al NIF');
      }
      for (const i of window) {
        const l = i === at ? sameLine : lines[i]!;
        if (l.length >= 3 && l.length <= 60 && /[A-Za-zÁÉÍÓÚÑÇ]{3}/.test(l) && !NOT_A_NAME.test(l)) return guess(l.replace(/\s{2,}/g, ' '), 0.6, 'Nombre junto al NIF');
      }
    }
  }
  return none();
}

const MONTH_ABBR: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const MONTH_IN_NAME = /(?:^|[^a-z])(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)(?:[^a-z]|$)\s*(\d{4}|\d{2}(?!\d))?/;

/** "gasto nov 25 1.jpg" → nov 2025; "chatgpt enero 1.pdf" in 2026/… → ene 2026. */
export function monthInName(filename: string, hints: Pick<PathHints, 'year' | 'month'>): { year: number; month: number } | null {
  const m = norm(filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')).match(MONTH_IN_NAME);
  if (!m) return null;
  const month = MONTH_WORDS[m[1]!] ?? MONTH_ABBR[m[1]!];
  if (!month) return null;
  let year = m[2] ? (m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])) : hints.year;
  if (!year) return null;
  // "dic" inside 2026/01 ENERO without a year → December of the year before.
  if (!m[2] && hints.month && month > hints.month) year -= 1;
  return { year, month };
}

function invoiceNumber(text: string, filename: string): Guess<string> {
  const found = findInvoiceNumber(text);
  if (found.value) return found;
  const stem = filename.replace(/\.[a-z0-9]+$/i, '').trim();
  if (MONTH_IN_NAME.test(norm(stem.replace(/[_-]+/g, ' ')))) return found;
  // "F2026-011", "Factura 34", "2026_015 City Hall" → use the file name when it carries a number.
  const m = stem.match(/(?:factura|fra\.?|fact\.?)?\s*([A-Z]{0,4}[-_ ]?\d{1,4}(?:[-_/]\d{1,5})?)/i);
  if (m && /\d/.test(m[1]!) && !/\d{4}-\d{2}-\d{2}|whatsapp|img[-_ ]\d|scan/i.test(stem)) return guess(m[1]!.trim().replace(/_/g, '-'), 0.45, 'Sacado del nombre del archivo');
  return found;
}

/* ---------- main ---------- */

export function classifyDocument(input: ClassifyInput, ctx: ClassifyContext): InboxProposal {
  const text = input.text ?? '';
  const t = norm(text);
  const fname = norm(input.filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '));
  const hay = `${t}\n${fname}`;
  const hints = pathHints(input.path);
  const taxIds = findTaxIds(text);
  // Without your NIF in Ajustes, a file in an "Ingresos" folder tells us the first NIF is yours.
  const issuerTax = normalizeTaxId(ctx.issuer.taxId || '') || (hints.kind === 'income' && taxIds.length > 1 ? taxIds[0]! : '');

  /* client (by tax id, then by name/alias as whole words) */
  let client: Guess<ID> = none();
  for (const c of ctx.clients) {
    if (c.status === 'archived') continue;
    if (c.taxId && taxIds.includes(normalizeTaxId(c.taxId))) {
      client = guess(c.id, 0.95, `NIF de ${c.name}`);
      break;
    }
  }
  if (!client.value) {
    let best: { id: ID; len: number; name: string } | null = null;
    for (const c of ctx.clients) {
      if (c.status === 'archived') continue;
      for (const n of [c.name, c.legalName, ...c.aliases].filter((x): x is string => !!x && x.length >= 3)) {
        const nn = norm(n);
        if (new RegExp(`(^|[^a-z0-9])${nn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(hay) && (!best || nn.length > best.len)) {
          best = { id: c.id, len: nn.length, name: c.name };
        }
      }
    }
    if (best) client = guess(best.id, 0.7, `Aparece «${best.name}»`);
  }

  /* kind */
  let kind: Guess<InboxKind>;
  const looksLikeInvoice = /\bfactura\b|\binvoice\b|\bticket\b|\brecibo\b|\breceipt\b|factura simplificada/.test(hay);
  const issuerFirst = issuerTax && taxIds[0] === issuerTax;
  const issuerName = norm(ctx.issuer.legalName || ctx.issuer.name || '');
  const issuerNameNearTop = issuerName.length > 3 && norm(text.split(/\r?\n/).slice(0, 8).join(' ')).includes(issuerName);
  if (hints.kind) {
    kind = guess<InboxKind>(hints.kind, 0.95, hints.rectificativa ? 'Carpeta de rectificativas' : `Carpeta de ${hints.kind === 'income' ? 'ingresos' : 'gastos'}`);
  } else if (issuerFirst || (issuerTax && taxIds.includes(issuerTax) && client.value && issuerNameNearTop)) {
    kind = guess<InboxKind>('income', issuerFirst ? 0.9 : 0.75, 'Tu NIF aparece como emisor');
  } else if (/\bticket\b|factura simplificada|\brecibo\b|\breceipt\b|whatsapp image/.test(hay)) {
    kind = guess<InboxKind>('expense', 0.85, 'Ticket o recibo de compra');
  } else if (looksLikeInvoice && issuerTax && taxIds.includes(issuerTax)) {
    kind = guess<InboxKind>('expense', 0.85, 'Factura a tu nombre de otro emisor');
  } else if (looksLikeInvoice) {
    kind = guess<InboxKind>(client.value && !taxIds.length ? 'income' : 'expense', 0.6, client.value ? 'Factura que menciona un cliente' : 'Parece una factura recibida');
  } else if (/\.(jpe?g|png|heic|webp)$/i.test(input.filename)) {
    kind = guess<InboxKind>('expense', 0.5, 'Foto: probablemente un ticket');
  } else {
    kind = guess<InboxKind>('other', 0.4, 'No parece una factura ni un ticket');
  }
  if (kind.value === 'expense' && client.confidence < 0.9) client = none();

  /* vendor (for expenses) */
  let vendor: Guess<string> = none();
  const known = KNOWN_VENDORS.find((v) => v.match.test(hay));
  const sub = ctx.subscriptions.find((s) => [s.vendor, s.name].some((n) => n && n.length >= 3 && hay.includes(norm(n))));
  if (known) vendor = guess(known.name, 0.9, 'Proveedor conocido');
  else if (sub) vendor = guess(sub.vendor || sub.name, 0.85, 'Coincide con una suscripción');
  else if (kind.value === 'expense') {
    const first = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length >= 3 && l.length <= 60 && /[A-Za-zÁÉÍÓÚÑ]{3}/.test(l) && !/factura|invoice|ticket|fecha|date|n[ºo]/i.test(l));
    if (first) vendor = guess(first.replace(/\s{2,}/g, ' '), 0.4, 'Primera línea del documento');
  }

  /* tax id of the other party */
  const otherTax = taxIds.find((x) => x !== issuerTax) ?? null;
  const taxId: Guess<string> = otherTax ? guess(otherTax, 0.8, 'NIF/CIF en el documento') : none();
  const counterparty = findCounterparty(text, otherTax);
  // An income invoice whose client NIF we don't know yet: still say who it is.
  if (kind.value === 'income' && !client.value && otherTax) {
    const byTax = ctx.clients.find((c) => c.taxId && normalizeTaxId(c.taxId) === otherTax);
    if (byTax) client = guess(byTax.id, 0.95, `NIF de ${byTax.name}`);
  }
  if (kind.value === 'expense' && vendor.confidence < 0.85 && counterparty.value) vendor = guess(counterparty.value, counterparty.confidence * 0.8, counterparty.reason);

  /* date: prefer one on a line saying "fecha"; else first; else from file name */
  let date: Guess<ISODate> = none('Sin fecha');
  const folderDate = hints.year && hints.month ? `${hints.year}-${pad(hints.month)}-01` : null;
  const fechaLine = text.split(/\r?\n/).find((l) => /fecha|date|emisi[oó]n/i.test(l) && findDates(l).length);
  const dates = findDates(text);
  const fileDates = findDates(input.filename.replace(/[_]/g, '-'));
  const nameMonth = monthInName(input.filename, hints);
  if (fechaLine) date = guess(findDates(fechaLine)[0]!, 0.9, 'Línea de fecha');
  else if (dates.length) date = guess(dates[0]!, 0.7, 'Primera fecha del documento');
  else if (fileDates.length) date = guess(fileDates[0]!, 0.6, 'Fecha en el nombre del archivo');
  else if (nameMonth) date = guess(`${nameMonth.year}-${pad(nameMonth.month)}-01`, 0.5, 'Mes en el nombre del archivo');
  else if (folderDate) date = guess(folderDate, 0.4, 'Mes de la carpeta');
  // A date far from the folder's month is probably a due date or a service date: prefer the folder month.
  if (folderDate && date.value && date.value.slice(0, 7) !== folderDate.slice(0, 7) && date.confidence < 0.9) {
    const inMonth = dates.find((d) => d.startsWith(folderDate.slice(0, 7)));
    if (inMonth) date = guess(inMonth, 0.85, 'Fecha del mes de la carpeta');
  }

  /* amounts */
  const total = findTotal(text);
  const vatRate = findVatRate(text);
  const irpfRate = kind.value === 'income' ? findIrpf(text) : guess(0, 0.6, 'Gasto sin retención');
  const baseFound = findBase(text);
  let base: Guess<number> = none();
  if (baseFound !== null) base = guess(baseFound, 0.8, 'Base imponible indicada');
  else if (total.value !== null && vatRate.value !== null) base = guess(splitVat(total.value, vatRate.value).base, Math.min(total.confidence, vatRate.confidence), 'Calculada desde el total');

  const category: Guess<string> = kind.value === 'expense' ? (known ? guess(known.category, 0.8, `${known.name} → ${known.category}`) : guess('otros', 0.3, 'Sin categoría clara')) : none();
  const subscriptionId: Guess<ID> = sub && kind.value === 'expense' ? guess(sub.id, 0.75, `Cobro de ${sub.name}`) : none();

  return {
    kind: kind as InboxProposal['kind'],
    date,
    vendor,
    taxId,
    invoiceNumber: invoiceNumber(text, input.filename),
    total,
    base,
    vatRate,
    irpfRate,
    clientId: client,
    category,
    subscriptionId,
    counterparty,
    rectificativa: hints.rectificativa || /\bfactura rectificativa\b|\babono\b/.test(t),
  };
}

/** Suggested file name: 2026-07-17_MEDIAMARKT_49,99.pdf */
export function suggestFilename(p: Pick<InboxProposal, 'date' | 'vendor' | 'total' | 'kind'>, clientName: string | null, ext: string): string {
  const who = (p.kind.value === 'income' ? clientName : p.vendor.value) ?? 'documento';
  const slug = who
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
  const amount = p.total.value !== null ? `_${(p.total.value / 100).toFixed(2).replace('.', ',')}` : '';
  return `${p.date.value ?? 'sin-fecha'}_${slug}${amount}${ext ? `.${ext.replace(/^\./, '')}` : ''}`;
}
