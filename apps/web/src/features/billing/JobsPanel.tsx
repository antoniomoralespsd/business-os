'use client';
import clsx from 'clsx';
import { FilePlus2, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Client, Job } from '@bos/schemas';
import { formatEUR, todayISO } from '@bos/domain';
import { Badge, Button, Card, EmptyState, Input, Loading, MoneyInput, Select } from '@/components/ui/kit';
import { act, useClientMap, useClients, useJobs } from '@/data/hooks';
import { shortDate } from '@/lib/format';
import { clientColor } from '@/lib/clientColors';

/**
 * Trabajos realizados. With `clientId` it shows that client's jobs (used inside the client folder);
 * without it, every client's unbilled work grouped by client (used in Facturación).
 */
export function JobsPanel({ clientId, onInvoiceCreated }: { clientId?: string; onInvoiceCreated: (invoiceId: string) => void }) {
  const { data: jobs } = useJobs(clientId ? [{ field: 'clientId', op: '==', value: clientId }] : []);
  const { data: clients } = useClients();
  const byId = useClientMap(clients);
  const [showBilled, setShowBilled] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => (jobs ?? []).filter((j) => !j.archived && (showBilled || !j.invoiceId)).sort((a, b) => b.date.localeCompare(a.date)),
    [jobs, showBilled],
  );
  const groups = useMemo(() => {
    const m = new Map<string, Job[]>();
    for (const j of visible) m.set(j.clientId, [...(m.get(j.clientId) ?? []), j]);
    return [...m.entries()].sort((a, b) => (byId.get(a[0])?.name ?? '').localeCompare(byId.get(b[0])?.name ?? '', 'es'));
  }, [visible, byId]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const invoice = async (cid: string, ids: string[]) => {
    const r = await act<{ id: string }>('invoice.draft', { clientId: cid, date: todayISO(), jobIds: ids }, 'Borrador de factura creado');
    if (r) {
      setSelected(new Set());
      onInvoiceCreated(r.id);
    }
  };

  if (!jobs || !clients) return <Loading />;

  return (
    <div className="space-y-5">
      <QuickJob clientId={clientId} clients={clients} />
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] text-ink-3">{showBilled ? 'Todos los trabajos' : 'Pendientes de facturar'}</p>
        <button type="button" className="text-[12.5px] font-semibold text-ink-2 hover:text-ink" onClick={() => setShowBilled(!showBilled)}>
          {showBilled ? 'Ver solo pendientes' : 'Ver también facturados'}
        </button>
      </div>
      {groups.length === 0 && (
        <EmptyState title="Nada pendiente de facturar">Cuando hagas un trabajo, apúntalo aquí (o desde una tarea completada) y luego lo facturas de una vez a final de mes.</EmptyState>
      )}
      {groups.map(([cid, list]) => {
        const client = byId.get(cid);
        const unbilled = list.filter((j) => !j.invoiceId);
        const sel = unbilled.filter((j) => selected.has(j.id));
        const total = unbilled.reduce((s, j) => s + Math.round(j.quantity * j.unitPrice), 0);
        return (
          <Card key={cid}>
            {!clientId && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: clientColor(client?.color) }} />
                  <span className="font-semibold">{client?.name ?? cid}</span>
                  <span className="text-[12px] text-ink-3">
                    {unbilled.length} pendientes · <span className="tabular">{formatEUR(total)}</span>
                  </span>
                </div>
              </div>
            )}
            <ul className="divide-y divide-line">
              {list.map((j) => (
                <JobRow key={j.id} job={j} checked={selected.has(j.id)} onToggle={() => toggle(j.id)} />
              ))}
            </ul>
            {unbilled.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5">
                <span className="text-[12px] text-ink-3">{sel.length ? `${sel.length} seleccionados` : 'Selecciona trabajos o factura todos'}</span>
                <Button variant="primary" size="sm" icon={<FilePlus2 size={14} />} onClick={() => invoice(cid, (sel.length ? sel : unbilled).map((j) => j.id))}>
                  {sel.length ? `Facturar ${sel.length}` : `Facturar todo · ${formatEUR(total)}`}
                </Button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function JobRow({ job, checked, onToggle }: { job: Job; checked: boolean; onToggle: () => void }) {
  const billed = !!job.invoiceId;
  return (
    <li className={clsx('flex items-center gap-3 px-4 py-2.5', billed && 'opacity-55')}>
      <input type="checkbox" disabled={billed} checked={checked} onChange={onToggle} className="h-4 w-4 accent-[var(--ink)]" aria-label={`Seleccionar ${job.concept}`} />
      <span className="tabular w-16 shrink-0 text-[12px] text-ink-3">{shortDate(job.date)}</span>
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {job.concept}
        {job.quantity !== 1 && <span className="text-ink-3"> × {job.quantity}</span>}
      </span>
      {billed && <Badge tone="ok">Facturado</Badge>}
      <span className="tabular w-24 text-right text-[13px] font-semibold">{formatEUR(Math.round(job.quantity * job.unitPrice))}</span>
      {!billed && (
        <button type="button" aria-label="Eliminar trabajo" className="text-ink-3 hover:text-danger" onClick={() => act('job.delete', { id: job.id }, 'Trabajo eliminado')}>
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}

function QuickJob({ clientId, clients }: { clientId?: string; clients: Client[] }) {
  const active = clients.filter((c) => c.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const [cid, setCid] = useState(clientId ?? '');
  const client = active.find((c) => c.id === (clientId ?? cid));
  const [concept, setConcept] = useState('');
  const [date, setDate] = useState(todayISO());
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const effectivePrice = price ?? client?.billing.defaultRate ?? null;

  const add = async () => {
    const target = clientId ?? cid;
    if (!target || !concept.trim() || effectivePrice === null) return;
    setBusy(true);
    const r = await act('job.create', { clientId: target, date, concept: concept.trim(), quantity: Number(qty.replace(',', '.')) || 1, unitPrice: effectivePrice });
    setBusy(false);
    if (r) {
      setConcept('');
      setPrice(null);
      setQty('1');
    }
  };

  return (
    <Card className="p-3">
      <p className="eyebrow mb-2 text-ink-3">Apuntar trabajo hecho</p>
      <form
        className="grid grid-cols-2 gap-2 md:grid-cols-[1.2fr_2fr_120px_70px_120px_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        {!clientId && (
          <Select value={cid} onChange={(e) => setCid(e.target.value)} aria-label="Cliente" required>
            <option value="">Cliente…</option>
            {active.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder={client?.billing.defaultConcept || 'Flyer estático, story, reel…'} aria-label="Concepto" className={clsx(clientId && 'md:col-span-2')} required />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha" />
        <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" aria-label="Cantidad" title="Cantidad" />
        <MoneyInput value={effectivePrice} onChange={setPrice} placeholder="Precio" />
        <Button type="submit" variant="primary" icon={<Plus size={14} />} loading={busy} disabled={!concept.trim() || effectivePrice === null || (!clientId && !cid)}>
          Añadir
        </Button>
      </form>
      {client?.billing.defaultRate && price === null && <p className="mt-1.5 text-[11.5px] text-ink-3">Precio habitual de {client.name}: {formatEUR(client.billing.defaultRate)}</p>}
    </Card>
  );
}
