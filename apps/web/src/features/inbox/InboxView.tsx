'use client';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, ImageIcon, Loader2, UploadCloud, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { EXPENSE_CATEGORIES, type InboxItem, type InboxKind } from '@bos/schemas';
import { classifyDocument, formatEUR, suggestFilename, todayISO } from '@bos/domain';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, MoneyInput, PageHeader, Segmented, Select } from '@/components/ui/kit';
import { act, useClients, useInbox, useIssuer, useSubscriptions } from '@/data/hooks';
import { EXPENSE_CATEGORY_LABEL } from '@/features/billing/status';
import { DATA_MODE } from '@/lib/config';
import { extOf, pdfText, sha256 } from '@/lib/fileTools';
import { shortDate } from '@/lib/format';

type Job = { id: string; name: string; state: 'reading' | 'uploading' | 'done' | 'error'; message?: string };
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*';

export function InboxView() {
  const { data: items } = useInbox();
  const { data: clients } = useClients();
  const { data: subs } = useSubscriptions();
  const issuer = useIssuer();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pending = useMemo(() => (items ?? []).filter((i) => i.status === 'needs_confirmation').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [items]);
  const done = useMemo(() => (items ?? []).filter((i) => i.status !== 'needs_confirmation').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 15), [items]);

  const process = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const id = `${file.name}-${file.size}-${Math.random()}`;
        const update = (p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));
        setJobs((js) => [{ id, name: file.name, state: 'reading' }, ...js]);
        try {
          const hash = await sha256(file);
          const isPdf = file.type === 'application/pdf' || extOf(file.name) === 'pdf';
          const text = isPdf ? await pdfText(file).catch(() => '') : '';
          const proposal = classifyDocument(
            { filename: file.name, mimeType: file.type, text },
            { issuer: { name: issuer?.name ?? '', legalName: issuer?.legalName ?? '', taxId: issuer?.taxId ?? '' }, clients: clients ?? [], subscriptions: subs ?? [], today: todayISO() },
          );
          let storagePath: string | null = null;
          let warning: string | undefined;
          if (DATA_MODE === 'firestore') {
            update({ state: 'uploading' });
            const fd = new FormData();
            fd.append('file', file);
            fd.append('sha256', hash);
            const res = await fetch('/api/upload', { method: 'POST', body: fd });
            const json = (await res.json().catch(() => null)) as { ok: boolean; storagePath?: string | null; warning?: string; error?: string } | null;
            if (!json?.ok) throw new Error(json?.error ?? 'No se pudo subir');
            storagePath = json.storagePath ?? null;
            warning = json.warning;
          }
          const r = await act<{ id: string; duplicateOf: string | null }>('inbox.create', { filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, sha256: hash, storagePath, textExcerpt: text.slice(0, 20000), proposal });
          update({ state: r ? 'done' : 'error', message: r?.duplicateOf ? 'Posible duplicado de un archivo anterior' : warning ?? (isPdf && !text ? 'PDF escaneado: rellena los datos a mano' : undefined) });
        } catch (e) {
          update({ state: 'error', message: e instanceof Error ? e.message : 'Error' });
        }
      }
    },
    [clients, subs, issuer],
  );

  const onFiles = (list: FileList | null) => list && list.length && void process([...list]);

  return (
    <div className="pb-16">
      <PageHeader title="Inbox" />
      <p className="mt-2 max-w-2xl px-4 text-[13.5px] leading-relaxed text-ink-2 md:px-8">
        Suelta aquí facturas, tickets y documentos. La app lee cada uno, decide si es un gasto o un ingreso, y propone proveedor o cliente, fecha, importe e IVA. Tú confirmas y queda registrado en Facturación.
      </p>

      <div className="px-4 pt-5 md:px-8">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={clsx('relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[16px] border-2 border-dashed px-6 py-10 text-center transition-colors', drag ? 'border-transparent bg-surface' : 'border-line-strong hover:border-ink')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        >
          {drag && <span className="iris-bar-x absolute inset-0 -z-0 opacity-20" aria-hidden />}
          <UploadCloud size={28} className="relative text-ink-2" />
          <p className="font-display relative mt-3 text-[26px] leading-tight">Suelta archivos aquí</p>
          <p className="relative mt-1 text-[12.5px] text-ink-3">PDF, JPG, PNG o fotos del móvil · varios a la vez</p>
          <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => onFiles(e.target.files)} />
        </div>

        {jobs.length > 0 && (
          <ul className="mt-3 space-y-1">
            {jobs.slice(0, 8).map((j) => (
              <li key={j.id} className="flex items-center gap-2 text-[12.5px]">
                {j.state === 'done' ? <CheckCircle2 size={14} className="text-ok" /> : j.state === 'error' ? <AlertTriangle size={14} className="text-danger" /> : <Loader2 size={14} className="animate-spin text-ink-3" />}
                <span className="truncate">{j.name}</span>
                <span className="text-ink-3">{j.state === 'reading' ? 'Leyendo…' : j.state === 'uploading' ? 'Subiendo…' : j.message ?? (j.state === 'done' ? 'Listo para revisar' : '')}</span>
                {j.state !== 'reading' && j.state !== 'uploading' && (
                  <button type="button" aria-label="Quitar" className="ml-auto text-ink-3 hover:text-ink" onClick={() => setJobs((js) => js.filter((x) => x.id !== j.id))}>
                    <X size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4 px-4 pt-8 md:px-8">
        <p className="eyebrow text-ink-2">Por confirmar · {pending.length}</p>
        {!items ? <Loading /> : pending.length === 0 ? <EmptyState title="Bandeja vacía">Todo lo que subas aparecerá aquí para que lo confirmes con un clic.</EmptyState> : pending.map((i) => <ProposalCard key={i.id} item={i} />)}
      </div>

      {done.length > 0 && (
        <div className="px-4 pt-10 md:px-8">
          <p className="eyebrow mb-2 text-ink-3">Procesados recientemente</p>
          <Card>
            <ul className="divide-y divide-line">
              {done.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <FileIcon mime={i.mimeType} />
                  <span className="min-w-0 flex-1 truncate">{i.filename}</span>
                  {i.status === 'discarded' ? (
                    <Badge>Descartado</Badge>
                  ) : i.result?.kind === 'expense' ? (
                    <Link href="/billing?tab=expenses" className="text-[12px] font-semibold text-ink-2 hover:text-ink">
                      Gasto →
                    </Link>
                  ) : i.result?.kind === 'income' ? (
                    <Link href={`/billing?tab=invoices&invoice=${i.result.id}`} className="text-[12px] font-semibold text-ink-2 hover:text-ink">
                      Ingreso →
                    </Link>
                  ) : (
                    <Badge>Documento</Badge>
                  )}
                  <span className="tabular w-16 text-right text-[12px] text-ink-3">{shortDate(i.updatedAt.slice(0, 10))}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

function FileIcon({ mime }: { mime: string }) {
  return mime.startsWith('image/') ? <ImageIcon size={15} className="shrink-0 text-ink-3" /> : <FileText size={15} className="shrink-0 text-ink-3" />;
}

function Conf({ c, reason }: { c: number; reason: string }) {
  const tone = c >= 0.85 ? 'bg-ok' : c >= 0.6 ? 'bg-warn' : 'bg-danger';
  return <span title={`${Math.round(c * 100)} % · ${reason}`} className={clsx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', c === 0 ? 'bg-line-strong' : tone)} />;
}

function ProposalCard({ item }: { item: InboxItem }) {
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
  const [clientId, setClientId] = useState(p.clientId.value ?? '');
  const [category, setCategory] = useState(p.category.value ?? 'otros');
  const [subId, setSubId] = useState(p.subscriptionId.value ?? '');
  const [busy, setBusy] = useState(false);

  const clientName = clients?.find((c) => c.id === clientId)?.name ?? null;
  const fileName = suggestFilename({ ...p, kind: { ...p.kind, value: kind }, date: { ...p.date, value: date }, vendor: { ...p.vendor, value: vendor || null }, total: { ...p.total, value: total } }, clientName, extOf(item.filename));
  const canConfirm = kind === 'other' || (total !== null && date && (kind === 'expense' ? !!vendor.trim() : !!clientId && !!invoiceNumber.trim()));

  const confirm = async () => {
    setBusy(true);
    await act(
      'inbox.confirm',
      { id: item.id, kind, date, vendor: vendor.trim(), taxId, invoiceNumber: invoiceNumber.trim(), total: total ?? 0, vatRate: Number(vat) || 0, irpfRate: kind === 'income' ? Number(irpf) || 0 : 0, clientId: kind === 'income' ? clientId || null : null, category, subscriptionId: subId || null, concept: fileName },
      kind === 'expense' ? 'Gasto registrado' : kind === 'income' ? 'Factura de ingreso registrada' : 'Documento archivado',
    );
    setBusy(false);
  };

  return (
    <Card className="overflow-visible">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <FileIcon mime={item.mimeType} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">{item.filename}</p>
          <p className="truncate text-[11.5px] text-ink-3">Se guardará como {fileName}</p>
        </div>
        {item.duplicateOf && <Badge tone="warn">Posible duplicado</Badge>}
        {item.storagePath ? (
          <a href={`/api/files?path=${encodeURIComponent(item.storagePath)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink">
            Ver archivo <ExternalLink size={12} />
          </a>
        ) : (
          DATA_MODE === 'firestore' && <span className="text-[11.5px] text-ink-3">Archivo no guardado</span>
        )}
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
                  <Conf c={p.clientId.confidence} reason={p.clientId.reason} />
                  <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="">Elige cliente…</option>
                    {(clients ?? []).filter((c) => c.status !== 'archived').map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
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
                <Field label="NIF del proveedor">
                  <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="Opcional" />
                </Field>
              </>
            ) : (
              <Field label="Retención IRPF %">
                <Input value={irpf} onChange={(e) => setIrpf(e.target.value)} inputMode="decimal" />
              </Field>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          {total !== null && kind !== 'other' && <span className="mr-auto text-[12.5px] text-ink-3">{kind === 'expense' ? 'Gasto' : 'Ingreso'} de <strong className="tabular text-ink">{formatEUR(total)}</strong></span>}
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
