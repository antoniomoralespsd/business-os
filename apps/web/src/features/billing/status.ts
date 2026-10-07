import type { Invoice, InvoiceStatus } from '@bos/schemas';
import { todayISO } from '@bos/domain';

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Borrador',
  issued: 'Emitida',
  sent: 'Enviada',
  paid: 'Cobrada',
  cancelled: 'Anulada',
};

export function invoiceTone(i: Pick<Invoice, 'status' | 'dueDate'>): 'neutral' | 'ok' | 'warn' | 'danger' | 'info' {
  if (i.status === 'paid') return 'ok';
  if (i.status === 'cancelled') return 'neutral';
  if (i.status === 'draft') return 'neutral';
  if (i.status === 'issued') return 'warn';
  return i.dueDate < todayISO() ? 'danger' : 'info';
}

export function invoiceStatusText(i: Pick<Invoice, 'status' | 'dueDate'>): string {
  if (i.status === 'sent' && i.dueDate < todayISO()) return 'Vencida';
  return INVOICE_STATUS_LABEL[i.status];
}

export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  software: 'Software',
  hardware: 'Equipos',
  material: 'Material',
  impresion: 'Imprenta',
  transporte: 'Transporte',
  formacion: 'Formación',
  telefono: 'Teléfono e internet',
  gestoria: 'Gestoría',
  publicidad: 'Publicidad',
  comidas: 'Comidas',
  otros: 'Otros',
};
