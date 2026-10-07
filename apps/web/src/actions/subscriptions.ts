import { z } from 'zod';
import { SubscriptionInput, SubscriptionSchema, UpdateSubscriptionInput, type ExpenseCategory, type Subscription } from '@bos/schemas';
import { advanceRenewal, formatEUR, splitVat } from '@bos/domain';
import { parseDoc } from '@/lib/convert';
import type { TxLike } from '@/data/db';
import { ActionError, baseFields, clean, defineAction, type ActionContext } from './define';

async function loadSub(ctx: ActionContext, tx: TxLike, id: string): Promise<Subscription> {
  const snap = await tx.get(ctx.col('subscriptions').doc(id));
  const s = snap.exists ? parseDoc(SubscriptionSchema, id, snap.data() ?? {}) : null;
  if (!s) throw new ActionError('La suscripción no existe.');
  return s;
}

const CATEGORY_TO_EXPENSE: Record<Subscription['category'], ExpenseCategory> = {
  software: 'software',
  almacenamiento: 'software',
  dominio: 'software',
  hosting: 'software',
  musica: 'otros',
  ia: 'software',
  streaming: 'otros',
  telefono: 'telefono',
  otros: 'otros',
};

export const createSubscription = defineAction({
  name: 'subscription.create',
  description: 'Registra una suscripción o pago recurrente.',
  input: SubscriptionInput,
  critical: false,
  handler: async (ctx, input) => {
    const ref = ctx.col('subscriptions').doc();
    await ctx.db.runTransaction(async (tx) => {
      const doc = SubscriptionSchema.parse({
        ...baseFields(ctx, ref.id),
        createdAt: ctx.now.toISOString(),
        updatedAt: ctx.now.toISOString(),
        ...clean(input),
      });
      tx.set(ref, clean({ ...doc, createdAt: ctx.now, updatedAt: ctx.now }));
      ctx.log(tx, { action: 'subscription.create', entity: { kind: 'subscription', id: ref.id }, summary: `Suscripción: ${input.name} · ${formatEUR(input.amount)}` });
    });
    return { id: ref.id };
  },
});

export const updateSubscription = defineAction({
  name: 'subscription.update',
  description: 'Edita una suscripción (importe, fechas, estado…).',
  input: UpdateSubscriptionInput,
  critical: false,
  handler: async (ctx, { id, patch }) => {
    await ctx.db.runTransaction(async (tx) => {
      const cur = await loadSub(ctx, tx, id);
      tx.update(ctx.col('subscriptions').doc(id), { ...clean(patch), updatedAt: ctx.now });
      if (patch.status && patch.status !== cur.status) {
        ctx.log(tx, { action: 'subscription.status', entity: { kind: 'subscription', id }, summary: `${cur.name}: ${cur.status} → ${patch.status}` });
      }
    });
    return { id };
  },
});

export const registerCharge = defineAction({
  name: 'subscription.charge',
  description: 'Registra el cobro de una suscripción: crea el gasto (pendiente de factura) y avanza la próxima renovación.',
  input: z.object({ id: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), amount: z.number().int().optional() }),
  critical: false,
  handler: async (ctx, { id, date, amount }) => {
    const expRef = ctx.col('expenses').doc();
    await ctx.db.runTransaction(async (tx) => {
      const s = await loadSub(ctx, tx, id);
      const chargeDate = date ?? s.nextRenewalDate ?? ctx.now.toISOString().slice(0, 10);
      const total = amount ?? s.amount;
      const { base, vat } = splitVat(total, s.vatRate);
      tx.set(expRef, {
        ...baseFields(ctx, expRef.id),
        date: chargeDate,
        vendor: s.vendor || s.name,
        vendorTaxId: '',
        concept: `${s.name}${s.plan ? ` · ${s.plan}` : ''}`,
        invoiceNumber: '',
        category: CATEGORY_TO_EXPENSE[s.category],
        base,
        vatRate: s.vatRate,
        vat,
        total,
        deductible: s.deductible,
        status: 'pending',
        subscriptionId: s.id,
        clientId: null,
        fileId: null,
        notes: '',
        archived: false,
      });
      // Keep the billing day; only recover a larger start day when a short month clamped it (31 → 28 Feb → 31 Mar).
      let day: number | undefined;
      if (s.nextRenewalDate) {
        const cur = Number(s.nextRenewalDate.slice(8));
        const [y, m] = s.nextRenewalDate.split('-').map(Number) as [number, number];
        const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const startDay = s.startDate ? Number(s.startDate.slice(8)) : cur;
        day = cur === lastOfMonth && startDay > cur ? startDay : cur;
      }
      tx.update(ctx.col('subscriptions').doc(id), {
        lastChargeDate: chargeDate,
        nextRenewalDate: s.nextRenewalDate ? advanceRenewal(s.nextRenewalDate, s.cycle, day) : null,
        updatedAt: ctx.now,
      });
      ctx.log(tx, { action: 'subscription.charge', entity: { kind: 'subscription', id }, summary: `Cobro de ${s.name} registrado · ${formatEUR(total)}` });
    });
    return { id, expenseId: expRef.id };
  },
});

export const deleteSubscription = defineAction({
  name: 'subscription.delete',
  description: 'Elimina una suscripción (sus gastos ya registrados se conservan).',
  input: z.object({ id: z.string() }),
  critical: true,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const s = await loadSub(ctx, tx, id);
      tx.delete(ctx.col('subscriptions').doc(id));
      ctx.log(tx, { action: 'subscription.delete', entity: { kind: 'subscription', id }, summary: `Suscripción eliminada: ${s.name}`, before: s });
    });
    return { id };
  },
});

export const subscriptionActions = [createSubscription, updateSubscription, registerCharge, deleteSubscription];
