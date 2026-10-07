'use client';
import { Ban, Check, FileText, Plus, Printer, Send, Stamp, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Invoice, InvoiceLine } from '@bos/schemas';
import { computeTotals, formatEUR, todayISO } from '@bos/domain';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge, Button, Field, Input, MoneyInput, Sheet, Textarea } from '@/components/ui/kit';
import { act, useInvoices, useIssuer } from '@/data/hooks';
import { STATIC_EXPORT } from '@/lib/config';
import { numericDate, shortDate } from '@/lib/format';
import { invoiceStatusText, invoiceTone } from './status';

export function InvoiceSheet({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const { data: invoices } = useInvoices();
  const inv = invoiceId ? (invoices ?? []).find((i) => i.id === invoiceId) ?? null : null;
  const issuer = useIssuer();
  const [confirm, setConfirm] = useState<'issue' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);

  // Draft editing state
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [vat, setVat] = useState('21');
  const [irpf, setIrpf] = useState('15');
  const [date, setDate] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!inv) return;
    setLines(inv.lines);
    setVat(String(inv.vatRate));
    setIrpf(String(inv.irpfRate));
    setDate(inv.date);
    setDue(inv.dueDate);
    setNotes(inv.notes);
    setDirty(false);
  }, [inv?.id, inv?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!invoiceId) return null;
  const draft = inv?.status === 'draft';
  const totals = computeTotals(lines, Number(vat) || 0, Number(irpf) || 0);
  const edit = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setDirty(true);
  };
  const save = async () => {
    if (!inv) return false;
    setBusy(true);
    const r = await act('invoice.update', { id: inv.id, patch: { lines, vatRate: Number(vat) || 0, irpfRate: Number(irpf) || 0, date, dueDate: due, notes } }, 'Borrador guardado');
    setBusy(false);
    if (r) setDirty(false);
    return !!r;
  };
  const run = async (name: string, input: unknown, msg: string) => {
    setBusy(true);
    await act(name, input, msg);
    setBusy(false);
  };
  const printUrl = `/print/invoice?i=${invoiceId}`;
  const issuerMissing = !issuer?.taxId || !(issuer.legalName || issuer.name);

  return (
    <Sheet
      open={!!invoiceId}
      onClose={onClose}
      width={620}
      eyebrow={inv ? `${inv.client.name} · ${invoiceStatusText(inv)}` : 'Factura'}
      title={inv ? (inv.invoiceNumber ? `Factura ${inv.invoiceNumber}` : 'Borrador de factura') : 'Cargando…'}
      footer={
        inv && (
          <>
            {inv.status !== 'cancelled' && (
              <Button variant="ghost" icon={inv.status === 'draft' ? <Trash2 size={14} /> : <Ban size={14} />} onClick={() => setConfirm('cancel')} className="mr-auto text-danger">
                {inv.status === 'draft' ? 'Descartar' : 'Anular'}
              </Button>
            )}
            {inv.status !== 'draft' && !STATIC_EXPORT && (
              <Button icon={<Printer size={14} />} onClick={() => window.open(printUrl, '_blank')}>
                PDF
              </Button>
            )}
            {draft && dirty && (
              <Button onClick={save} loading={busy}>
                Guardar
              </Button>
            )}
            {draft && (
              <Button variant="primary" icon={<Stamp size={14} />} disabled={busy} onClick={async () => (!dirty || (await save())) && setConfirm('issue')}>
                Emitir factura
              </Button>
            )}
            {inv.status === 'issued' && (
              <Button variant="primary" icon={<Send size={14} />} loading={busy} onClick={() => run('invoice.sent', { id: inv.id }, 'Marcada como enviada')}>
                Marcar enviada
              </Button>
            )}
            {(inv.status === 'issued' || inv.status === 'sent') && (
              <Button variant={inv.status === 'sent' ? 'primary' : 'secondary'} icon={<Check size={14} />} loading={busy} onClick={() => run('invoice.paid', { id: inv.id, date: todayISO() }, 'Marcada como cobrada')}>
                Cobrada
              </Button>
            )}
            {inv.status === 'paid' && (
              <Button icon={<Undo2 size={14} />} onClick={() => run('invoice.unpaid', { id: inv.id }, 'Vuelve a pendiente de cobro')}>
                No cobrada
              </Button>
            )}
          </>
        )
      }
    >
      {!inv ? null : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={invoiceTone(inv)}>{invoiceStatusText(inv)}</Badge>
            {inv.external && <Badge>Subida desde Inbox</Badge>}
            {inv.sentAt && <span className="text-[12px] text-ink-3">Enviada el {shortDate(inv.sentAt.slice(0, 10))}</span>}
            {inv.paidAt && <span className="text-[12px] text-ink-3">· Cobrada el {shortDate(inv.paidAt)}</span>}
          </div>

          {draft && issuerMissing && (
            <p className="rounded-[8px] border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-ink">
              Para emitir necesitas tus datos fiscales (nombre y NIF). Complétalos en <a href="/settings" className="font-semibold underline">Ajustes</a>.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha">{draft ? <Input type="date" value={date} onChange={(e) => edit(setDate)(e.target.value)} /> : <p className="text-[13.5px]">{numericDate(inv.date)}</p>}</Field>
            <Field label="Vencimiento">{draft ? <Input type="date" value={due} onChange={(e) => edit(setDue)(e.target.value)} /> : <p className="text-[13.5px]">{numericDate(inv.dueDate)}</p>}</Field>
          </div>

          <div>
            <p className="eyebrow mb-2 text-ink-3">Conceptos</p>
            <div className="overflow-hidden rounded-[10px] border border-line">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_64px_110px_28px] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
                  {draft ? (
                    <>
                      <Input value={l.concept} onChange={(e) => edit(setLines)(lines.map((x, k) => (k === i ? { ...x, concept: e.target.value } : x)))} aria-label="Concepto" />
                      <Input value={String(l.quantity)} inputMode="decimal" onChange={(e) => edit(setLines)(lines.map((x, k) => (k === i ? { ...x, quantity: Number(e.target.value.replace(',', '.')) || 1 } : x)))} aria-label="Cantidad" />
                      <MoneyInput value={l.unitPrice} onChange={(c) => edit(setLines)(lines.map((x, k) => (k === i ? { ...x, unitPrice: c ?? 0 } : x)))} />
                      <button type="button" aria-label="Quitar línea" className="text-ink-3 hover:text-danger disabled:opacity-30" disabled={lines.length === 1} onClick={() => edit(setLines)(lines.filter((_, k) => k !== i))}>
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-[13px]">
                        {l.date && <span className="mr-2 text-ink-3">{shortDate(l.date)}</span>}
                        {l.concept}
                      </span>
                      <span className="tabular text-right text-[12.5px] text-ink-3">× {l.quantity}</span>
                      <span className="tabular text-right text-[13px]">{formatEUR(Math.round(l.quantity * l.unitPrice))}</span>
                      <span />
                    </>
                  )}
                </div>
              ))}
            </div>
            {draft && (
              <Button variant="ghost" size="sm" className="mt-2" icon={<Plus size={13} />} onClick={() => edit(setLines)([...lines, { jobId: null, date: null, concept: '', quantity: 1, unitPrice: 0 }])}>
                Añadir línea
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="IVA %">{draft ? <Input value={vat} inputMode="decimal" onChange={(e) => edit(setVat)(e.target.value)} /> : <p className="text-[13.5px]">{inv.vatRate} %</p>}</Field>
            <Field label="Retención IRPF %">{draft ? <Input value={irpf} inputMode="decimal" onChange={(e) => edit(setIrpf)(e.target.value)} /> : <p className="text-[13.5px]">{inv.irpfRate} %</p>}</Field>
          </div>

          <div className="rounded-[10px] bg-surface-2 p-4">
            <Row label="Base imponible" value={formatEUR(totals.subtotal)} />
            <Row label={`IVA ${vat} %`} value={formatEUR(totals.tax)} />
            {totals.withholding > 0 && <Row label={`IRPF −${irpf} %`} value={`−${formatEUR(totals.withholding)}`} />}
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
              <span className="eyebrow text-ink-2">Total</span>
              <span className="font-display tabular text-[32px] leading-none">{formatEUR(totals.total)}</span>
            </div>
          </div>

          <Field label="Notas en la factura">{draft ? <Textarea rows={3} value={notes} onChange={(e) => edit(setNotes)(e.target.value)} placeholder="Forma de pago, IBAN…" /> : <p className="whitespace-pre-wrap text-[13px] text-ink-2">{inv.notes || '—'}</p>}</Field>

          {!draft && (
            <p className="flex items-center gap-2 text-[12px] text-ink-3">
              <FileText size={13} /> Una factura emitida no se puede editar: si hay un error, anúlala y haz otra (los trabajos vuelven a pendientes).
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'issue'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Emitir la factura?"
        description={`Se le asignará el siguiente número de factura y quedará bloqueada. Total: ${formatEUR(totals.total)}.`}
        confirmLabel="Emitir"
        onConfirm={async () => {
          if (inv) await run('invoice.issue', { id: inv.id }, 'Factura emitida');
        }}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={draft ? '¿Descartar el borrador?' : '¿Anular la factura?'}
        description={draft ? 'Los trabajos vuelven a pendientes de facturar.' : 'Queda anulada con su número (no se reutiliza) y los trabajos vuelven a pendientes.'}
        confirmLabel={draft ? 'Descartar' : 'Anular'}
        danger
        onConfirm={async () => {
          if (!inv) return;
          await run('invoice.cancel', { id: inv.id }, draft ? 'Borrador descartado' : 'Factura anulada');
          if (draft) onClose();
        }}
      />
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5 text-[13px]">
      <span className="text-ink-2">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
