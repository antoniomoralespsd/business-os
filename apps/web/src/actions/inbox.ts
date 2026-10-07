import { z } from 'zod';
import { ConfirmInboxInput, CreateInboxItemInput, EXPENSE_CATEGORIES, InboxItemSchema, type ExpenseCategory } from '@bos/schemas';
import { computeTotals, dueDateFor, formatEUR, splitVat } from '@bos/domain';
import { parseDoc } from '@/lib/convert';
import { loadClient } from './clients';
import { ActionError, baseFields, defineAction } from './define';

export const createInboxItem = defineAction({
  name: 'inbox.create',
  description: 'Añade un archivo subido al Inbox con su clasificación propuesta.',
  input: CreateInboxItemInput,
  critical: false,
  handler: async (ctx, input) => {
    const ref = ctx.col('inbox').doc();
    return ctx.db.runTransaction(async (tx) => {
      const dup = await tx.getQuery(ctx.col('inbox').where('sha256', '==', input.sha256).limit(1));
      const duplicateOf = dup.docs[0]?.id ?? null;
      tx.set(ref, {
        ...baseFields(ctx, ref.id),
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        sha256: input.sha256,
        storagePath: input.storagePath,
        textExcerpt: input.textExcerpt.slice(0, 4000),
        status: 'needs_confirmation',
        proposal: input.proposal,
        result: null,
        duplicateOf,
      });
      ctx.log(tx, { action: 'inbox.create', entity: { kind: 'inbox', id: ref.id }, summary: `Archivo recibido: ${input.filename}${duplicateOf ? ' (posible duplicado)' : ''}` });
      return { id: ref.id, duplicateOf };
    });
  },
});

export const confirmInboxItem = defineAction({
  name: 'inbox.confirm',
  description: 'Confirma la clasificación: crea el gasto o la factura de ingreso y archiva el elemento del Inbox.',
  input: ConfirmInboxInput,
  critical: false,
  handler: async (ctx, input) => {
    return ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('inbox').doc(input.id);
      const snap = await tx.get(ref);
      const item = snap.exists ? parseDoc(InboxItemSchema, input.id, snap.data() ?? {}) : null;
      if (!item) throw new ActionError('El elemento del Inbox no existe.');
      if (item.status !== 'needs_confirmation') throw new ActionError('Este archivo ya está procesado.');

      if (input.kind === 'expense') {
        if (!input.vendor) throw new ActionError('Indica el proveedor del gasto.');
        const subRef = input.subscriptionId ? ctx.col('subscriptions').doc(input.subscriptionId) : null;
        const subSnap = subRef ? await tx.get(subRef) : null;
        const expRef = ctx.col('expenses').doc();
        const { base, vat } = splitVat(input.total, input.vatRate);
        const category = (EXPENSE_CATEGORIES as readonly string[]).includes(input.category) ? (input.category as ExpenseCategory) : 'otros';
        tx.set(expRef, {
          ...baseFields(ctx, expRef.id),
          date: input.date,
          vendor: input.vendor,
          vendorTaxId: input.taxId,
          concept: input.concept || item.filename,
          invoiceNumber: input.invoiceNumber,
          category,
          base,
          vatRate: input.vatRate,
          vat,
          total: input.total,
          deductible: true,
          status: 'confirmed',
          subscriptionId: subSnap?.exists ? input.subscriptionId : null,
          clientId: null,
          fileId: item.id,
          notes: '',
          archived: false,
        });
        tx.update(ref, { status: 'completed', result: { kind: 'expense', id: expRef.id }, updatedAt: ctx.now });
        ctx.log(tx, { action: 'inbox.confirm', entity: { kind: 'inbox', id: item.id }, summary: `Clasificado como gasto: ${input.vendor} · ${formatEUR(input.total)}` });
        return { kind: 'expense' as const, id: expRef.id };
      }

      if (input.kind === 'income') {
        if (!input.clientId) throw new ActionError('Indica a qué cliente corresponde la factura.');
        if (!input.invoiceNumber) throw new ActionError('Indica el número de factura.');
        const client = await loadClient(ctx, tx, input.clientId);
        const invRef = ctx.col('invoices').doc();
        // total = base·(1+iva−irpf) → base
        const subtotal = Math.round(input.total / (1 + input.vatRate / 100 - input.irpfRate / 100));
        const t = computeTotals([{ quantity: 1, unitPrice: subtotal }], input.vatRate, input.irpfRate);
        tx.set(invRef, {
          ...baseFields(ctx, invRef.id),
          series: '',
          number: null,
          invoiceNumber: input.invoiceNumber,
          clientId: client.id,
          client: { name: client.name, legalName: client.legalName, taxId: client.taxId, address: client.address, email: client.billingEmail || client.email },
          issuer: null,
          date: input.date,
          dueDate: dueDateFor(input.date, client.billing.paymentTermsDays),
          lines: [{ jobId: null, date: input.date, concept: input.concept || item.filename, quantity: 1, unitPrice: subtotal }],
          vatRate: input.vatRate,
          irpfRate: input.irpfRate,
          ...t,
          status: 'sent',
          sentAt: ctx.now,
          paidAt: null,
          notes: '',
          external: true,
          fileId: item.id,
          archived: false,
        });
        tx.update(ref, { status: 'completed', result: { kind: 'income', id: invRef.id }, updatedAt: ctx.now });
        ctx.log(tx, { action: 'inbox.confirm', entity: { kind: 'inbox', id: item.id }, summary: `Clasificado como ingreso: ${input.invoiceNumber} · ${client.name}` });
        return { kind: 'income' as const, id: invRef.id };
      }

      tx.update(ref, { status: 'completed', result: { kind: 'none', id: null }, updatedAt: ctx.now });
      ctx.log(tx, { action: 'inbox.confirm', entity: { kind: 'inbox', id: item.id }, summary: `Guardado como documento: ${item.filename}` });
      return { kind: 'other' as const, id: null };
    });
  },
});

export const discardInboxItem = defineAction({
  name: 'inbox.discard',
  description: 'Descarta un archivo del Inbox (no crea nada).',
  input: z.object({ id: z.string() }),
  critical: false,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('inbox').doc(id);
      if (!(await tx.get(ref)).exists) throw new ActionError('No existe.');
      tx.update(ref, { status: 'discarded', updatedAt: ctx.now });
    });
    return { id };
  },
});

export const inboxActions = [createInboxItem, confirmInboxItem, discardInboxItem];
