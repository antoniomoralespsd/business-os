'use client';
import clsx from 'clsx';
import { Archive, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory } from '@bos/schemas';
import { formatEUR, MONTHS, splitVat, todayISO } from '@bos/domain';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, MoneyInput, Segmented, Select, Sheet, Textarea, Toggle } from '@/components/ui/kit';
import { act, useExpenses, useInbox } from '@/data/hooks';
import { shortDate } from '@/lib/format';
import { EXPENSE_CATEGORY_LABEL } from './status';

type Filter = 'all' | 'pending' | 'month';

const monthName = (ym: string) => {
  const n = MONTHS[Number(ym.slice(5, 7)) - 1] ?? '';
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${ym.slice(0, 4)}`;
};
function byMonth(list: Expense[]): [string, Expense[]][] {
  const m = new Map<string, Expense[]>();
  for (const e of list) m.set(e.date.slice(0, 7), [...(m.get(e.date.slice(0, 7)) ?? []), e]);
  return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

export function ExpensesPanel({ initialFilter }: { initialFilter?: Filter }) {
  const { data } = useExpenses();
  const { data: inbox } = useInbox();
  const driveOf = useMemo(() => new Map((inbox ?? []).filter((i) => i.drive).map((i) => [i.id, i.drive!.webViewLink])), [inbox]);
  const [filter, setFilter] = useState<Filter>(initialFilter ?? 'all');
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const month = todayISO().slice(0, 7);
  const list = useMemo(
    () =>
      (data ?? [])
        .filter((e) => !e.archived)
        .filter((e) => (filter === 'pending' ? e.status === 'pending' : filter === 'month' ? e.date.startsWith(month) : true))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data, filter, month],
  );
  const total = list.reduce((s, e) => s + e.total, 0);
  const editing = open && open !== 'new' ? (data ?? []).find((e) => e.id === open) ?? null : null;

  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'month', label: 'Este mes' },
            { value: 'pending', label: 'Sin factura' },
          ]}
        />
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-ink-3">
            {list.length} gastos · <span className="tabular font-semibold text-ink">{formatEUR(total)}</span>
          </span>
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setOpen('new')}>
            Nuevo gasto
          </Button>
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState title="Sin gastos aquí">Sube tickets y facturas al Inbox y se registran solos, o añádelos a mano.</EmptyState>
      ) : (
        <div className="space-y-5">
          {byMonth(list).map(([ym, rows]) => (
            <section key={ym}>
              <p className="eyebrow mb-2 flex items-baseline gap-2 text-ink-2">
                {monthName(ym)}
                <span className="tabular font-normal text-ink-3">
                  · {rows.length} · {formatEUR(rows.reduce((s, e) => s + e.total, 0))} · IVA {formatEUR(rows.reduce((s, e) => s + e.vat, 0))}
                </span>
              </p>
              <Card>
                <ul className="divide-y divide-line">
                  {rows.map((e) => {
                    const link = e.fileId ? driveOf.get(e.fileId) : undefined;
                    return (
                      <li key={e.id} className="flex items-center hover:bg-surface-2">
                        <button type="button" onClick={() => setOpen(e.id)} className="grid min-w-0 flex-1 grid-cols-[56px_1fr_auto] items-center gap-3 py-3 pl-4 text-left md:grid-cols-[64px_1fr_130px_70px_110px]">
                          <span className="tabular text-[12px] text-ink-3">{shortDate(e.date)}</span>
                          <span className="min-w-0 truncate text-[13px]">
                            <span className="font-medium">{e.vendor}</span>
                            {e.invoiceNumber && <span className="text-ink-3"> · {e.invoiceNumber}</span>}
                          </span>
                          <span className="hidden text-[12px] text-ink-2 md:block">{EXPENSE_CATEGORY_LABEL[e.category]}</span>
                          <span className="tabular hidden text-[12px] text-ink-3 md:block">{e.status === 'pending' ? <Badge tone="warn">Sin factura</Badge> : `IVA ${e.vatRate} %`}</span>
                          <span className={clsx('tabular text-right text-[13.5px] font-semibold', !e.deductible && 'text-ink-3')}>{formatEUR(e.total)}</span>
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
                  })}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
      <ExpenseSheet open={open !== null} expense={editing} onClose={() => setOpen(null)} />
    </div>
  );
}

function ExpenseSheet({ open, expense, onClose }: { open: boolean; expense: Expense | null; onClose: () => void }) {
  const [date, setDate] = useState(todayISO());
  const [vendor, setVendor] = useState('');
  const [concept, setConcept] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('software');
  const [total, setTotal] = useState<number | null>(null);
  const [vat, setVat] = useState('21');
  const [deductible, setDeductible] = useState(true);
  const [hasInvoice, setHasInvoice] = useState(true);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(expense?.date ?? todayISO());
    setVendor(expense?.vendor ?? '');
    setConcept(expense?.concept ?? '');
    setCategory(expense?.category ?? 'software');
    setTotal(expense?.total ?? null);
    setVat(String(expense?.vatRate ?? 21));
    setDeductible(expense?.deductible ?? true);
    setHasInvoice(expense ? expense.status === 'confirmed' : true);
    setInvoiceNumber(expense?.invoiceNumber ?? '');
    setNotes(expense?.notes ?? '');
  }, [open, expense?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const split = total !== null ? splitVat(total, Number(vat) || 0) : null;
  const save = async () => {
    if (!vendor.trim() || total === null) return;
    setBusy(true);
    const payload = { date, vendor: vendor.trim(), concept, category, total, vatRate: Number(vat) || 0, deductible, status: hasInvoice ? 'confirmed' : 'pending', invoiceNumber, notes };
    const r = expense ? await act('expense.update', { id: expense.id, patch: payload }, 'Gasto guardado') : await act('expense.create', payload, 'Gasto registrado');
    setBusy(false);
    if (r) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow="Gasto"
      title={expense ? expense.vendor : 'Nuevo gasto'}
      footer={
        <>
          {expense && (
            <>
              <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 size={14} />} onClick={async () => (await act('expense.delete', { id: expense.id }, 'Gasto eliminado')) && onClose()}>
                Eliminar
              </Button>
              <Button variant="ghost" icon={<Archive size={14} />} onClick={async () => (await act('expense.archive', { id: expense.id }, 'Gasto archivado')) && onClose()}>
                Archivar
              </Button>
            </>
          )}
          <Button variant="primary" loading={busy} disabled={!vendor.trim() || total === null} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Proveedor" className="col-span-2">
          <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Adobe, MediaMarkt…" autoFocus={!expense} />
        </Field>
        <Field label="Concepto" className="col-span-2">
          <Input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Opcional" />
        </Field>
        <Field label="Fecha">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Categoría">
          <Select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Total pagado (IVA incl.)">
          <MoneyInput value={total} onChange={setTotal} />
        </Field>
        <Field label="IVA %" hint={split ? `Base ${formatEUR(split.base)} · IVA ${formatEUR(split.vat)}` : undefined}>
          <Select value={vat} onChange={(e) => setVat(e.target.value)}>
            {['21', '10', '4', '0'].map((v) => (
              <option key={v} value={v}>
                {v} %
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nº de factura" className="col-span-2">
          <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Opcional" />
        </Field>
        <div className="col-span-2 flex flex-col gap-3">
          <Toggle on={deductible} onChange={setDeductible} label="Deducible (gasto de la actividad)" />
          <Toggle on={hasInvoice} onChange={setHasInvoice} label="Tengo la factura o ticket" />
        </div>
        <Field label="Notas" className="col-span-2">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
