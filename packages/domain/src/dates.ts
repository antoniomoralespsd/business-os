import type { ISODate } from '@bos/schemas';

export const BUSINESS_TZ = 'Europe/Madrid';

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse 'YYYY-MM-DD' into a UTC-midnight Date (pure calendar arithmetic, no TZ drift). */
export function parseISODate(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
}

export function toISODate(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = parseISODate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISODate(dt);
}

/** Today's business date in Europe/Madrid. */
export function todayISO(now: Date = new Date(), tz: string = BUSINESS_TZ): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts as ISODate; // en-CA formats as YYYY-MM-DD
}

/** Monday of the week containing `d`. */
export function startOfWeek(d: ISODate): ISODate {
  const dt = parseISODate(d);
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(d, -dow);
}

/** The 7 ISO dates Monday → Sunday of the week containing `d`. */
export function weekDays(d: ISODate): ISODate[] {
  const start = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const WEEKDAY_SHORT = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'] as const;
export const WEEKDAY_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;
export const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

export function weekdayIndex(d: ISODate): number {
  return (parseISODate(d).getUTCDay() + 6) % 7;
}

export function dayOfMonth(d: ISODate): number {
  return parseISODate(d).getUTCDate();
}

/** "12 — 18 octubre 2026" or "28 septiembre — 4 octubre 2026" or across years. */
export function formatWeekRange(days: readonly ISODate[]): string {
  const first = parseISODate(days[0]!);
  const last = parseISODate(days[days.length - 1]!);
  const m1 = MONTHS[first.getUTCMonth()]!;
  const m2 = MONTHS[last.getUTCMonth()]!;
  const y1 = first.getUTCFullYear();
  const y2 = last.getUTCFullYear();
  if (y1 !== y2) return `${first.getUTCDate()} ${m1} ${y1} — ${last.getUTCDate()} ${m2} ${y2}`;
  if (m1 !== m2) return `${first.getUTCDate()} ${m1} — ${last.getUTCDate()} ${m2} ${y2}`;
  return `${first.getUTCDate()} — ${last.getUTCDate()} ${m2} ${y2}`;
}

/** "Lunes 12 octubre" */
export function formatLongDay(d: ISODate): string {
  const dt = parseISODate(d);
  return `${WEEKDAY_LONG[weekdayIndex(d)]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/** Whole days between two business dates (b - a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** Same day-of-month n months away (clamped): 2026-01-31 +1 → 2026-02-28. */
export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** Whole weeks (Mon–Sun) covering the month of `d`: 5 or 6 rows of 7 days. */
export function monthGridDays(d: ISODate): ISODate[] {
  const first = `${d.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const out: ISODate[] = [];
  for (let day = startOfWeek(first); day <= last || out.length % 7 !== 0; day = addDays(day, 1)) out.push(day);
  return out;
}

/** "Octubre 2026". */
export function formatMonth(d: ISODate): string {
  const name = MONTHS[Number(d.slice(5, 7)) - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${d.slice(0, 4)}`;
}
