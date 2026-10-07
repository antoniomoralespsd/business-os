'use client';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import type { Invoice } from '@bos/schemas';
import { formatEUR } from '@bos/domain';
import { Badge, Card, EmptyState, Loading, Segmented } from '@/components/ui/kit';
import { useInvoices } from '@/data/hooks';
import { shortDate } from '@/lib/format';
import { invoiceStatusText, invoiceTone } from './status';

type Filter = 'open' | 'all' | 'draft' | 'paid';

/** Invoice list. With clientId → only that client's. Click opens the invoice sheet (handled by parent). */
export function InvoicesPanel({ clientId, onOpen }: { clientId?: string; onOpen: (id: string) => void }) {
  const { data } = useInvoices(clientId ? [{ field: 'clientId', op: '==', value: clientId }] : []);
  const [filter, setFilter] = useState<Filter>('all');
  const list = useMemo(() => {
    const rows = (data ?? []).filter((i) => !i.archived);
    const f = rows.filter((i) =>
      filter === 'all' ? i.status !== 'cancelled' : filter === 'open' ? i.status === 'issued' || i.status === 'sent' : i.status === filter,
    );
    return f.sort((a, b) => (b.date + (b.invoiceNumber ?? '')).localeCompare(a.date + (a.invoiceNumber ?? '')));
  }, [data, filter]);
  const pending = (data ?? []).filter((i) => i.status === 'issued' || i.status === 'sent').reduce((s, i) => s + i.total, 0);

  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'open', label: 'Por cobrar' },
            { value: 'draft', label: 'Borradores' },
            { value: 'paid', label: 'Cobradas' },
          ]}
        />
        {pending > 0 && (
          <p className="text-[12.5px] text-ink-3">
            Pendiente de cobro: <span className="tabular font-semibold text-ink">{formatEUR(pending)}</span>
          </p>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState title="Sin facturas aquí">Crea una factura desde los trabajos pendientes, o sube una factura antigua al Inbox para que quede registrada.</EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {list.map((i) => (
              <InvoiceRow key={i.id} inv={i} showClient={!clientId} onOpen={() => onOpen(i.id)} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function InvoiceRow({ inv, showClient, onOpen }: { inv: Invoice; showClient: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className={clsx('grid w-full grid-cols-[88px_1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 md:grid-cols-[110px_1fr_90px_110px_120px]', inv.status === 'cancelled' && 'opacity-50')}>
        <span className="tabular text-[13px] font-semibold">{inv.invoiceNumber ?? 'Borrador'}</span>
        <span className="min-w-0 truncate text-[13px]">
          {showClient && <span className="font-medium">{inv.client.name}</span>}
          {showClient && ' · '}
          <span className="text-ink-2">{inv.lines.length === 1 ? inv.lines[0]!.concept : `${inv.lines.length} conceptos`}</span>
        </span>
        <span className="tabular hidden text-[12px] text-ink-3 md:block">{shortDate(inv.date)}</span>
        <span className="hidden md:block">
          <Badge tone={invoiceTone(inv)}>{invoiceStatusText(inv)}</Badge>
        </span>
        <span className="tabular text-right text-[13.5px] font-semibold">{formatEUR(inv.total)}</span>
      </button>
    </li>
  );
}
