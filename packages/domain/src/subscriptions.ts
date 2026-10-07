import type { BillingCycle, ISODate, Subscription } from '@bos/schemas';
import { daysBetween, parseISODate, toISODate } from './dates';
import type { Alert } from './billing';

export const CYCLE_LABEL: Record<BillingCycle, string> = {
  weekly: 'Semanal',
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  yearly: 'Anual',
};

const MONTHS_PER: Record<BillingCycle, number> = { weekly: 12 / 52, monthly: 1, quarterly: 3, yearly: 12 };

export function monthlyEquivalent(s: Pick<Subscription, 'amount' | 'cycle'>): number {
  return Math.round(s.amount / MONTHS_PER[s.cycle]);
}

export function yearlyEquivalent(s: Pick<Subscription, 'amount' | 'cycle'>): number {
  return Math.round((s.amount * 12) / MONTHS_PER[s.cycle]);
}

export const isActiveSubscription = (s: Pick<Subscription, 'status'>) => s.status === 'active' || s.status === 'trial';

/** Next renewal after `d`. Month-based cycles keep the day of month, clamped (31 Jan → 28/29 Feb). */
export function advanceRenewal(d: ISODate, cycle: BillingCycle, originalDay?: number): ISODate {
  const dt = parseISODate(d);
  if (cycle === 'weekly') {
    dt.setUTCDate(dt.getUTCDate() + 7);
    return toISODate(dt);
  }
  const add = cycle === 'monthly' ? 1 : cycle === 'quarterly' ? 3 : 12;
  const day = originalDay ?? dt.getUTCDate();
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + add;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toISODate(new Date(Date.UTC(y, m, Math.min(day, last))));
}

export interface SubscriptionTotals {
  active: number;
  monthly: number;
  yearly: number;
  deductibleYearly: number;
}

export function subscriptionTotals(subs: readonly Subscription[]): SubscriptionTotals {
  const act = subs.filter(isActiveSubscription);
  return {
    active: act.length,
    monthly: act.reduce((s, x) => s + monthlyEquivalent(x), 0),
    yearly: act.reduce((s, x) => s + yearlyEquivalent(x), 0),
    deductibleYearly: act.filter((x) => x.deductible).reduce((s, x) => s + yearlyEquivalent(x), 0),
  };
}

export type RenewalWindow = 'overdue' | 'week' | 'month' | 'later' | 'none';

export function renewalWindow(s: Pick<Subscription, 'nextRenewalDate' | 'status'>, today: ISODate): RenewalWindow {
  if (!s.nextRenewalDate || !isActiveSubscription(s)) return 'none';
  const d = daysBetween(today, s.nextRenewalDate);
  if (d < 0) return 'overdue';
  if (d <= 7) return 'week';
  if (d <= 31) return 'month';
  return 'later';
}

const fmtDays = (d: number) => (d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`);

export function subscriptionAlerts(subs: readonly Subscription[], today: ISODate, formatMoney: (c: number) => string): Alert[] {
  const out: Alert[] = [];
  for (const s of subs) {
    if (!isActiveSubscription(s)) continue;
    if (s.status === 'trial' && s.endDate) {
      const d = daysBetween(today, s.endDate);
      if (d >= 0 && d <= Math.max(3, s.remindDaysBefore)) {
        out.push({ id: `trial-${s.id}`, severity: 'warning', title: `La prueba de ${s.name} termina ${fmtDays(d)}`, detail: 'Decide si la mantienes o la cancelas', href: `/subscriptions?s=${s.id}` });
      }
    }
    if (s.endDate && s.status !== 'trial') {
      const d = daysBetween(today, s.endDate);
      if (d >= 0 && d <= 30) out.push({ id: `expires-${s.id}`, severity: d <= 7 ? 'critical' : 'warning', title: `${s.name} caduca ${fmtDays(d)}`, href: `/subscriptions?s=${s.id}` });
    }
    if (s.nextRenewalDate) {
      const d = daysBetween(today, s.nextRenewalDate);
      if (d < 0) {
        out.push({ id: `charge-${s.id}`, severity: 'info', title: `Cobro de ${s.name} sin registrar`, detail: `Tocaba el ${s.nextRenewalDate.split('-').reverse().join('/')} · ${formatMoney(s.amount)}`, href: `/subscriptions?s=${s.id}` });
      } else if (d <= s.remindDaysBefore) {
        out.push({ id: `renew-${s.id}`, severity: 'info', title: `${s.name} se renueva ${fmtDays(d)}`, detail: formatMoney(s.amount), href: `/subscriptions?s=${s.id}` });
      }
    }
  }
  return out;
}
