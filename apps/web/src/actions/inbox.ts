import { z } from 'zod';
import { AttachDriveInput, ClientSchema, ConfirmInboxInput, CreateInboxItemInput, DEFAULT_CLIENT_MODULES, EXPENSE_CATEGORIES, InboxItemSchema, UpdateProposalsInput, type Client, type ExpenseCategory } from '@bos/schemas';
import { computeTotals, dueDateFor, formatEUR, normalizeTaxId, splitVat } from '@bos/domain';
import { slugify } from '@/lib/ids';
import { parseDoc } from '@/lib/convert';
import { loadClient } from './clients';
import { ActionError, baseFields, clean, defineAction } from './define';

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
        sourcePath: input.sourcePath,
        drive: null,
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
      const sign = input.rectificativa ? -1 : 1;
      const amount = Math.abs(input.total) * sign;
      const tag = input.rectificativa ? ' (rectificativa)' : '';
      const filed = (kind: 'expense' | 'income' | 'other') => ({ date: input.date, kind, rectificativa: input.rectificativa, name: input.concept || item.filename });

      if (input.kind === 'expense') {
        if (!input.vendor) throw new ActionError('Indica el proveedor del gasto.');
        const subRef = input.subscriptionId ? ctx.col('subscriptions').doc(input.subscriptionId) : null;
        const subSnap = subRef ? await tx.get(subRef) : null;
        const expRef = ctx.col('expenses').doc();
        const split = splitVat(Math.abs(input.total), input.vatRate);
        const base = split.base * sign;
        const vat = split.vat * sign;
        const category = (EXPENSE_CATEGORIES as readonly string[]).includes(input.category) ? (input.category as ExpenseCategory) : 'otros';
        tx.set(expRef, {
          ...baseFields(ctx, expRef.id),
          date: input.date,
          vendor: input.vendor,
          vendorTaxId: input.taxId,
          concept: input.invoiceNumber ? `Factura ${input.invoiceNumber}` : 'Ticket / recibo',
          invoiceNumber: input.invoiceNumber,
          category,
          base,
          vatRate: input.vatRate,
          vat,
          total: amount,
          deductible: true,
          status: 'confirmed',
          subscriptionId: subSnap?.exists ? input.subscriptionId : null,
          clientId: null,
          fileId: item.id,
          notes: '',
          archived: false,
        });
        tx.update(ref, { status: 'completed', result: { kind: 'expense', id: expRef.id }, filedAs: filed('expense'), updatedAt: ctx.now });
        ctx.log(tx, { action: 'inbox.confirm', entity: { kind: 'inbox', id: item.id }, summary: `Clasificado como gasto${tag}: ${input.vendor} · ${formatEUR(amount)}` });
        return { kind: 'expense' as const, id: expRef.id };
      }

      if (input.kind === 'income') {
        if (!input.clientId && !input.newClient) throw new ActionError('Indica a qué cliente corresponde la factura.');
        if (!input.invoiceNumber) throw new ActionError('Indica el número de factura.');
        const tax = input.taxId ? normalizeTaxId(input.taxId) : '';
        // Reads first (transactions can't read after writing).
        let client: Client;
        let createClient: Client | null = null;
        let learn: Record<string, string> | null = null;
        if (input.clientId) {
          client = await loadClient(ctx, tx, input.clientId);
          // Learn the client's NIF / legal name from the invoice, so the next ones match on their own.
          if (tax && !client.taxId) learn = { taxId: tax, ...(input.newClient === null && input.vendor && !client.legalName ? { legalName: input.vendor } : {}) };
        } else {
          const nc = input.newClient!;
          const ncTax = normalizeTaxId(nc.taxId || tax);
          const all = await tx.getQuery(ctx.col('clients'));
          const existing = all.docs.map((d) => parseDoc(ClientSchema, d.id, d.data() ?? {})).find((c) => c && ncTax && normalizeTaxId(c.taxId) === ncTax);
          if (existing) client = existing;
          else {
            const ids = new Set(all.docs.map((d) => d.id));
            const wanted = slugify(nc.name) || 'cliente';
            let id = wanted;
            for (let n = 2; ids.has(id); n++) id = `${wanted}-${n}`;
            createClient = ClientSchema.parse({
              ...baseFields(ctx, id),
              createdAt: ctx.now.toISOString(),
              updatedAt: ctx.now.toISOString(),
              name: nc.name,
              shortName: nc.name.toUpperCase().slice(0, 24),
              legalName: nc.name,
              taxId: ncTax,
              modules: [...DEFAULT_CLIENT_MODULES],
            });
            client = createClient;
          }
        }
        if (createClient) {
          tx.set(ctx.col('clients').doc(createClient.id), clean({ ...createClient, createdAt: ctx.now, updatedAt: ctx.now }));
          ctx.log(tx, { action: 'client.create', entity: { kind: 'client', id: createClient.id }, summary: `Cliente creado desde una factura: ${createClient.name}` });
        }
        if (learn) tx.update(ctx.col('clients').doc(client.id), { ...learn, updatedAt: ctx.now });
        const invRef = ctx.col('invoices').doc();
        // total = base·(1+iva−irpf) → base
        const subtotal = sign * Math.round(Math.abs(input.total) / (1 + input.vatRate / 100 - input.irpfRate / 100));
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
          lines: [{ jobId: null, date: input.date, concept: input.rectificativa ? `Rectificativa ${input.invoiceNumber}` : `Factura ${input.invoiceNumber} (importada)`, quantity: 1, unitPrice: subtotal }],
          vatRate: input.vatRate,
          irpfRate: input.irpfRate,
          ...t,
          status: input.paid ? 'paid' : 'sent',
          sentAt: ctx.now,
          paidAt: input.paid ? input.date : null,
          notes: '',
          external: true,
          fileId: item.id,
          archived: false,
        });
        tx.update(ref, { status: 'completed', result: { kind: 'income', id: invRef.id }, filedAs: filed('income'), updatedAt: ctx.now });
        ctx.log(tx, { action: 'inbox.confirm', entity: { kind: 'inbox', id: item.id }, summary: `Clasificado como ingreso${tag}: ${input.invoiceNumber} · ${client.name}` });
        return { kind: 'income' as const, id: invRef.id, clientId: client.id, clientName: client.name, learned: !!learn || !!createClient };
      }

      tx.update(ref, { status: 'completed', result: { kind: 'none', id: null }, filedAs: filed('other'), updatedAt: ctx.now });
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

export const attachDrive = defineAction({
  name: 'inbox.attachDrive',
  description: 'Anota dónde está guardado el archivo en Google Drive.',
  input: AttachDriveInput,
  critical: false,
  handler: async (ctx, { id, drive }) => {
    await ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('inbox').doc(id);
      if (!(await tx.get(ref)).exists) throw new ActionError('No existe.');
      tx.update(ref, { drive, updatedAt: ctx.now });
    });
    return { id };
  },
});

export const updateProposals = defineAction({
  name: 'inbox.updateProposals',
  description: 'Vuelve a clasificar archivos pendientes (por ejemplo, tras aprender el NIF de un cliente).',
  input: UpdateProposalsInput,
  critical: false,
  handler: async (ctx, { items }) => {
    let n = 0;
    await ctx.db.runTransaction(async (tx) => {
      const snaps = await Promise.all(items.map((i) => tx.get(ctx.col('inbox').doc(i.id))));
      items.forEach((i, k) => {
        const d = snaps[k]!;
        if (!d.exists || (d.data() ?? {}).status !== 'needs_confirmation') return;
        tx.update(ctx.col('inbox').doc(i.id), { proposal: i.proposal, ...(i.textExcerpt !== undefined ? { textExcerpt: i.textExcerpt } : {}), updatedAt: ctx.now });
        n++;
      });
    });
    return { updated: n };
  },
});

export const inboxActions = [createInboxItem, confirmInboxItem, discardInboxItem, attachDrive, updateProposals];
