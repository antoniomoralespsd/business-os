'use client';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatEUR, quarterLabel, quarterOf, quarterRange, summarizeQuarter, todayISO, countsAsIncome, type Quarter } from '@bos/domain';
import { Button, Card, Loading, Select } from '@/components/ui/kit';
import { useExpenses, useInvoices } from '@/data/hooks';
import { downloadText, numericDate, toCsv } from '@/lib/format';
import { EXPENSE_CATEGORY_LABEL } from './status';

/** Quarterly summary for the gestoría (modelo 303 / 130 estimates) + CSV export. */
export function QuarterPanel() {
  const { data: invoices } = useInvoices();
  const { data: expenses } = useExpenses();
  const now = quarterOf(todayISO());
  const [sel, setSel] = useState(`${now.year}-${now.q}`);
  const [year, q] = sel.split('-').map(Number) as [number, Quarter];
  const options = useMemo(() => {
    const out: { year: number; q: Quarter }[] = [];
    for (let i = 0; i < 8; i++) {
      const idx = now.year * 4 + (now.q - 1) - i;
      out.push({ year: Math.floor(idx / 4), q: ((idx % 4) + 1) as Quarter });
    }
    return out;
  }, [now.year, now.q]);

  if (!invoices || !expenses) return <Loading />;
  const s = summarizeQuarter(invoices, expenses, year, q);
  const { from, to } = quarterRange(year, q);

  const exportCsv = () => {
    const inv = invoices.filter((i) => countsAsIncome(i) && i.date >= from && i.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    const exp = expenses.filter((e) => !e.archived && e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    const rows: (string | number)[][] = [
      ['INGRESOS'],
      ['Fecha', 'Nº factura', 'Cliente', 'NIF', 'Base', 'IVA %', 'IVA', 'IRPF %', 'IRPF', 'Total', 'Estado'],
      ...inv.map((i) => [numericDate(i.date), i.invoiceNumber ?? '', i.client.legalName || i.client.name, i.client.taxId, i.subtotal / 100, i.vatRate, i.tax / 100, i.irpfRate, i.withholding / 100, i.total / 100, i.status === 'paid' ? 'Cobrada' : 'Pendiente']),
      [],
      ['GASTOS'],
      ['Fecha', 'Proveedor', 'NIF', 'Nº factura', 'Categoría', 'Base', 'IVA %', 'IVA', 'Total', 'Deducible', 'Documento'],
      ...exp.map((e) => [numericDate(e.date), e.vendor, e.vendorTaxId, e.invoiceNumber, EXPENSE_CATEGORY_LABEL[e.category] ?? e.category, e.base / 100, e.vatRate, e.vat / 100, e.total / 100, e.deductible ? 'Sí' : 'No', e.fileId ? 'Sí' : 'FALTA']),
    ];
    downloadText(`T${q}_${year}_ingresos_gastos.csv`, toCsv(rows));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={sel} onChange={(e) => setSel(e.target.value)} className="w-auto" aria-label="Trimestre">
          {options.map((o) => (
            <option key={`${o.year}-${o.q}`} value={`${o.year}-${o.q}`}>
              {quarterLabel(o.year, o.q)}
            </option>
          ))}
        </Select>
        <Button icon={<Download size={14} />} onClick={exportCsv}>
          Exportar para la gestoría (CSV)
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card accent className="p-5">
          <p className="eyebrow text-ink-2">Ingresos · {s.invoices} facturas</p>
          <p className="font-display tabular mt-2 text-[40px] leading-none">{formatEUR(s.incomeBase)}</p>
          <p className="mt-1 text-[12px] text-ink-3">Base imponible</p>
          <dl className="mt-4 space-y-1 text-[13px]">
            <Line k="IVA repercutido" v={formatEUR(s.vatCollected)} />
            <Line k="IRPF que te han retenido" v={formatEUR(s.irpfWithheld)} />
            <Line k="Total facturado" v={formatEUR(s.incomeTotal)} />
          </dl>
        </Card>
        <Card className="p-5">
          <p className="eyebrow text-ink-2">Gastos · {s.expenses}</p>
          <p className="font-display tabular mt-2 text-[40px] leading-none">{formatEUR(s.expenseBase)}</p>
          <p className="mt-1 text-[12px] text-ink-3">Base deducible</p>
          <dl className="mt-4 space-y-1 text-[13px]">
            <Line k="IVA soportado deducible" v={formatEUR(s.vatPaid)} />
            <Line k="Total pagado" v={formatEUR(s.expenseTotal)} />
            {s.pendingExpenses > 0 && <Line k="Sin documento" v={`${s.pendingExpenses}`} warn />}
          </dl>
        </Card>
      </div>

      <Card className="p-5">
        <p className="eyebrow text-ink-2">Estimación de impuestos del trimestre</p>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <Est label="IVA a ingresar (303)" value={s.vatToPay} />
          <Est label="Rendimiento neto" value={s.profit} />
          <Est label="Pago fraccionado IRPF (130)" value={s.irpfInstallment} />
        </div>
        <p className="mt-4 text-[11.5px] leading-relaxed text-ink-3">
          Orientativo: 303 = IVA repercutido − IVA soportado deducible. 130 = 20 % del rendimiento − retenciones del trimestre (sin acumular trimestres anteriores). Confírmalo siempre con tu gestoría.
        </p>
      </Card>
    </div>
  );
}

function Line({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-2">{k}</dt>
      <dd className={warn ? 'font-semibold text-warn' : 'tabular'}>{v}</dd>
    </div>
  );
}

function Est({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[12px] text-ink-3">{label}</p>
      <p className={`font-display tabular mt-1 text-[28px] leading-none ${value < 0 ? 'text-ok' : ''}`}>{formatEUR(value)}</p>
    </div>
  );
}
