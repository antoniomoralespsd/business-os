'use client';
import clsx from 'clsx';
import { ExternalLink, FileText, ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { EXPENSE_CATEGORIES, type InboxItem, type InboxKind } from '@bos/schemas';
import { formatEUR, suggestFilename, todayISO } from '@bos/domain';
import { Badge, Button, Card, Field, Input, MoneyInput, Segmented, Select, Toggle } from '@/components/ui/kit';
import { act, useClients, useSubscriptions } from '@/data/hooks';
import { EXPENSE_CATEGORY_LABEL } from '@/features/billing/status';
import { DATA_MODE } from '@/lib/config';
import { extOf } from '@/lib/fileTools';
import { looksPaid } from './drafts';

export function FileIcon({ mime }: { mime: string }) {
  return mime.startsWith('image/') ? <ImageIcon size={15} className="shrink-0 text-ink-3" /> : <FileText size={15} className="shrink-0 text-ink-3" />;
}

export function Conf({ c, reason }: { c: number; reason: string }) {
  const tone = c >= 0.85 ? 'bg-ok' : c >= 0.45 ? 'bg-warn' : 'bg-danger';
  return <span title={`${Math.round(c * 100)} % · ${reason}`} className={clsx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', c === 0 ? 'bg-line-strong' : tone)} />;
}

export function FileLink({ item }: { item: InboxItem }) {
  if (item.drive)
    return (
      <a href={item.drive.webViewLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink">
        Ver en Drive <ExternalLink size={12} />
      </a>
    );
  if (item.storagePath)
    return (
      <a href={`/api/files?path=${encodeURIComponent(item.storagePath)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink">
        Ver archivo <ExternalLink size={12} />
      </a>
    );
  return DATA_MODE === 'firestore' ? <span className="text-[11.5px] text-ink-3">Aún no está en Drive</span> : null;
}

const NEW = '__new';

/** Full editor for one file: every field can be corrected before confirming. */
export function ProposalCard({ item, onDone }: { item: InboxItem; onDone?: () => void }) {
  const p = item.proposal;
  const { data: clients } = useClients();
  const { data: subs } = useSubscriptions();
  const [kind, setKind] = useState<InboxKind>(p.kind.value ?? 'expense');
  const [date, setDate] = useState(p.date.value ?? todayISO());
  const [vendor, setVendor] = useState(p.vendor.value ?? '');
  const [taxId, setTaxId] = useState(p.taxId.value ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(p.invoiceNumber.value ?? '');
  const [total, setTotal] = useState<number | null>(p.total.value);
  const [vat, setVat] = useState(String(p.vatRate.value ?? 21));
  const [irpf, setIrpf] = useState(String(p.irpfRate.value ?? 0));
  const [clientId, setClientId] = useState(p.clientId.value ?? (p.counterparty.value ? NEW : ''));
  const [newName, setNewName] = useState(p.counterparty.value ?? '');
  const [category, setCategory] = useState(p.category.value ?? 'otros');
  const [subId, setSubId] = useState(p.subscriptionId.value ?? '');
  const [rect, setRect] = useState(p.rectificativa);
  const [paid, setPaid] = useState(looksPaid(p.date.value, todayISO()));
  const [busy, setBusy] = useState(false);

  const isNew = clientId === NEW;
  const clientName = isNew ? newName.trim() || null : clients?.find((c) => c.id === clientId)?.name ?? null;
  const fileName = suggestFilename({ ...p, kind: { ...p.kind, value: kind }, date: { ...p.date, value: date }, vendor: { ...p.vendor, value: vendor || null }, total: { ...p.total, value: total } }, clientName, extOf(item.filename));
  const canConfirm = kind === 'other' || (total !== null && date && (kind === 'expense' ? !!vendor.trim() : !!clientName && !!invoiceNumber.trim()));

  const confirm = async () => {
    setBusy(true);
    const r = await act(
      'inbox.confirm',
      {
        id: item.id,
        kind,
        date,
        vendor: kind === 'income' ? p.counterparty.value ?? '' : vendor.trim(),
        taxId,
        invoiceNumber: invoiceNumber.trim(),
        total: total ?? 0,
        vatRate: Number(vat) || 0,
        irpfRate: kind === 'income' ? Number(irpf) || 0 : 0,
        clientId: kind === 'income' && !isNew ? clientId || null : null,
        newClient: kind === 'income' && isNew ? { name: newName.trim(), taxId } : null,
        category,
        subscriptionId: subId || null,
        concept: fileName,
        rectificativa: kind !== 'other' && rect,
        paid: kind === 'income' && paid,
      },
      kind === 'expense' ? 'Gasto registrado' : kind === 'income' ? (isNew ? `Factura registrada y cliente «${newName.trim()}» creado` : 'Factura de ingreso registrada') : 'Documento guardado',
    );
    setBusy(false);
    if (r) onDone?.();
  };

  return (
    <Card className="overflow-visible">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <FileIcon mime={item.mimeType} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">{item.filename}</p>
          <p className="truncate text-[11.5px] text-ink-3">
            {item.sourcePath && item.sourcePath !== item.filename ? `${item.sourcePath.split('/').slice(0, -1).join(' / ')} · ` : ''}Se guardará como {fileName}
          </p>
        </div>
        {item.duplicateOf && <Badge tone="warn">Posible duplicado</Badge>}
        <FileLink item={item} />
      </div>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<InboxKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: 'Gasto' },
              { value: 'income', label: 'Ingreso' },
              { value: 'other', label: 'Otro documento' },
            ]}
          />
          <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
            <Conf c={p.kind.confidence} reason={p.kind.reason} /> {p.kind.reason}
          </span>
        </div>
        {kind !== 'other' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kind === 'expense' ? (
              <Field label="Proveedor">
                <div className="flex items-center gap-2">
                  <Conf c={p.vendor.confidence} reason={p.vendor.reason} />
                  <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="¿Quién te cobra?" />
                </div>
              </Field>
            ) : (
              <Field label="Cliente">
                <div className="flex items-center gap-2">
                  <Conf c={p.clientId.value ? p.clientId.confidence : p.counterparty.confidence} reason={p.clientId.value ? p.clientId.reason : p.counterparty.reason} />
                  <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="">Elige cliente…</option>
                    <option value={NEW}>+ Nuevo cliente…</option>
                    {(clients ?? [])
                      .filter((c) => c.status !== 'archived')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                </div>
              </Field>
            )}
            {kind === 'income' && isNew && (
              <Field label="Nombre del cliente nuevo">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Como quieres verlo en la app" />
              </Field>
            )}
            <Field label="Fecha">
              <div className="flex items-center gap-2">
                <Conf c={p.date.confidence} reason={p.date.reason} />
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </Field>
            <Field label="Total (IVA incl.)">
              <div className="flex items-center gap-2">
                <Conf c={p.total.confidence} reason={p.total.reason} />
                <MoneyInput value={total} onChange={setTotal} className="flex-1" />
              </div>
            </Field>
            <Field label="Nº factura">
              <div className="flex items-center gap-2">
                <Conf c={p.invoiceNumber.confidence} reason={p.invoiceNumber.reason} />
                <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder={kind === 'income' ? 'Obligatorio' : 'Opcional'} />
              </div>
            </Field>
            <Field label="IVA %">
              <Select value={vat} onChange={(e) => setVat(e.target.value)}>
                {['21', '10', '4', '0'].map((v) => (
                  <option key={v} value={v}>
                    {v} %
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={kind === 'income' ? 'NIF del cliente' : 'NIF del proveedor'} hint={kind === 'income' && taxId ? 'Se guarda en el cliente para reconocer sus próximas facturas' : undefined}>
              <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="Opcional" />
            </Field>
            {kind === 'expense' ? (
              <>
                <Field label="Categoría">
                  <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {EXPENSE_CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Suscripción" hint={subId ? 'Se enlaza el cobro con la suscripción' : undefined}>
                  <Select value={subId} onChange={(e) => setSubId(e.target.value)}>
                    <option value="">Ninguna</option>
                    {(subs ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            ) : (
              <Field label="Retención IRPF %">
                <Input value={irpf} onChange={(e) => setIrpf(e.target.value)} inputMode="decimal" />
              </Field>
            )}
          </div>
        )}
        {kind !== 'other' && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Toggle on={rect} onChange={setRect} label="Rectificativa (resta)" />
            {kind === 'income' && <Toggle on={paid} onChange={setPaid} label="Ya cobrada" />}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          {total !== null && kind !== 'other' && (
            <span className="mr-auto text-[12.5px] text-ink-3">
              {kind === 'expense' ? 'Gasto' : 'Ingreso'} de <strong className="tabular text-ink">{formatEUR(rect ? -total : total)}</strong>
            </span>
          )}
          <Button variant="ghost" onClick={() => act('inbox.discard', { id: item.id }, 'Descartado')}>
            Descartar
          </Button>
          <Button variant="primary" loading={busy} disabled={!canConfirm} onClick={confirm}>
            Confirmar
          </Button>
        </div>
      </div>
    </Card>
  );
}
