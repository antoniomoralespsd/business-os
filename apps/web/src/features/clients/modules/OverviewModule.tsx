'use client';
import { ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { bucketOf, formatEUR, STATUS_LABEL, todayISO, unbilledByClient } from '@bos/domain';
import { Badge, Card, Kpi } from '@/components/ui/kit';
import { useInvoices, useJobs, useTasksAll } from '@/data/hooks';
import { shortDate } from '@/lib/format';
import { LinkIcon } from './LinksModule';
import type { ClientModuleProps } from './registry';

export function OverviewModule({ client, goTo }: ClientModuleProps) {
  const f = [{ field: 'clientId', op: '==' as const, value: client.id }];
  const { data: tasks } = useTasksAll(f);
  const { data: jobs } = useJobs(f);
  const { data: invoices } = useInvoices(f);
  const today = todayISO();
  const year = today.slice(0, 4);

  const stats = useMemo(() => {
    const t = (tasks ?? []).filter((x) => !x.archived);
    const unbilled = unbilledByClient(jobs ?? []).get(client.id);
    const inv = (invoices ?? []).filter((i) => ['issued', 'sent', 'paid'].includes(i.status));
    return {
      action: t.filter((x) => bucketOf(x.status) === 'action').length,
      waiting: t.filter((x) => x.status === 'review').length,
      unbilled: unbilled?.amount ?? 0,
      unbilledCount: unbilled?.count ?? 0,
      yearBilled: inv.filter((i) => i.date.startsWith(year)).reduce((s, i) => s + i.subtotal, 0),
      toCollect: inv.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.total, 0),
      next: t
        .filter((x) => x.status !== 'completed' && x.dueDate && x.dueDate >= today)
        .sort((a, b) => (a.dueDate! + a.order).localeCompare(b.dueDate! + b.order))
        .slice(0, 6),
    };
  }, [tasks, jobs, invoices, client.id, today, year]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Kpi label="Requieren mi atención" value={stats.action} accent />
        <Kpi label="En revisión" value={stats.waiting} />
        <Kpi label="Sin facturar" value={formatEUR(stats.unbilled)} sub={stats.unbilledCount ? `${stats.unbilledCount} trabajos` : 'Nada pendiente'} />
        <Kpi label={`Facturado ${year}`} value={formatEUR(stats.yearBilled)} sub={stats.toCollect ? `Por cobrar ${formatEUR(stats.toCollect)}` : undefined} muted />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow text-ink-2">Próximas tareas</p>
            <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => goTo('tasks')}>
              Ver todas →
            </button>
          </div>
          {stats.next.length === 0 ? (
            <p className="py-3 text-[13px] text-ink-3">Nada programado.</p>
          ) : (
            <ul className="divide-y divide-line">
              {stats.next.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="tabular w-14 shrink-0 text-[12px] text-ink-3">{shortDate(t.dueDate)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  {t.status !== 'pending' && <Badge tone={t.status === 'changes_requested' ? 'changes' : t.status === 'review' ? 'neutral' : 'info'}>{STATUS_LABEL[t.status]}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow text-ink-2">Enlaces</p>
            <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => goTo('links')}>
              Gestionar →
            </button>
          </div>
          {client.links.length === 0 ? (
            <p className="py-3 text-[13px] text-ink-3">Añade sus carpetas de Drive, Dropbox o redes para tenerlo todo a un clic.</p>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {client.links.slice(0, 8).map((l) => (
                <li key={l.id}>
                  <a href={l.url} target="_blank" rel="noreferrer" className="group flex items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-[13px] hover:border-ink">
                    <LinkIcon kind={l.kind} />
                    <span className="min-w-0 flex-1 truncate">{l.label}</span>
                    <ExternalLink size={12} className="text-ink-3 opacity-0 group-hover:opacity-100" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {client.notes && (
        <Card className="p-4">
          <p className="eyebrow mb-2 text-ink-2">Notas</p>
          <p className="line-clamp-6 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{client.notes}</p>
        </Card>
      )}
    </div>
  );
}
