import type { ISODate } from '@bos/schemas';
import { MONTHS } from './dates';

/**
 * File names the way Toni names them in 00 - AÑOS:
 *   gastos:   "autonomos junio.pdf", "o2 febrero.pdf", "chatgpt marzo 1.pdf", "luz marzo.pdf",
 *             tickets → "gasto mar 26 1.jpg"
 *   ingresos: "0528 Otto JUNIO Antonio Morales (01_07_26) - Factura.pdf"
 *   rectificativas: "FR0031 Obvio MARZO Antonio Morales (31_03_26) - Factura.pdf"
 * The month in the name is the document's month (the folder it goes in).
 */

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Vendor → the word used in the file name. First match wins. */
export const EXPENSE_LABELS: { label: string; match: RegExp }[] = [
  { label: 'regularizacion cuota autonomos', match: /regularizacion.*(autonomo|cotizacion)|(autonomo|cotizacion).*regularizacion/ },
  { label: 'autonomos', match: /seguridad social|tesoreria general|\btgss\b|\breta\b|cuota (de )?autonomo|trabajadores autonomos/ },
  { label: 'hacienda', match: /agencia tributaria|\baeat\b|modelo (303|130|111|100)/ },
  { label: 'o2', match: /\bo2\b/ },
  { label: 'movistar', match: /movistar/ },
  { label: 'vodafone', match: /vodafone/ },
  { label: 'orange', match: /\borange\b/ },
  { label: 'digi', match: /\bdigi\b/ },
  { label: 'chatgpt', match: /openai|chatgpt/ },
  { label: 'claude', match: /anthropic|\bclaude\b/ },
  { label: 'adobe', match: /\badobe\b/ },
  { label: 'simpliers', match: /simpliers/ },
  { label: 'carbonmade', match: /carbonmade/ },
  { label: 'motionarray', match: /motion ?array/ },
  { label: 'envato', match: /envato/ },
  { label: 'freepik', match: /freepik/ },
  { label: 'canva', match: /\bcanva\b/ },
  { label: 'figma', match: /\bfigma\b/ },
  { label: 'google', match: /\bgoogle\b/ },
  { label: 'apple', match: /\bapple\b|icloud/ },
  { label: 'spotify', match: /spotify/ },
  { label: 'amazon', match: /\bamazon\b|\bamzn\b/ },
  { label: 'bbva estar seguro', match: /estar ?seguro/ },
  { label: 'bbva', match: /\bbbva\b/ },
  { label: 'agua', match: /\baigues\b|\bagua(s)?\b|agbar|sorea|canal de isabel|aqualia|aguas de/ },
  { label: 'gas', match: /\bgas natural\b|nedgia|\bbutano\b|naturgy.*\bgas\b|\bgas\b.*naturgy/ },
  { label: 'luz', match: /endesa|iberdrola|holaluz|som energia|naturgy|energia xxi|curenergia|octopus|electricidad|\bluz\b|lucera|factor energia/ },
  { label: 'gasolina', match: /gasolina|gasoleo|diesel|carburante|estacion de servicio|repsol|cepsa|moeve|\bbp\b|shell|galp|petronor|plenoil|ballenoil/ },
];

const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthWord = (date: ISODate) => MONTHS[Number(date.slice(5, 7)) - 1] ?? '';
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Base label for an expense, or null for generic tickets/purchases. */
export function expenseLabel(vendor: string, text = '', learned: Record<string, string> = {}): string | null {
  const key = vendorKey(vendor);
  if (key && learned[key]) return learned[key]!;
  const hay = norm(`${vendor} ${text.slice(0, 1500)}`);
  return EXPENSE_LABELS.find((l) => l.match.test(hay))?.label ?? null;
}

export const vendorKey = (vendor: string) => norm(vendor).replace(/\b(s ?l ?u?|s ?a ?u?|sociedad limitada|ltd|inc|gmbh|bv|limited|espana|spain|europe|ireland)\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** A name the user already gave (has a month word or follows the invoice convention) is kept. */
export function looksNamed(filename: string): boolean {
  const stem = norm(filename.replace(/\.[a-z0-9]+$/i, ''));
  if (/^(fr ?)?\d{3,5} [a-z]/.test(stem)) return true;
  if (/\b(factura|invoice|receipt|recibo|document|documento|scan|escaneo|img|image|whatsapp|captura|screenshot|download|descarga)\b/.test(stem)) return false;
  if (/\d{6,}/.test(stem)) return false;
  const months = [...MONTHS.map((m) => norm(m)), ...MONTH_ABBR];
  return stem.split(' ').some((w) => months.includes(w));
}

export type NameInput = {
  kind: 'expense' | 'income' | 'other';
  date: ISODate;
  ext: string;
  vendor?: string;
  text?: string;
  learned?: Record<string, string>;
  /** Income: number, client and owner for "0528 Otto JUNIO Antonio Morales (01_07_26) - Factura.pdf". */
  invoiceNumber?: string;
  clientName?: string | null;
  owner?: string;
  rectificativa?: boolean;
  originalName?: string;
};

/**
 * Proposed name. Expenses may end with "{n}" — a placeholder for the next free number in the
 * destination folder (filled when filing, see `fillSequence`).
 */
export function proposeFileName(i: NameInput): string {
  const ext = i.ext ? `.${i.ext.replace(/^\./, '').toLowerCase()}` : '';
  if (i.originalName && looksNamed(i.originalName)) return i.originalName;
  if (i.kind === 'income') {
    const [y, m, d] = i.date.split('-');
    const day = Number(d);
    // Billed in arrears: an invoice dated in the first days of the month covers the month before.
    const workMonth = day <= 10 ? (Number(m) === 1 ? 12 : Number(m) - 1) : Number(m);
    const num = (i.invoiceNumber ?? '').replace(/\s+/g, '');
    const digits = num.replace(/\D/g, '');
    const code = i.rectificativa ? `FR${digits.padStart(4, '0')}` : digits ? digits.padStart(4, '0') : num;
    const who = (i.clientName ?? '').trim() || 'Cliente';
    return `${code} ${who} ${(MONTHS[workMonth - 1] ?? '').toUpperCase()} ${i.owner || 'Antonio Morales'} (${d}_${m}_${y!.slice(2)}) - Factura${ext || '.pdf'}`.replace(/\s+/g, ' ');
  }
  if (i.kind === 'other') return i.originalName ?? `documento ${monthWord(i.date)}${ext}`;
  const label = expenseLabel(i.vendor ?? '', i.text ?? '', i.learned);
  if (label) return `${label} ${monthWord(i.date)}${ext}`;
  // Tickets and one-off purchases: "gasto mar 26 {n}.jpg"
  return `gasto ${MONTH_ABBR[Number(i.date.slice(5, 7)) - 1]} ${i.date.slice(2, 4)} {n}${ext}`;
}

/**
 * Makes a name unique among the files already in the folder, the way Toni numbers them:
 * "{n}" → next number; an existing "luz marzo.pdf" → "luz marzo 2.pdf".
 */
export function fillSequence(name: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  if (stem.includes('{n}')) {
    const prefix = stem.replace(/\s*\{n\}\s*$/, '').toLowerCase();
    const used = existing.map((n) => n.toLowerCase().replace(/\.[a-z0-9]+$/, '')).filter((n) => n.startsWith(`${prefix} `)).map((n) => Number(n.slice(prefix.length + 1))).filter((n) => Number.isFinite(n));
    let k = Math.max(0, ...used) + 1;
    while (taken.has(`${prefix} ${k}${ext}`.toLowerCase())) k++;
    return `${stem.replace(/\{n\}/, String(k))}${ext}`;
  }
  if (!taken.has(name.toLowerCase())) return name;
  for (let k = 2; ; k++) if (!taken.has(`${stem} ${k}${ext}`.toLowerCase())) return `${stem} ${k}${ext}`;
}

/** What to remember from a name the user typed: "o2 octubre 2.pdf" → "o2". */
export function labelFromName(name: string): string | null {
  const months = [...MONTHS.map((m) => norm(m)), ...MONTH_ABBR];
  const words = norm(name.replace(/\.[a-z0-9]+$/i, '')).split(' ');
  const cut = words.findIndex((w) => months.includes(w));
  const label = (cut > 0 ? words.slice(0, cut) : words.filter((w) => !/^\d+$/.test(w))).join(' ').trim();
  return label && label !== 'gasto' && label.length <= 40 ? label : null;
}

export const dateForName = (date: ISODate) => `${pad2(Number(date.slice(8, 10)))}_${date.slice(5, 7)}_${date.slice(2, 4)}`;
