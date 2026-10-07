import type { ISODate } from '@bos/schemas';
import { parseEuro } from './money';

/**
 * Reading Toni's invoice / albarán Google Sheets (exported as CSV rows). Labels sit in one row and
 * their value in the row below ("N.º de factura" → 528, "Fecha" → 1/07/2026); lines run from the
 * "Descripción" header to "Base imponible".
 */

export type SheetTitle = { prefix: string; number: string | null; label: string; date: ISODate | null; rectificativa: boolean; albaran: boolean };

const pad = (n: number) => String(n).padStart(2, '0');

function dmy(s: string): ISODate | null {
  const m = s.match(/(\d{1,2})[/_.-](\d{1,2})[/_.-](\d{2,4})/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const mo = Number(m[2]);
  const d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** "0528 Otto JUNIO Antonio Morales (01/07/26)" → number 0528, label "Otto JUNIO", date 2026-07-01. */
export function parseSheetTitle(title: string, ownerName = 'Antonio Morales'): SheetTitle {
  let t = title.trim();
  const date = dmy(t.match(/\(([^)]*)\)\s*$/)?.[1] ?? '');
  t = t.replace(/\s*\([^)]*\)\s*$/, '');
  const albaran = /^alb(aran|arán)?\b|^alb[-\s]?\d/i.test(t);
  const num = t.match(/^(FR|R|ALB-?|A)?\s?(\d{2,6})\b\s*/i);
  const prefix = (num?.[1] ?? '').toUpperCase().replace(/-$/, '');
  const number = num ? `${prefix === 'ALB' ? '' : prefix}${num[2]}` : null;
  if (num) t = t.slice(num[0].length);
  t = t.replace(/^albar[aá]n\s+/i, '');
  if (ownerName) t = t.replace(new RegExp(`\\s*${ownerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '');
  return { prefix, number, label: t.trim(), date, rectificativa: prefix === 'FR' || prefix === 'R', albaran };
}

export type SheetDoc = {
  number: string | null;
  numberCell: string | null;
  date: ISODate | null;
  dateCell: string | null;
  recipients: string[];
  taxId: string | null;
  project: string | null;
  lines: { concept: string; quantity: number; unitPrice: number; total: number }[];
  base: number | null;
  vatRate: number | null;
  vat: number | null;
  irpfRate: number | null;
  irpf: number | null;
  total: number | null;
};

const col = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const a1 = (row: number, c: number) => `${col(c)}${row + 1}`;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();
const money = (s: string | undefined) => (s ? parseEuro(s.replace(/€/g, '').trim()) : null);

function findCell(rows: string[][], test: (n: string) => boolean): [number, number] | null {
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < (rows[r]?.length ?? 0); c++) if (test(norm(rows[r]![c] ?? ''))) return [r, c];
  return null;
}

/** First non-empty cell to the right of (r, c). */
function rightOf(rows: string[][], r: number, c: number): string | undefined {
  const row = rows[r] ?? [];
  for (let k = c + 1; k < row.length; k++) if (row[k]?.trim()) return row[k];
  return undefined;
}

export function parseSheetDoc(rows: string[][]): SheetDoc {
  const out: SheetDoc = { number: null, numberCell: null, date: null, dateCell: null, recipients: [], taxId: null, project: null, lines: [], base: null, vatRate: null, vat: null, irpfRate: null, irpf: null, total: null };
  const numLabel = findCell(rows, (n) => /^n\.?\s*[ºo°]?\.?\s*de factura$|^n\.? ?º? ?factura$|^numero de factura$/.test(n));
  if (numLabel) {
    out.numberCell = a1(numLabel[0] + 1, numLabel[1]);
    out.number = rows[numLabel[0] + 1]?.[numLabel[1]]?.trim() || null;
  }
  const dateLabel = findCell(rows, (n) => n === 'fecha');
  if (dateLabel) {
    out.dateCell = a1(dateLabel[0] + 1, dateLabel[1]);
    out.date = dmy(rows[dateLabel[0] + 1]?.[dateLabel[1]] ?? '');
  }
  const attn = findCell(rows, (n) => n.startsWith('a la atencion de'));
  if (attn) {
    for (let r = attn[0] + 1; r < rows.length; r++) {
      const v = rows[r]?.[attn[1]]?.trim() ?? '';
      if (!v || /^descripci/i.test(v)) break;
      out.recipients.push(v);
    }
    const tax = out.recipients.find((v) => /^(?:ES)?[A-HJ-NP-SUVW]-?\d{7}-?[0-9A-J]$|^\d{8}-?[A-Z]$/i.test(v.replace(/\s/g, '')));
    if (tax) out.taxId = tax.toUpperCase().replace(/[\s.-]/g, '');
  }
  const proj = findCell(rows, (n) => n === 'proyecto');
  if (proj) out.project = rows[proj[0] + 1]?.[proj[1]]?.trim() || null;

  const head = findCell(rows, (n) => n === 'descripcion');
  const baseCell = findCell(rows, (n) => n === 'base imponible');
  if (head) {
    const header = rows[head[0]]!.map((x) => norm(x));
    const qtyC = header.findIndex((x) => x === 'cantidad');
    const unitC = header.findIndex((x) => x.startsWith('precio unitario'));
    const totC = header.findIndex((x) => x.startsWith('precio total') || x === 'importe');
    const end = baseCell ? baseCell[0] : rows.length;
    for (let r = head[0] + 1; r < end; r++) {
      const row = rows[r] ?? [];
      const concept = row[head[1]]?.trim() ?? '';
      if (!concept) continue;
      const unit = money(row[unitC]) ?? 0;
      const total = money(row[totC]) ?? unit;
      const quantity = Number((row[qtyC] ?? '').replace(',', '.')) || (unit ? Math.round((total / unit) * 100) / 100 : 1);
      out.lines.push({ concept, quantity, unitPrice: unit, total });
    }
  }
  if (baseCell) out.base = money(rightOf(rows, baseCell[0], baseCell[1]));
  const vatCell = findCell(rows, (n) => n.startsWith('cuota de iva') || n.startsWith('iva'));
  if (vatCell) {
    out.vatRate = Number(norm(rows[vatCell[0]]![vatCell[1]]!).match(/(\d{1,2})\s*%/)?.[1] ?? NaN) || null;
    out.vat = money(rightOf(rows, vatCell[0], vatCell[1]));
  }
  const irpfCell = findCell(rows, (n) => n.startsWith('retencion') || n.startsWith('irpf'));
  if (irpfCell) {
    out.irpfRate = Number(norm(rows[irpfCell[0]]![irpfCell[1]]!).match(/(\d{1,2})\s*%/)?.[1] ?? NaN) || null;
    const v = money(rightOf(rows, irpfCell[0], irpfCell[1]));
    out.irpf = v === null ? null : Math.abs(v);
  }
  // The total is the last money value below the taxes block.
  const after = Math.max(baseCell?.[0] ?? -1, vatCell?.[0] ?? -1, irpfCell?.[0] ?? -1);
  if (after >= 0) {
    for (let r = after + 1; r < Math.min(rows.length, after + 4); r++) {
      const v = (rows[r] ?? []).map((x) => money(x)).filter((x): x is number => x !== null);
      if (v.length) {
        out.total = v[v.length - 1]!;
        break;
      }
    }
  }
  if (out.total === null && out.base !== null) out.total = out.base + (out.vat ?? 0) - (out.irpf ?? 0);
  if (out.base === null && out.lines.length) out.base = out.lines.reduce((s, l) => s + l.total, 0);
  return out;
}

const MONTHS_UP = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/**
 * Title for next month's copy: "0528 Otto JUNIO Antonio Morales (01/07/26)" → "0552 Otto JULIO Antonio Morales (01/08/26)".
 * Month words in the label move one month forward; several months ("ABR MAY JUN") collapse to the work month.
 */
export function nextSheetTitle(t: SheetTitle, opts: { number: string; date: ISODate; ownerName?: string; workMonth: number; albaran?: boolean }): string {
  const work = MONTHS_UP[opts.workMonth - 1]!;
  const words = t.label.split(/\s+/);
  const isMonth = (w: string) => MONTHS_UP.some((m) => m.startsWith(w.toUpperCase().replace(/\.$/, '')) && w.length >= 3);
  const kept = words.filter((w) => !isMonth(w) && !/^20\d{2}$/.test(w));
  const [y, m, d] = opts.date.split('-');
  const datePart = `(${d}/${m}/${y!.slice(2)})`;
  const owner = opts.ownerName ?? 'Antonio Morales';
  if (opts.albaran) return `ALB-${opts.number} ${kept.join(' ')} ${work} ${y} ${owner} ${datePart}`.replace(/\s+/g, ' ');
  return `${opts.number} ${kept.join(' ')} ${work} ${owner} ${datePart}`.replace(/\s+/g, ' ');
}

/** Albarán file name with its number: "ALB-003 LEVEL JULIO 2026 Antonio Morales (31/07/26)". */
export function albaranTitle(number: number, label: string, date: ISODate, ownerName = 'Antonio Morales'): string {
  const [y, m, d] = date.split('-');
  return `ALB-${String(number).padStart(3, '0')} ${label} ${ownerName} (${d}/${m}/${y!.slice(2)})`.replace(/\s+/g, ' ');
}

/** Minimal CSV parser (Drive's text/csv export of a sheet). */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

