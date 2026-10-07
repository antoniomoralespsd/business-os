import { MONTHS } from '@bos/domain';

/** "12 oct" (adds the year when it is not the current one). */
export function shortDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number) as [number, number, number];
  const base = `${day} ${MONTHS[m - 1]!.slice(0, 3)}`;
  return y === new Date().getFullYear() ? base : `${base} ${y}`;
}

/** "12/10/2026" */
export function numericDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Download a text file (CSV) in the browser. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => (typeof c === 'number' ? String(c).replace('.', ',') : `"${String(c).replace(/"/g, '""')}"`)).join(';')).join('\n');
}
