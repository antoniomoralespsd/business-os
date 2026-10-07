/** Money helpers. Everything is integer cents; rounding is half-up on cents. */

const fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPlain = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });

export function formatEUR(cents: number): string {
  return fmt.format(cents / 100);
}

/** "1.234,56" without the € sign. */
export function formatAmount(cents: number): string {
  return fmtPlain.format(cents / 100);
}

/** Compact for KPIs: 12.400 € → "12,4K €"; under 10.000 € shown in full without decimals. */
export function formatCompactEUR(cents: number): string {
  const euros = cents / 100;
  if (Math.abs(euros) >= 10_000) return `${(euros / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })}K €`;
  return `${Math.round(euros).toLocaleString('es-ES')} €`;
}

/**
 * Parses what a person types or what appears on an invoice: "49,99", "49.99", "1.234,56",
 * "1,234.56", "1 234,56 €", "30". Returns cents or null.
 */
export function parseEuro(input: string): number | null {
  let s = input.replace(/[€\sEUReur]/g, '').replace(/ /g, '');
  if (!s) return null;
  const neg = s.startsWith('-');
  s = s.replace(/^[-+]/, '');
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string;
  let decPart = '';
  const sep = Math.max(lastComma, lastDot);
  if (sep >= 0 && s.length - sep - 1 <= 2 && s.length - sep - 1 > 0) {
    intPart = s.slice(0, sep).replace(/[.,]/g, '');
    decPart = s.slice(sep + 1);
  } else {
    intPart = s.replace(/[.,]/g, '');
  }
  if (!intPart && !decPart) return null;
  const cents = Number(intPart || '0') * 100 + Number(decPart.padEnd(2, '0') || '0');
  if (!Number.isFinite(cents)) return null;
  return neg ? -cents : cents;
}

export const roundCents = (x: number) => Math.round(x + Number.EPSILON * Math.sign(x));

export interface LineLike {
  quantity: number;
  unitPrice: number;
}

export interface Totals {
  subtotal: number;
  tax: number;
  withholding: number;
  total: number;
}

/** Spanish invoice: base = Σ lines; IVA and IRPF on the base; total = base + IVA − IRPF. */
export function computeTotals(lines: readonly LineLike[], vatRate: number, irpfRate: number): Totals {
  const subtotal = lines.reduce((s, l) => s + roundCents(l.quantity * l.unitPrice), 0);
  const tax = roundCents((subtotal * vatRate) / 100);
  const withholding = roundCents((subtotal * irpfRate) / 100);
  return { subtotal, tax, withholding, total: subtotal + tax - withholding };
}

/** Splits a VAT-included total into base + VAT. */
export function splitVat(total: number, vatRate: number): { base: number; vat: number } {
  const base = roundCents(total / (1 + vatRate / 100));
  return { base, vat: total - base };
}
