import type { Expense, ID, Invoice, ISODate, Job } from '@bos/schemas';
import { addDays, daysBetween, MONTHS, parseISODate, toISODate } from './dates';

/* ---------- numbering ---------- */

/** "2026-085" (or "F2026-085" with series "F"). */
export function formatInvoiceNumber(series: string, year: number, n: number): string {
  return `${series ?? ''}${year}-${String(n).padStart(3, '0')}`;
}

export function dueDateFor(date: ISODate, termsDays: number): ISODate {
  return addDays(date, termsDays);
}

/* ---------- quarters ---------- */

export type Quarter = 1 | 2 | 3 | 4;

export function quarterOf(d: ISODate): { year: number; q: Quarter } {
  const dt = parseISODate(d);
  return { year: dt.getUTCFullYear(), q: (Math.floor(dt.getUTCMonth() / 3) + 1) as Quarter };
}

export function quarterRange(year: number, q: Quarter): { from: ISODate; to: ISODate } {
  const from = toISODate(new Date(Date.UTC(year, (q - 1) * 3, 1)));
  const to = toISODate(new Date(Date.UTC(year, q * 3, 0)));
  return { from, to };
}

export function quarterLabel(year: number, q: Quarter): string {
  const m1 = MONTHS[(q - 1) * 3]!;
  const m3 = MONTHS[(q - 1) * 3 + 2]!;
  return `T${q} ${year} · ${m1.slice(0, 3)}–${m3.slice(0, 3)}`;
}

/** An invoice counts for income once issued (not drafts, not cancelled). */
export const countsAsIncome = (i: Pick<Invoice, 'status'>) => i.status === 'issued' || i.status === 'sent' || i.status === 'paid';

export interface QuarterSummary {
  year: number;
  q: Quarter;
  invoices: number;
  incomeBase: number;
  vatCollected: number;
  irpfWithheld: number;
  incomeTotal: number;
  expenses: number;
  expenseBase: number;
  vatPaid: number;
  expenseTotal: number;
  /** IVA a ingresar (modelo 303), estimate. */
  vatToPay: number;
  /** Rendimiento neto (ingresos − gastos deducibles). */
  profit: number;
  /** Pago fraccionado IRPF (modelo 130) estimate: 20 % of profit minus withholdings, never below 0. */
  irpfInstallment: number;
  pendingExpenses: number;
}

export function summarizeQuarter(invoices: readonly Invoice[], expenses: readonly Expense[], year: number, q: Quarter): QuarterSummary {
  const { from, to } = quarterRange(year, q);
  const inQ = (d: ISODate) => d >= from && d <= to;
  const inv = invoices.filter((i) => countsAsIncome(i) && inQ(i.date));
  const exp = expenses.filter((e) => !e.archived && inQ(e.date));
  const ded = exp.filter((e) => e.deductible);
  const incomeBase = inv.reduce((s, i) => s + i.subtotal, 0);
  const vatCollected = inv.reduce((s, i) => s + i.tax, 0);
  const irpfWithheld = inv.reduce((s, i) => s + i.withholding, 0);
  const expenseBase = ded.reduce((s, e) => s + e.base, 0);
  const vatPaid = ded.reduce((s, e) => s + e.vat, 0);
  const profit = incomeBase - expenseBase;
  return {
    year,
    q,
    invoices: inv.length,
    incomeBase,
    vatCollected,
    irpfWithheld,
    incomeTotal: inv.reduce((s, i) => s + i.total, 0),
    expenses: exp.length,
    expenseBase,
    vatPaid,
    expenseTotal: exp.reduce((s, e) => s + e.total, 0),
    vatToPay: vatCollected - vatPaid,
    profit,
    irpfInstallment: Math.max(0, Math.round(profit * 0.2) - irpfWithheld),
    pendingExpenses: exp.filter((e) => e.status === 'pending' || !e.fileId).length,
  };
}

/* ---------- alerts ("Revisar") ---------- */

export type AlertSeverity = 'info' | 'warning' | 'critical';
export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  /** Where to go to fix it. */
  href: string;
}

export function unbilledByClient(jobs: readonly Job[]): Map<ID, { count: number; amount: number; oldest: ISODate }> {
  const m = new Map<ID, { count: number; amount: number; oldest: ISODate }>();
  for (const j of jobs) {
    if (j.invoiceId || j.archived) continue;
    const cur = m.get(j.clientId) ?? { count: 0, amount: 0, oldest: j.date };
    cur.count++;
    cur.amount += Math.round(j.quantity * j.unitPrice);
    if (j.date < cur.oldest) cur.oldest = j.date;
    m.set(j.clientId, cur);
  }
  return m;
}

export function billingAlerts(
  input: { jobs: readonly Job[]; invoices: readonly Invoice[]; expenses: readonly Expense[]; clientName: (id: ID) => string },
  today: ISODate,
): Alert[] {
  const out: Alert[] = [];
  for (const [clientId, u] of unbilledByClient(input.jobs)) {
    const age = daysBetween(u.oldest, today);
    out.push({
      id: `unbilled-${clientId}`,
      severity: age > 30 ? 'warning' : 'info',
      title: `${u.count} ${u.count === 1 ? 'trabajo' : 'trabajos'} de ${input.clientName(clientId)} sin facturar`,
      detail: age > 0 ? `El más antiguo es de hace ${age} ${age === 1 ? 'día' : 'días'}` : undefined,
      href: `/billing?tab=jobs&client=${clientId}`,
    });
  }
  for (const i of input.invoices) {
    if (i.archived) continue;
    const label = i.invoiceNumber ? `La factura ${i.invoiceNumber}` : 'Un borrador de factura';
    if (i.status === 'draft' && daysBetween(i.date, today) >= 3) {
      out.push({ id: `draft-${i.id}`, severity: 'info', title: `${label} de ${i.client.name} sigue en borrador`, href: `/billing?tab=invoices&invoice=${i.id}` });
    }
    if (i.status === 'issued') {
      out.push({ id: `unsent-${i.id}`, severity: 'warning', title: `${label} está generada pero no consta como enviada`, detail: i.client.name, href: `/billing?tab=invoices&invoice=${i.id}` });
    }
    if (i.status === 'sent' && i.dueDate < today) {
      const d = daysBetween(i.dueDate, today);
      out.push({ id: `overdue-${i.id}`, severity: d > 30 ? 'critical' : 'warning', title: `${label} lleva ${d} ${d === 1 ? 'día' : 'días'} vencida sin cobrar`, detail: i.client.name, href: `/billing?tab=invoices&invoice=${i.id}` });
    }
  }
  const pending = input.expenses.filter((e) => !e.archived && e.status === 'pending');
  if (pending.length) {
    out.push({ id: 'expenses-pending', severity: 'info', title: `${pending.length} ${pending.length === 1 ? 'gasto' : 'gastos'} sin factura o por revisar`, href: '/billing?tab=expenses&filter=pending' });
  }
  return out;
}
