import type { Client, InboxItem, ISODate } from '@bos/schemas';
import { addDays, MONTHS, suggestFilename } from '@bos/domain';
import { extOf } from '@/lib/fileTools';

/** What the user can override for a whole group before confirming it. */
export type Override = { clientId?: string | null; newClientName?: string | null; paid?: boolean };

export type ConfirmInput = {
  id: string;
  kind: 'expense' | 'income' | 'other';
  date: ISODate;
  vendor: string;
  taxId: string;
  invoiceNumber: string;
  total: number;
  vatRate: number;
  irpfRate: number;
  clientId: string | null;
  category: string;
  subscriptionId: string | null;
  concept: string;
  rectificativa: boolean;
  paid: boolean;
  newClient: { name: string; taxId: string } | null;
};

export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();

/** Old invoices (more than 45 days) are assumed collected. */
export const looksPaid = (date: ISODate | null, today: ISODate) => !!date && date < addDays(today, -45);

/** Builds the confirm input straight from the proposal (plus group overrides). `missing` lists what's lacking. */
export function draftFrom(item: InboxItem, clients: Map<string, Client>, today: ISODate, ov: Override = {}): { input: ConfirmInput | null; missing: string[] } {
  const p = item.proposal;
  const kind = p.kind.value ?? 'other';
  const date = p.date.value;
  const total = p.total.value;
  const base = {
    id: item.id,
    kind,
    date: date ?? today,
    vendor: '',
    taxId: p.taxId.value ?? '',
    invoiceNumber: p.invoiceNumber.value ?? '',
    total: total ?? 0,
    vatRate: p.vatRate.value ?? 21,
    irpfRate: 0,
    clientId: null,
    category: 'otros',
    subscriptionId: null,
    concept: item.filename,
    rectificativa: p.rectificativa,
    paid: false,
    newClient: null,
  } satisfies ConfirmInput;
  if (kind === 'other') return { input: { ...base, total: 0, vatRate: 0 }, missing: [] };

  const missing: string[] = [];
  if (!date) missing.push('fecha');
  if (total === null) missing.push('importe');
  const ext = extOf(item.filename);

  if (kind === 'expense') {
    const vendor = p.vendor.value ?? '';
    if (!vendor) missing.push('proveedor');
    const concept = suggestFilename({ ...p, kind: { ...p.kind, value: 'expense' } }, null, ext);
    return {
      input: missing.length ? null : { ...base, vendor, category: p.category.value ?? 'otros', subscriptionId: p.subscriptionId.value, concept },
      missing,
    };
  }

  const clientId = ov.clientId !== undefined && ov.clientId !== null ? ov.clientId : p.clientId.value;
  const newName = ov.newClientName ?? p.counterparty.value;
  const newClient = clientId ? null : newName ? { name: newName, taxId: p.taxId.value ?? '' } : null;
  if (!clientId && !newClient) missing.push('cliente');
  if (!base.invoiceNumber) missing.push('nº de factura');
  const clientName = clientId ? clients.get(clientId)?.name ?? null : newClient?.name ?? null;
  const concept = suggestFilename(p, clientName, ext);
  return {
    input: missing.length
      ? null
      : { ...base, clientId: clientId ?? null, newClient, vendor: p.counterparty.value ?? '', irpfRate: p.irpfRate.value ?? 0, concept, paid: ov.paid ?? looksPaid(date, today) },
    missing,
  };
}

/** Lowest confidence among the fields that matter for this kind. */
export function confidenceOf(item: InboxItem): number {
  const p = item.proposal;
  const keys = p.kind.value === 'income' ? [p.kind, p.date, p.total, p.invoiceNumber] : p.kind.value === 'expense' ? [p.kind, p.date, p.total, p.vendor] : [p.kind];
  return Math.min(...keys.map((g) => g.confidence));
}

export type Group = { key: string; label: string; sub: string; items: InboxItem[]; clientId: string | null; counterparty: string | null };

/** Income grouped by client (known or as written on the invoice); expenses by month; the rest together. */
export function groupPending(items: InboxItem[], clients: Map<string, Client>): { income: Group[]; expense: Group[]; other: InboxItem[] } {
  const income = new Map<string, Group>();
  const expense = new Map<string, Group>();
  const other: InboxItem[] = [];
  for (const i of items) {
    const p = i.proposal;
    if (p.kind.value === 'income') {
      const cid = p.clientId.value;
      const key = cid ? `c:${cid}` : p.taxId.value ? `t:${p.taxId.value}` : p.counterparty.value ? `n:${norm(p.counterparty.value)}` : 'unknown';
      const g = income.get(key) ?? {
        key,
        label: cid ? clients.get(cid)?.name ?? 'Cliente' : p.counterparty.value ?? 'Sin identificar',
        sub: cid ? 'Cliente reconocido' : p.taxId.value ? `NIF ${p.taxId.value} · aún no es cliente` : p.counterparty.value ? 'Aún no es cliente' : 'No se ha podido leer el cliente',
        items: [],
        clientId: cid,
        counterparty: cid ? null : p.counterparty.value,
      };
      g.items.push(i);
      income.set(key, g);
    } else if (p.kind.value === 'expense') {
      const ym = (p.date.value ?? '').slice(0, 7) || 'sin-fecha';
      const g = expense.get(ym) ?? { key: ym, label: ym === 'sin-fecha' ? 'Sin fecha' : monthLabel(ym), sub: '', items: [], clientId: null, counterparty: null };
      g.items.push(i);
      expense.set(ym, g);
    } else other.push(i);
  }
  const byDate = (a: InboxItem, b: InboxItem) => (a.proposal.date.value ?? '').localeCompare(b.proposal.date.value ?? '');
  for (const g of [...income.values(), ...expense.values()]) g.items.sort(byDate);
  return {
    income: [...income.values()].sort((a, b) => Number(!a.clientId) - Number(!b.clientId) || b.items.length - a.items.length || a.label.localeCompare(b.label)),
    expense: [...expense.values()].sort((a, b) => b.key.localeCompare(a.key)),
    other,
  };
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const n = MONTHS[m - 1] ?? '';
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${y}`;
}
