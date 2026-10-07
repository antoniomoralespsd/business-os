'use client';
import clsx from 'clsx';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { billingAlerts, formatEUR, subscriptionAlerts, todayISO, type Alert } from '@bos/domain';
import { AlertRow } from '@/components/ui/kit';
import { useClientMap, useClients, useExpenses, useInbox, useInvoices, useJobs, useSubscriptions } from '@/data/hooks';
import { usePersistentState } from '@/lib/usePersistentState';

/** "Revisar": everything that needs a decision, folded into the Tasks page. */
export function ReviewStrip() {
  const { data: jobs } = useJobs();
  const { data: invoices } = useInvoices();
  const { data: expenses } = useExpenses();
  const { data: subs } = useSubscriptions();
  const { data: inbox } = useInbox();
  const { data: clients } = useClients();
  const byId = useClientMap(clients);
  const [open, setOpen] = usePersistentState('bos.tasks.review', false);
  const today = todayISO();

  const alerts = useMemo<Alert[]>(() => {
    if (!jobs || !invoices || !expenses || !subs || !inbox) return [];
    const pendingInbox = inbox.filter((i) => i.status === 'needs_confirmation').length;
    return [
      ...(pendingInbox ? [{ id: 'inbox', severity: 'info' as const, title: `${pendingInbox} ${pendingInbox === 1 ? 'archivo' : 'archivos'} en el Inbox por confirmar`, href: '/inbox' }] : []),
      ...billingAlerts({ jobs, invoices, expenses, clientName: (id) => byId.get(id)?.name ?? id }, today),
      ...subscriptionAlerts(subs, today, formatEUR),
    ].sort((a, b) => sev(b) - sev(a));
  }, [jobs, invoices, expenses, subs, inbox, byId, today]);

  if (alerts.length === 0) return null;
  const top = alerts[0]!;
  return (
    <div className="mx-4 mt-3 overflow-hidden rounded-[10px] border border-line bg-surface md:mx-8">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2" aria-expanded={open}>
        <ShieldCheck size={15} className="shrink-0 text-ink-2" />
        <span className="eyebrow shrink-0 text-ink">Revisar · {alerts.length}</span>
        {!open && <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{top.title}</span>}
        {open && <span className="flex-1" />}
        <ChevronDown size={15} className={clsx('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid border-t border-line p-1 md:grid-cols-2">
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </div>
      )}
    </div>
  );
}

const sev = (a: Alert) => (a.severity === 'critical' ? 3 : a.severity === 'warning' ? 2 : 1);
