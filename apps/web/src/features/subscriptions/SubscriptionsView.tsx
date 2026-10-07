'use client';
import clsx from 'clsx';
import { CalendarClock, ExternalLink, Plus, Receipt, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BILLING_CYCLES, SUBSCRIPTION_CATEGORIES, SUBSCRIPTION_STATUSES, type Subscription } from '@bos/schemas';
import {
  CYCLE_LABEL,
  daysBetween,
  formatEUR,
  isActiveSubscription,
  monthlyEquivalent,
  renewalWindow,
  subscriptionAlerts,
  subscriptionTotals,
  todayISO,
  yearlyEquivalent,
  type RenewalWindow,
} from '@bos/domain';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AlertRow, Badge, Button, Card, EmptyState, Field, Input, Kpi, Loading, MoneyInput, PageHeader, Select, Sheet, Textarea, Toggle } from '@/components/ui/kit';
import { act, useSubscriptions } from '@/data/hooks';
import { shortDate } from '@/lib/format';

const CATEGORY_LABEL: Record<Subscription['category'], string> = {
  software: 'Software',
  almacenamiento: 'Almacenamiento',
  dominio: 'Dominio',
  hosting: 'Hosting',
  musica: 'Música',
  ia: 'IA',
  streaming: 'Streaming',
  telefono: 'Teléfono',
  otros: 'Otros',
};
const STATUS_LABEL: Record<Subscription['status'], string> = { trial: 'Prueba', active: 'Activa', paused: 'Pausada', cancelled: 'Cancelada' };
const WINDOW_LABEL: Record<RenewalWindow, string> = { overdue: 'Cobro sin registrar', week: 'Esta semana', month: 'Este mes', later: 'Más adelante', none: 'Sin fecha de renovación' };
const WINDOW_ORDER: RenewalWindow[] = ['overdue', 'week', 'month', 'later', 'none'];

export function SubscriptionsView() {
  const { data } = useSubscriptions();
  const params = useSearchParams();
  const [open, setOpen] = useState<string | 'new' | null>(params.get('s'));
  const today = todayISO();

  const active = useMemo(() => (data ?? []).filter(isActiveSubscription), [data]);
  const totals = useMemo(() => subscriptionTotals(data ?? []), [data]);
  const alerts = useMemo(() => subscriptionAlerts(data ?? [], today, formatEUR), [data, today]);
  const groups = useMemo(() => {
    const m = new Map<RenewalWindow, Subscription[]>();
    for (const s of active) {
      const w = renewalWindow(s, today);
      m.set(w, [...(m.get(w) ?? []), s]);
    }
    for (const l of m.values()) l.sort((a, b) => (a.nextRenewalDate ?? '9999').localeCompare(b.nextRenewalDate ?? '9999'));
    return WINDOW_ORDER.filter((w) => m.has(w)).map((w) => [w, m.get(w)!] as const);
  }, [active, today]);
  const inactive = (data ?? []).filter((s) => !isActiveSubscription(s));
  const editing = open && open !== 'new' ? (data ?? []).find((s) => s.id === open) ?? null : null;

  return (
    <div className="pb-16">
      <PageHeader
        title="Suscripciones"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setOpen('new')}>
            Nueva suscripción
          </Button>
        }
      />
      <div className="mt-5 flex flex-wrap gap-3 px-4 md:px-8">
        <Kpi label="Al mes" value={formatEUR(totals.monthly)} sub={`${totals.active} activas`} accent />
        <Kpi label="Al año" value={formatEUR(totals.yearly)} />
        <Kpi label="Deducible al año" value={formatEUR(totals.deductibleYearly)} muted />
      </div>

      <div className="grid gap-6 px-4 pt-6 md:px-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {!data ? (
            <Loading rows={4} />
          ) : active.length === 0 ? (
            <EmptyState title="Sin suscripciones" action={<Button variant="primary" onClick={() => setOpen('new')}>Añadir la primera</Button>}>
              Apunta todo lo que pagas de forma recurrente: Adobe, Google One, dominios, plugins, IA… y te aviso antes de cada cobro.
            </EmptyState>
          ) : (
            groups.map(([w, list]) => (
              <section key={w}>
                <p className={clsx('eyebrow mb-2', w === 'overdue' ? 'text-warn' : 'text-ink-2')}>{WINDOW_LABEL[w]}</p>
                <Card>
                  <ul className="divide-y divide-line">
                    {list.map((s) => (
                      <SubRow key={s.id} s={s} today={today} onOpen={() => setOpen(s.id)} />
                    ))}
                  </ul>
                </Card>
              </section>
            ))
          )}
          {inactive.length > 0 && (
            <section>
              <p className="eyebrow mb-2 text-ink-3">Canceladas y pausadas</p>
              <Card>
                <ul className="divide-y divide-line">
                  {inactive.map((s) => (
                    <SubRow key={s.id} s={s} today={today} onOpen={() => setOpen(s.id)} />
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>
        <aside>
          <Card className="p-2">
            <p className="eyebrow px-3 pb-1 pt-3 text-ink-2">Avisos</p>
            {alerts.length === 0 ? <p className="px-3 pb-4 pt-2 text-[13px] text-ink-3">Nada que vigilar estos días.</p> : alerts.map((a) => <AlertRow key={a.id} alert={a} />)}
          </Card>
        </aside>
      </div>
      <SubscriptionSheet open={open !== null} sub={editing} onClose={() => setOpen(null)} />
    </div>
  );
}

function SubRow({ s, today, onOpen }: { s: Subscription; today: string; onOpen: () => void }) {
  const days = s.nextRenewalDate ? daysBetween(today, s.nextRenewalDate) : null;
  const inactive = !isActiveSubscription(s);
  return (
    <li className={clsx('flex items-center gap-3 px-4 py-3', inactive && 'opacity-55')}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">
            {s.name}
            {s.plan && <span className="font-normal text-ink-3"> · {s.plan}</span>}
          </p>
          <p className="truncate text-[11.5px] text-ink-3">
            {CATEGORY_LABEL[s.category]} · {CYCLE_LABEL[s.cycle]}
            {s.cycle !== 'monthly' && ` · ${formatEUR(monthlyEquivalent(s))}/mes`}
            {s.account && ` · ${s.account}`}
          </p>
        </div>
        <div className="hidden text-right sm:block">
          {s.status === 'trial' && <Badge tone="warn">Prueba{s.endDate ? ` hasta ${shortDate(s.endDate)}` : ''}</Badge>}
          {s.status !== 'trial' && s.nextRenewalDate && (
            <span className={clsx('text-[12px]', days !== null && days < 0 ? 'font-semibold text-warn' : days !== null && days <= 7 ? 'font-semibold text-ink' : 'text-ink-3')}>
              {days !== null && days < 0 ? `Tocaba el ${shortDate(s.nextRenewalDate)}` : days === 0 ? 'Hoy' : days === 1 ? 'Mañana' : `${shortDate(s.nextRenewalDate)}`}
            </span>
          )}
          {inactive && <Badge>{STATUS_LABEL[s.status]}</Badge>}
        </div>
        <span className="tabular w-24 text-right text-[14px] font-semibold">{formatEUR(s.amount)}</span>
      </button>
      {isActiveSubscription(s) && s.nextRenewalDate && days !== null && days <= 3 && (
        <Button size="sm" icon={<Receipt size={13} />} onClick={() => act('subscription.charge', { id: s.id }, `Cobro de ${s.name} registrado como gasto`)}>
          Cobrado
        </Button>
      )}
    </li>
  );
}

function SubscriptionSheet({ open, sub, onClose }: { open: boolean; sub: Subscription | null; onClose: () => void }) {
  const empty = { name: '', vendor: '', category: 'software' as Subscription['category'], plan: '', amount: null as number | null, vatRate: '21', cycle: 'monthly' as Subscription['cycle'], nextRenewalDate: todayISO(), endDate: '', status: 'active' as Subscription['status'], autoRenew: true, remindDaysBefore: '7', account: '', paymentLabel: '', manageUrl: '', deductible: true, notes: '' };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(
      sub
        ? { name: sub.name, vendor: sub.vendor, category: sub.category, plan: sub.plan, amount: sub.amount, vatRate: String(sub.vatRate), cycle: sub.cycle, nextRenewalDate: sub.nextRenewalDate ?? '', endDate: sub.endDate ?? '', status: sub.status, autoRenew: sub.autoRenew, remindDaysBefore: String(sub.remindDaysBefore), account: sub.account, paymentLabel: sub.paymentLabel, manageUrl: sub.manageUrl, deductible: sub.deductible, notes: sub.notes }
        : empty,
    );
  }, [open, sub?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.name.trim() || f.amount === null) return;
    setBusy(true);
    const payload = {
      name: f.name.trim(),
      vendor: f.vendor,
      category: f.category,
      plan: f.plan,
      amount: f.amount,
      vatRate: Number(f.vatRate) || 0,
      cycle: f.cycle,
      nextRenewalDate: f.nextRenewalDate || null,
      endDate: f.endDate || null,
      status: f.status,
      autoRenew: f.autoRenew,
      remindDaysBefore: Number(f.remindDaysBefore) || 0,
      account: f.account,
      paymentLabel: f.paymentLabel,
      manageUrl: f.manageUrl,
      deductible: f.deductible,
      notes: f.notes,
      ...(sub ? {} : { startDate: f.nextRenewalDate || null }),
    };
    const r = sub ? await act('subscription.update', { id: sub.id, patch: payload }, 'Suscripción guardada') : await act('subscription.create', payload, 'Suscripción añadida');
    setBusy(false);
    if (r) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow="Suscripción"
      title={sub ? sub.name : 'Nueva suscripción'}
      footer={
        <>
          {sub && (
            <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>
              Eliminar
            </Button>
          )}
          {sub && isActiveSubscription(sub) && sub.nextRenewalDate && (
            <Button icon={<Receipt size={14} />} onClick={async () => (await act('subscription.charge', { id: sub.id }, 'Cobro registrado como gasto')) && onClose()}>
              Registrar cobro
            </Button>
          )}
          <Button variant="primary" loading={busy} disabled={!f.name.trim() || f.amount === null} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nombre" className="col-span-2">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Adobe Creative Cloud" autoFocus={!sub} />
        </Field>
        <Field label="Proveedor">
          <Input value={f.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="Adobe" />
        </Field>
        <Field label="Plan">
          <Input value={f.plan} onChange={(e) => set('plan', e.target.value)} placeholder="Todas las apps" />
        </Field>
        <Field label="Importe por cobro (IVA incl.)">
          <MoneyInput value={f.amount} onChange={(v) => set('amount', v)} />
        </Field>
        <Field label="Cada">
          <Select value={f.cycle} onChange={(e) => set('cycle', e.target.value as Subscription['cycle'])}>
            {BILLING_CYCLES.map((c) => (
              <option key={c} value={c}>
                {CYCLE_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Próximo cobro / renovación">
          <Input type="date" value={f.nextRenewalDate} onChange={(e) => set('nextRenewalDate', e.target.value)} />
        </Field>
        <Field label="Caduca o termina la prueba" hint="Opcional">
          <Input type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </Field>
        <Field label="Estado">
          <Select value={f.status} onChange={(e) => set('status', e.target.value as Subscription['status'])}>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Categoría">
          <Select value={f.category} onChange={(e) => set('category', e.target.value as Subscription['category'])}>
            {SUBSCRIPTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Avisarme (días antes)">
          <Input value={f.remindDaysBefore} onChange={(e) => set('remindDaysBefore', e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="IVA %">
          <Input value={f.vatRate} onChange={(e) => set('vatRate', e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Cuenta" className="col-span-2">
          <Input value={f.account} onChange={(e) => set('account', e.target.value)} placeholder="antoniomorales.psd@gmail.com" />
        </Field>
        <Field label="Método de pago">
          <Input value={f.paymentLabel} onChange={(e) => set('paymentLabel', e.target.value)} placeholder="Visa ···4321" />
        </Field>
        <Field label="Dónde gestionarla">
          <div className="flex gap-1">
            <Input value={f.manageUrl} onChange={(e) => set('manageUrl', e.target.value)} placeholder="https://…" />
            {f.manageUrl && (
              <a href={f.manageUrl} target="_blank" rel="noreferrer" className="grid w-9 shrink-0 place-items-center rounded-[6px] border border-line text-ink-2 hover:border-ink" aria-label="Abrir">
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </Field>
        <div className="col-span-2 flex flex-col gap-3">
          <Toggle on={f.autoRenew} onChange={(v) => set('autoRenew', v)} label="Se renueva sola" />
          <Toggle on={f.deductible} onChange={(v) => set('deductible', v)} label="Gasto deducible de la actividad" />
        </div>
        <Field label="Notas" className="col-span-2">
          <Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Cancelar antes del día 15 si no la uso…" />
        </Field>
        {sub?.lastChargeDate && (
          <p className="col-span-2 flex items-center gap-1.5 text-[12px] text-ink-3">
            <CalendarClock size={13} /> Último cobro registrado: {shortDate(sub.lastChargeDate)} · {formatEUR(yearlyEquivalent(sub))}/año
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Eliminar la suscripción?"
        description="Los gastos ya registrados se conservan. Si solo la has dado de baja, mejor cambia su estado a Cancelada."
        confirmLabel="Eliminar"
        danger
        onConfirm={async () => {
          if (sub && (await act('subscription.delete', { id: sub.id }, 'Suscripción eliminada'))) onClose();
        }}
      />
    </Sheet>
  );
}
