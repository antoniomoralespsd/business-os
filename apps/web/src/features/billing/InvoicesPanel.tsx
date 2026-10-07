'use client';
import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Invoice } from '@bos/schemas';
import { formatEUR, MONTHS } from '@bos/domain';
import { Badge, Card, EmptyState, Loading, Segmented } from '@/components/ui/kit';
import { useInbox, useInvoices } from '@/data/hooks';
import { shortDate } from '@/lib/format';
import { invoiceStatusText, invoiceTone } from './status';

type Filter = 'open' | 'all' | 'draft' | 'paid';
type GroupBy = 'none' | 'client' | 'month';

const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const n = MONTHS[m - 1] ?? '';
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${y}`;
};

/** Invoice list. With clientId → only that client's. Click opens the invoice sheet (handled by parent). */
export function InvoicesPanel({ clientId, onOpen }: { clientId?: string; onOpen: (id: string) => void }) {
  const { data } = useInvoices(clientId ? [{ field: 'clientId', op: '==', value: clientId }] : []);
  const [filter, setFilter] = useState<Filter>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('month');
  const { data: inbox } = useInbox();
  const driveOf = useMemo(() => new Map((inbox ?? []).filter((i) => i.drive).map((i) => [i.id, i.drive!.webViewLink])), [inbox]);
  const linkOf = (i: Invoice) => (i.fileId ? driveOf.get(i.fileId) : undefined);
  const list = useMemo(() => {
    const rows = (data ?? []).filter((i) => !i.archived);
    const f = rows.filter((i) =>
      filter === 'all' ? i.status !== 'cancelled' : filter === 'open' ? i.status === 'issued' || i.status === 'sent' : i.status === filter,
    );
    return f.sort((a, b) => (b.date + (b.invoiceNumber ?? '')).localeCompare(a.date + (a.invoiceNumber ?? '')));
  }, [data, filter]);
  const grouped = useMemo(() => {
    if (groupBy === 'none' || clientId) return null;
    const m = new Map<string, { label: string; rows: Invoice[] }>();
    for (const i of list) {
      const key = groupBy === 'client' ? i.clientId : i.date.slice(0, 7);
      const g = m.get(key) ?? { label: groupBy === 'client' ? i.client.name : monthName(key), rows: [] };
      g.rows.push(i);
      m.set(key, g);
    }
    const out = [...m.entries()];
    return groupBy === 'client' ? out.sort((a, b) => a[1].label.localeCompare(b[1].label)) : out.sort((a, b) => b[0].localeCompare(a[0]));
  }, [list, groupBy, clientId]);
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
        {!clientId && (
          <Segmented<GroupBy>
            size="sm"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'none', label: 'Lista' },
              { value: 'client', label: 'Por cliente' },
              { value: 'month', label: 'Por mes' },
            ]}
          />
        )}
        {pending > 0 && (
          <p className="text-[12.5px] text-ink-3">
            Pendiente de cobro: <span className="tabular font-semibold text-ink">{formatEUR(pending)}</span>
          </p>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState title="Sin facturas aquí">Crea una factura desde los trabajos pendientes, o sube una factura antigua al Inbox para que quede registrada.</EmptyState>
      ) : grouped ? (
        <div className="space-y-5">
          {grouped.map(([key, g]) => (
            <section key={key}>
              <p className="eyebrow mb-2 flex items-baseline gap-2 text-ink-2">
                {g.label} <span className="tabular font-normal text-ink-3">· {g.rows.length} · {formatEUR(g.rows.reduce((s, i) => s + i.total, 0))}</span>
              </p>
              <Card>
                <ul className="divide-y divide-line">
                  {g.rows.map((i) => (
                    <InvoiceRow key={i.id} inv={i} showClient={groupBy !== 'client'} onOpen={() => onOpen(i.id)} link={linkOf(i)} />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {list.map((i) => (
              <InvoiceRow key={i.id} inv={i} showClient={!clientId} onOpen={() => onOpen(i.id)} link={linkOf(i)} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function InvoiceRow({ inv, showClient, onOpen, link }: { inv: Invoice; showClient: boolean; onOpen: () => void; link?: string }) {
  return (
    <li className="flex items-center hover:bg-surface-2">
      <button type="button" onClick={onOpen} className={clsx('grid min-w-0 flex-1 grid-cols-[88px_1fr_auto] items-center gap-3 py-3 pl-4 text-left md:grid-cols-[110px_1fr_90px_110px_120px]', inv.status === 'cancelled' && 'opacity-50')}>
        <span className="tabular text-[13px] font-semibold">{inv.invoiceNumber ?? 'Borrador'}</span>
        <span className="min-w-0 truncate text-[13px]">
          {showClient && <span className="font-medium">{inv.client.name}</span>}
          {showClient && ' · '}
          <span className="text-ink-2">{inv.lines.length === 1 ? inv.lines[0]!.concept : `${inv.lines.length} conceptos`}</span>
        </span>
        <span className="tabular hidden text-[12px] text-ink-3 md:block">{shortDate(inv.date)}</span>
        <span className="hidden md:block">
          {inv.total < 0 ? <Badge tone="changes">Rectificativa</Badge> : <Badge tone={invoiceTone(inv)}>{invoiceStatusText(inv)}</Badge>}
        </span>
        <span className="tabular text-right text-[13.5px] font-semibold">{formatEUR(inv.total)}</span>
      </button>
      <span className="w-10 shrink-0 text-center">
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="inline-grid h-7 w-7 place-items-center rounded-[4px] text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Ver en Drive" title="Ver en Drive">
            <ExternalLink size={13} />
          </a>
        )}
      </span>
    </li>
  );
}
