'use client';
import { ArchiveRestore, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { formatEUR, MONTHS, startOfWeek, todayISO } from '@bos/domain';
import { Badge, Card, EmptyState, Input, Loading, PageHeader, Tabs } from '@/components/ui/kit';
import { act, useClientMap, useClients, useExpenses, useInvoices, useJobs, useSubscriptions, useTasksAll } from '@/data/hooks';
import { clientColor } from '@/lib/clientColors';
import { shortDate } from '@/lib/format';
import { invoiceStatusText, invoiceTone } from '@/features/billing/status';

type Tab = 'tasks' | 'clients' | 'invoices' | 'expenses' | 'subscriptions';

const monthKey = (d: string) => d.slice(0, 7);
const monthLabel = (k: string) => {
  const [y, m] = k.split('-').map(Number) as [number, number];
  const name = MONTHS[m - 1]!;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

function groupByMonth<T>(rows: T[], date: (r: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(monthKey(date(r)), [...(m.get(monthKey(date(r))) ?? []), r]);
  return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function Restore({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-[12px] font-semibold text-ink-2 hover:bg-surface-3 hover:text-ink">
      <ArchiveRestore size={13} /> Recuperar
    </button>
  );
}

function Month({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <section>
      <p className="eyebrow mb-2 text-ink-2">
        {label} <span className="tabular font-normal text-ink-3">· {count}</span>
      </p>
      <Card>
        <ul className="divide-y divide-line">{children}</ul>
      </Card>
    </section>
  );
}

export function ArchiveView() {
  const [tab, setTab] = useState<Tab>('tasks');
  const [q, setQ] = useState('');
  const { data: clients } = useClients();
  const byId = useClientMap(clients);
  const { data: tasks } = useTasksAll();
  const { data: invoices } = useInvoices();
  const { data: expenses } = useExpenses();
  const { data: jobs } = useJobs();
  const { data: subs } = useSubscriptions();
  const weekStart = startOfWeek(todayISO());
  const match = (s: string) => !q || norm(s).includes(norm(q));

  // Archived tasks + completed ones from before this week (they no longer show in the calendar).
  const oldTasks = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => t.archived || (t.status === 'completed' && (t.dueDate ?? t.completedAt?.slice(0, 10) ?? '') < weekStart))
        .filter((t) => match(`${t.title} ${t.clientId ? byId.get(t.clientId)?.name ?? '' : ''} ${t.description}`)),
    [tasks, weekStart, q, byId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const archivedClients = (clients ?? []).filter((c) => c.status === 'archived' && match(c.name));
  const oldInvoices = (invoices ?? []).filter((i) => (i.archived || i.status === 'cancelled' || (i.status === 'paid' && i.date < weekStart.slice(0, 8) + '01')) && match(`${i.invoiceNumber ?? ''} ${i.client.name}`));
  const oldExpenses = (expenses ?? []).filter((e) => e.archived && match(`${e.vendor} ${e.concept}`));
  const oldJobs = (jobs ?? []).filter((j) => j.archived && match(j.concept));
  const oldSubs = (subs ?? []).filter((s) => s.status === 'cancelled' && match(s.name));

  const loading = !tasks || !clients || !invoices || !expenses || !subs || !jobs;
  return (
    <div className="pb-16">
      <PageHeader
        title="Archivo"
        actions={
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el archivo" className="w-[220px] pl-8" />
          </div>
        }
      />
      <p className="mt-2 max-w-2xl px-4 text-[13.5px] text-ink-2 md:px-8">Lo antiguo, fuera de la vista pero ordenado por mes. Nada se borra: puedes recuperarlo cuando quieras.</p>
      <div className="mt-5">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'tasks', label: 'Tareas', count: oldTasks.length },
            { value: 'clients', label: 'Clientes', count: archivedClients.length },
            { value: 'invoices', label: 'Facturas', count: oldInvoices.length },
            { value: 'expenses', label: 'Gastos y trabajos', count: oldExpenses.length + oldJobs.length },
            { value: 'subscriptions', label: 'Suscripciones', count: oldSubs.length },
          ]}
        />
      </div>
      <div className="space-y-6 px-4 pt-6 md:px-8">
        {loading ? (
          <Loading rows={4} />
        ) : tab === 'tasks' ? (
          oldTasks.length === 0 ? (
            <EmptyState title="Sin tareas archivadas">Las tareas completadas de semanas anteriores y las que archives aparecen aquí, por mes.</EmptyState>
          ) : (
            groupByMonth(oldTasks, (t) => t.dueDate ?? t.completedAt ?? t.createdAt).map(([k, rows]) => (
              <Month key={k} label={monthLabel(k)} count={rows.length}>
                {rows
                  .sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? ''))
                  .map((t) => {
                    const c = t.clientId ? byId.get(t.clientId) : undefined;
                    return (
                      <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                        <span className="tabular w-14 shrink-0 text-[12px] text-ink-3">{shortDate(t.dueDate)}</span>
                        {c && <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: clientColor(c.color) }} />}
                        <span className="min-w-0 flex-1 truncate">
                          {c && <span className="eyebrow mr-2 text-[9.5px] text-ink-3">{c.shortName || c.name}</span>}
                          {t.title}
                        </span>
                        {t.archived ? <Restore onClick={() => act('task.unarchive', { id: t.id }, 'Tarea recuperada')} /> : <Badge tone="ok">Hecha</Badge>}
                      </li>
                    );
                  })}
              </Month>
            ))
          )
        ) : tab === 'clients' ? (
          archivedClients.length === 0 ? (
            <EmptyState title="Ningún cliente archivado" />
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {archivedClients.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: clientColor(c.color) }} />
                    <Link href={`/clients?c=${c.id}`} className="font-display min-w-0 flex-1 truncate text-[20px] hover:underline">
                      {c.name}
                    </Link>
                    <Restore onClick={() => act('client.unarchive', { id: c.id }, 'Cliente recuperado')} />
                  </li>
                ))}
              </ul>
            </Card>
          )
        ) : tab === 'invoices' ? (
          oldInvoices.length === 0 ? (
            <EmptyState title="Sin facturas antiguas">Las facturas cobradas de meses anteriores, las anuladas y las que archives se guardan aquí.</EmptyState>
          ) : (
            groupByMonth(oldInvoices, (i) => i.date).map(([k, rows]) => (
              <Month key={k} label={monthLabel(k)} count={rows.length}>
                {rows.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                    <span className="tabular w-24 shrink-0 font-semibold">{i.invoiceNumber ?? 'Borrador'}</span>
                    <span className="min-w-0 flex-1 truncate">{i.client.name}</span>
                    <Badge tone={invoiceTone(i)}>{invoiceStatusText(i)}</Badge>
                    <span className="tabular w-24 text-right font-semibold">{formatEUR(i.total)}</span>
                    {i.archived && <Restore onClick={() => act('invoice.unarchive', { id: i.id }, 'Factura recuperada')} />}
                  </li>
                ))}
              </Month>
            ))
          )
        ) : tab === 'expenses' ? (
          oldExpenses.length + oldJobs.length === 0 ? (
            <EmptyState title="Nada archivado" />
          ) : (
            <>
              {groupByMonth(oldExpenses, (e) => e.date).map(([k, rows]) => (
                <Month key={`e-${k}`} label={`Gastos · ${monthLabel(k)}`} count={rows.length}>
                  {rows.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <span className="tabular w-14 shrink-0 text-[12px] text-ink-3">{shortDate(e.date)}</span>
                      <span className="min-w-0 flex-1 truncate">{e.vendor}</span>
                      <span className="tabular w-24 text-right font-semibold">{formatEUR(e.total)}</span>
                      <Restore onClick={() => act('expense.unarchive', { id: e.id }, 'Gasto recuperado')} />
                    </li>
                  ))}
                </Month>
              ))}
              {oldJobs.length > 0 && (
                <Month label="Trabajos archivados" count={oldJobs.length}>
                  {oldJobs.map((j) => (
                    <li key={j.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <span className="tabular w-14 shrink-0 text-[12px] text-ink-3">{shortDate(j.date)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {byId.get(j.clientId)?.name} · {j.concept}
                      </span>
                      <Restore onClick={() => act('job.unarchive', { id: j.id }, 'Trabajo recuperado')} />
                    </li>
                  ))}
                </Month>
              )}
            </>
          )
        ) : oldSubs.length === 0 ? (
          <EmptyState title="Sin suscripciones canceladas" />
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {oldSubs.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  <span className="text-ink-3">{s.lastChargeDate ? `Último cobro ${shortDate(s.lastChargeDate)}` : ''}</span>
                  <span className="tabular w-24 text-right">{formatEUR(s.amount)}</span>
                  <Restore onClick={() => act('subscription.update', { id: s.id, patch: { status: 'active' } }, 'Suscripción reactivada')} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
