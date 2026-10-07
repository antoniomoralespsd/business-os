'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { billingAlerts, formatCompactEUR, formatEUR, quarterOf, summarizeQuarter, todayISO, unbilledByClient } from '@bos/domain';
import { AlertRow, Card, Kpi, PageHeader, Tabs } from '@/components/ui/kit';
import { useClientMap, useClients, useExpenses, useInvoices, useJobs } from '@/data/hooks';
import { ExpensesPanel } from './ExpensesPanel';
import { InvoiceSheet } from './InvoiceSheet';
import { InvoicesPanel } from './InvoicesPanel';
import { JobsPanel } from './JobsPanel';
import { QuarterPanel } from './QuarterPanel';
import { SheetsPanel } from './SheetsPanel';

type Tab = 'summary' | 'jobs' | 'invoices' | 'sheets' | 'expenses' | 'quarters';

export function BillingView() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'summary');
  const [invoiceId, setInvoiceId] = useState<string | null>(params.get('invoice'));
  const { data: jobs } = useJobs();
  const { data: invoices } = useInvoices();
  const { data: expenses } = useExpenses();
  const { data: clients } = useClients();
  const byId = useClientMap(clients);
  const today = todayISO();

  const kpis = useMemo(() => {
    const month = today.slice(0, 7);
    const inv = invoices ?? [];
    const billedMonth = inv.filter((i) => ['issued', 'sent', 'paid'].includes(i.status) && i.date.startsWith(month)).reduce((s, i) => s + i.subtotal, 0);
    const toCollect = inv.filter((i) => i.status === 'issued' || i.status === 'sent').reduce((s, i) => s + i.total, 0);
    const unbilled = [...unbilledByClient(jobs ?? []).values()].reduce((s, u) => s + u.amount, 0);
    const spentMonth = (expenses ?? []).filter((e) => !e.archived && e.date.startsWith(month)).reduce((s, e) => s + e.total, 0);
    return { billedMonth, toCollect, unbilled, spentMonth };
  }, [invoices, jobs, expenses, today]);

  const alerts = useMemo(
    () => (jobs && invoices && expenses ? billingAlerts({ jobs, invoices, expenses, clientName: (id) => byId.get(id)?.name ?? id }, today) : []),
    [jobs, invoices, expenses, byId, today],
  );
  const q = quarterOf(today);
  const quarter = invoices && expenses ? summarizeQuarter(invoices, expenses, q.year, q.q) : null;

  const go = (t: Tab) => {
    setTab(t);
    router.replace(`?tab=${t}`, { scroll: false });
  };

  return (
    <div className="pb-16">
      <PageHeader title="Facturación" />
      <div className="mt-5 flex flex-wrap gap-3 px-4 md:px-8">
        <Kpi label="Facturado este mes" value={formatCompactEUR(kpis.billedMonth)} sub="Base imponible" accent />
        <Kpi label="Pendiente de facturar" value={formatCompactEUR(kpis.unbilled)} sub="Trabajos sin factura" />
        <Kpi label="Por cobrar" value={formatCompactEUR(kpis.toCollect)} sub="Facturas emitidas" />
        <Kpi label="Gastos este mes" value={formatCompactEUR(kpis.spentMonth)} muted />
      </div>
      <div className="mt-6">
        <Tabs<Tab>
          value={tab}
          onChange={go}
          tabs={[
            { value: 'summary', label: 'Resumen', count: alerts.length },
            { value: 'jobs', label: 'Trabajos pendientes', count: (jobs ?? []).filter((j) => !j.invoiceId && !j.archived).length },
            { value: 'invoices', label: 'Facturas' },
            { value: 'sheets', label: 'Hojas en Drive' },
            { value: 'expenses', label: 'Gastos', count: (expenses ?? []).filter((e) => e.status === 'pending' && !e.archived).length },
            { value: 'quarters', label: 'Trimestres' },
          ]}
        />
      </div>
      <div className="px-4 pt-6 md:px-8">
        {tab === 'summary' && (
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Card className="p-2">
              <p className="eyebrow px-3 pb-1 pt-3 text-ink-2">Qué falta por hacer</p>
              {alerts.length === 0 ? <p className="px-3 pb-4 pt-2 text-[13px] text-ink-3">Todo en orden: nada pendiente de facturar, enviar ni cobrar.</p> : alerts.map((a) => <AlertRow key={a.id} alert={a} />)}
            </Card>
            {quarter && (
              <Card accent className="p-5">
                <p className="eyebrow text-ink-2">Trimestre en curso · T{q.q} {q.year}</p>
                <dl className="mt-4 space-y-2 text-[13px]">
                  <Line k="Ingresos (base)" v={formatEUR(quarter.incomeBase)} />
                  <Line k="Gastos deducibles (base)" v={formatEUR(quarter.expenseBase)} />
                  <Line k="IVA a ingresar (estimado)" v={formatEUR(quarter.vatToPay)} />
                  <Line k="Pago IRPF 130 (estimado)" v={formatEUR(quarter.irpfInstallment)} />
                </dl>
                <button type="button" className="mt-4 text-[12.5px] font-semibold text-ink-2 hover:text-ink" onClick={() => go('quarters')}>
                  Ver trimestres y exportar →
                </button>
              </Card>
            )}
          </div>
        )}
        {tab === 'jobs' && <JobsPanel onInvoiceCreated={setInvoiceId} />}
        {tab === 'invoices' && <InvoicesPanel onOpen={setInvoiceId} />}
        {tab === 'sheets' && <SheetsPanel />}
        {tab === 'expenses' && <ExpensesPanel initialFilter={params.get('filter') === 'pending' ? 'pending' : undefined} />}
        {tab === 'quarters' && <QuarterPanel />}
      </div>
      <InvoiceSheet invoiceId={invoiceId} onClose={() => setInvoiceId(null)} />
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-2">{k}</dt>
      <dd className="tabular font-semibold">{v}</dd>
    </div>
  );
}
