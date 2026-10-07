import { z } from 'zod';
import {
  DraftInvoiceInput,
  ExpenseInput,
  ExpenseSchema,
  ExternalInvoiceInput,
  InvoiceSchema,
  IssuerSettingsSchema,
  JobInput,
  JobSchema,
  UpdateExpenseInput,
  UpdateInvoiceInput,
  UpdateJobInput,
  type Invoice,
  type InvoiceLine,
  type IssuerSettings,
  type Job,
  type PartySnapshot,
} from '@bos/schemas';
import { computeTotals, dueDateFor, formatEUR, formatInvoiceNumber, splitVat } from '@bos/domain';
import { parseDoc } from '@/lib/convert';
import type { DocRefLike, TxLike } from '@/data/db';
import { loadClient } from './clients';
import { ActionError, baseFields, clean, defineAction, type ActionContext } from './define';

const IdInput = z.object({ id: z.string() });

/* ---------- loaders ---------- */

async function loadJob(ctx: ActionContext, tx: TxLike, id: string): Promise<{ ref: DocRefLike; job: Job }> {
  const ref = ctx.col('jobs').doc(id);
  const snap = await tx.get(ref);
  const job = snap.exists ? parseDoc(JobSchema, snap.id, snap.data() ?? {}) : null;
  if (!job) throw new ActionError('El trabajo no existe.');
  return { ref, job };
}

async function loadInvoice(ctx: ActionContext, tx: TxLike, id: string): Promise<{ ref: DocRefLike; inv: Invoice }> {
  const ref = ctx.col('invoices').doc(id);
  const snap = await tx.get(ref);
  const inv = snap.exists ? parseDoc(InvoiceSchema, snap.id, snap.data() ?? {}) : null;
  if (!inv) throw new ActionError('La factura no existe.');
  return { ref, inv };
}

export async function loadIssuer(ctx: ActionContext, tx: TxLike): Promise<IssuerSettings> {
  const snap = await tx.get(ctx.col('settings').doc('issuer'));
  return IssuerSettingsSchema.parse(snap.exists ? (snap.data() ?? {}) : {});
}

const amount = (j: Pick<Job, 'quantity' | 'unitPrice'>) => Math.round(j.quantity * j.unitPrice);

/* ===================== Jobs ===================== */

export const createJob = defineAction({
  name: 'job.create',
  description: 'Registra un trabajo realizado (facturable) para un cliente.',
  input: JobInput,
  critical: false,
  handler: async (ctx, input) => {
    const ref = ctx.col('jobs').doc();
    await ctx.db.runTransaction(async (tx) => {
      const client = await loadClient(ctx, tx, input.clientId);
      const taskRef = input.taskId ? ctx.col('tasks').doc(input.taskId) : null;
      const taskSnap = taskRef ? await tx.get(taskRef) : null;
      tx.set(ref, {
        ...baseFields(ctx, ref.id),
        clientId: input.clientId,
        date: input.date,
        concept: input.concept,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        invoiceId: null,
        taskId: input.taskId ?? null,
        archived: false,
      });
      if (taskRef && taskSnap?.exists) tx.update(taskRef, { jobId: ref.id, updatedAt: ctx.now });
      ctx.log(tx, { action: 'job.create', entity: { kind: 'job', id: ref.id }, summary: `Trabajo para ${client.name}: ${input.concept} · ${formatEUR(amount(input))}` });
    });
    return { id: ref.id };
  },
});

export const updateJob = defineAction({
  name: 'job.update',
  description: 'Edita un trabajo que todavía no está facturado.',
  input: UpdateJobInput,
  critical: false,
  handler: async (ctx, { id, patch }) => {
    await ctx.db.runTransaction(async (tx) => {
      const { ref, job } = await loadJob(ctx, tx, id);
      if (job.invoiceId) throw new ActionError('Este trabajo ya está en una factura. Edítalo desde la factura.');
      tx.update(ref, { ...clean(patch), updatedAt: ctx.now });
    });
    return { id };
  },
});

export const deleteJob = defineAction({
  name: 'job.delete',
  description: 'Elimina un trabajo que no está facturado.',
  input: IdInput,
  critical: true,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const { ref, job } = await loadJob(ctx, tx, id);
      if (job.invoiceId) throw new ActionError('No se puede borrar un trabajo facturado.');
      const taskRef = job.taskId ? ctx.col('tasks').doc(job.taskId) : null;
      const taskSnap = taskRef ? await tx.get(taskRef) : null;
      tx.delete(ref);
      if (taskRef && taskSnap?.exists) tx.update(taskRef, { jobId: null, updatedAt: ctx.now });
      ctx.log(tx, { action: 'job.delete', entity: { kind: 'job', id }, summary: `Trabajo eliminado: ${job.concept}`, before: job });
    });
    return { id };
  },
});

/* ===================== Invoices ===================== */

const snapshot = (c: { name: string; legalName: string; taxId: string; address: string; email: string; billingEmail?: string }): PartySnapshot => ({
  name: c.name,
  legalName: c.legalName,
  taxId: c.taxId,
  address: c.address,
  email: c.billingEmail || c.email,
});

export const createDraftInvoice = defineAction({
  name: 'invoice.draft',
  description: 'Prepara un borrador de factura a partir de trabajos pendientes y/o líneas manuales.',
  input: DraftInvoiceInput,
  critical: false,
  handler: async (ctx, input) => {
    const ref = ctx.col('invoices').doc();
    await ctx.db.runTransaction(async (tx) => {
      const client = await loadClient(ctx, tx, input.clientId);
      const issuer = await loadIssuer(ctx, tx);
      const jobs: { ref: DocRefLike; job: Job }[] = [];
      for (const id of input.jobIds) jobs.push(await loadJob(ctx, tx, id));
      for (const { job } of jobs) {
        if (job.clientId !== input.clientId) throw new ActionError('Hay trabajos de otro cliente en la selección.');
        if (job.invoiceId) throw new ActionError(`«${job.concept}» ya está en otra factura.`);
      }
      const lines: InvoiceLine[] = [
        ...jobs
          .map(({ job }) => job)
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((j) => ({ jobId: j.id, date: j.date, concept: j.concept, quantity: j.quantity, unitPrice: j.unitPrice })),
        ...input.lines,
      ];
      if (lines.length === 0) throw new ActionError('La factura necesita al menos una línea.');
      const vatRate = client.billing.vatRate ?? issuer.defaultVat;
      const irpfRate = client.billing.irpfRate ?? issuer.defaultIrpf;
      const t = computeTotals(lines, vatRate, irpfRate);
      tx.set(ref, {
        ...baseFields(ctx, ref.id),
        series: issuer.series,
        number: null,
        invoiceNumber: null,
        clientId: client.id,
        client: snapshot(client),
        issuer: null,
        date: input.date,
        dueDate: dueDateFor(input.date, client.billing.paymentTermsDays),
        lines,
        vatRate,
        irpfRate,
        ...t,
        status: 'draft',
        sentAt: null,
        paidAt: null,
        notes: input.notes ?? issuer.paymentNote,
        external: false,
        fileId: null,
        archived: false,
      });
      for (const { ref: jr } of jobs) tx.update(jr, { invoiceId: ref.id, updatedAt: ctx.now });
      ctx.log(tx, { action: 'invoice.draft', entity: { kind: 'invoice', id: ref.id }, summary: `Borrador de factura para ${client.name} · ${formatEUR(t.total)}` });
    });
    return { id: ref.id };
  },
});

export const updateInvoice = defineAction({
  name: 'invoice.update',
  description: 'Edita un borrador de factura (líneas, IVA, IRPF, fechas, notas).',
  input: UpdateInvoiceInput,
  critical: false,
  handler: async (ctx, { id, patch }) => {
    await ctx.db.runTransaction(async (tx) => {
      const { ref, inv } = await loadInvoice(ctx, tx, id);
      if (inv.status !== 'draft') throw new ActionError('Solo se pueden editar borradores. Una factura emitida se anula y se hace otra.');
      const lines = patch.lines ?? inv.lines;
      const removed = inv.lines.filter((l) => l.jobId && !lines.some((n) => n.jobId === l.jobId)).map((l) => l.jobId!);
      const removedRefs = removed.map((jid) => ctx.col('jobs').doc(jid));
      const removedSnaps = await Promise.all(removedRefs.map((r) => tx.get(r)));
      const vatRate = patch.vatRate ?? inv.vatRate;
      const irpfRate = patch.irpfRate ?? inv.irpfRate;
      tx.update(ref, { ...clean(patch), lines, vatRate, irpfRate, ...computeTotals(lines, vatRate, irpfRate), updatedAt: ctx.now });
      removedRefs.forEach((r, i) => removedSnaps[i]!.exists && tx.update(r, { invoiceId: null, updatedAt: ctx.now }));
    });
    return { id };
  },
});

export const issueInvoice = defineAction({
  name: 'invoice.issue',
  description: 'Emite la factura: le asigna el siguiente número (sin huecos ni duplicados) y congela sus datos.',
  input: IdInput,
  critical: true,
  handler: async (ctx, { id }) => {
    return ctx.db.runTransaction(async (tx) => {
      const { ref, inv } = await loadInvoice(ctx, tx, id);
      if (inv.status !== 'draft') throw new ActionError('Esta factura ya está emitida.');
      const issuer = await loadIssuer(ctx, tx);
      if (!issuer.taxId || !(issuer.legalName || issuer.name)) {
        throw new ActionError('Faltan tus datos fiscales (nombre y NIF). Complétalos en Ajustes → Datos fiscales.');
      }
      const year = Number(inv.date.slice(0, 4));
      const counterRef = ctx.col('counters').doc(`invoice-${issuer.series || 'default'}-${year}`);
      const counter = await tx.get(counterRef);
      const fromCounter = counter.exists ? Number((counter.data() ?? {}).next ?? 1) : 1;
      const fromSettings = issuer.nextNumber[String(year)] ?? 1;
      const n = Math.max(fromCounter, fromSettings);
      const invoiceNumber = formatInvoiceNumber(issuer.series, year, n);
      tx.set(counterRef, { next: n + 1, year, series: issuer.series, updatedAt: ctx.now });
      tx.update(ref, {
        number: n,
        invoiceNumber,
        status: 'issued',
        issuer: { name: issuer.name, legalName: issuer.legalName, taxId: issuer.taxId, address: issuer.address, email: issuer.email },
        updatedAt: ctx.now,
      });
      ctx.log(tx, { action: 'invoice.issue', entity: { kind: 'invoice', id }, summary: `Factura ${invoiceNumber} emitida · ${inv.client.name} · ${formatEUR(inv.total)}` });
      return { id, invoiceNumber };
    });
  },
});

const setStatus = (name: string, description: string, from: Invoice['status'][], to: Invoice['status'], extra: (ctx: ActionContext, input: { id: string; date?: string }) => Record<string, unknown>, summary: (inv: Invoice) => string) =>
  defineAction({
    name,
    description,
    input: z.object({ id: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    critical: false,
    handler: async (ctx, input) => {
      await ctx.db.runTransaction(async (tx) => {
        const { ref, inv } = await loadInvoice(ctx, tx, input.id);
        if (!from.includes(inv.status)) throw new ActionError('Esta acción no aplica al estado actual de la factura.');
        tx.update(ref, { status: to, ...extra(ctx, input), updatedAt: ctx.now });
        ctx.log(tx, { action: name, entity: { kind: 'invoice', id: inv.id }, summary: summary(inv) });
      });
      return { id: input.id };
    },
  });

export const markInvoiceSent = setStatus('invoice.sent', 'Marca la factura como enviada al cliente.', ['issued'], 'sent', (ctx) => ({ sentAt: ctx.now }), (i) => `Factura ${i.invoiceNumber} enviada`);
export const markInvoicePaid = setStatus('invoice.paid', 'Marca la factura como cobrada.', ['issued', 'sent'], 'paid', (ctx, i) => ({ paidAt: i.date ?? ctx.now.toISOString().slice(0, 10) }), (i) => `Factura ${i.invoiceNumber} cobrada`);
export const markInvoiceUnpaid = setStatus('invoice.unpaid', 'Vuelve a marcar la factura como pendiente de cobro.', ['paid'], 'sent', () => ({ paidAt: null }), (i) => `Factura ${i.invoiceNumber} vuelve a pendiente de cobro`);

export const cancelInvoice = defineAction({
  name: 'invoice.cancel',
  description: 'Anula una factura. Un borrador se elimina; una emitida queda anulada (conserva su número) y sus trabajos vuelven a pendientes.',
  input: IdInput,
  critical: true,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const { ref, inv } = await loadInvoice(ctx, tx, id);
      if (inv.status === 'cancelled') return;
      const jobRefs = inv.lines.filter((l) => l.jobId).map((l) => ctx.col('jobs').doc(l.jobId!));
      const jobSnaps = await Promise.all(jobRefs.map((r) => tx.get(r)));
      if (inv.status === 'draft') tx.delete(ref);
      else tx.update(ref, { status: 'cancelled', updatedAt: ctx.now });
      jobRefs.forEach((r, i) => jobSnaps[i]!.exists && tx.update(r, { invoiceId: null, updatedAt: ctx.now }));
      ctx.log(tx, {
        action: 'invoice.cancel',
        entity: { kind: 'invoice', id },
        summary: inv.status === 'draft' ? `Borrador de ${inv.client.name} descartado` : `Factura ${inv.invoiceNumber} anulada`,
      });
    });
    return { id };
  },
});

export const createExternalInvoice = defineAction({
  name: 'invoice.external',
  description: 'Registra una factura emitida fuera de la app (por ejemplo, subida desde el Inbox).',
  input: ExternalInvoiceInput,
  critical: false,
  handler: async (ctx, input) => {
    const ref = ctx.col('invoices').doc();
    await ctx.db.runTransaction(async (tx) => {
      const client = await loadClient(ctx, tx, input.clientId);
      const t = computeTotals([{ quantity: 1, unitPrice: input.subtotal }], input.vatRate, input.irpfRate);
      tx.set(ref, {
        ...baseFields(ctx, ref.id),
        series: '',
        number: null,
        invoiceNumber: input.invoiceNumber,
        clientId: client.id,
        client: snapshot(client),
        issuer: null,
        date: input.date,
        dueDate: dueDateFor(input.date, client.billing.paymentTermsDays),
        lines: [{ jobId: null, date: input.date, concept: input.concept, quantity: 1, unitPrice: input.subtotal }],
        vatRate: input.vatRate,
        irpfRate: input.irpfRate,
        ...t,
        status: input.paid ? 'paid' : 'sent',
        sentAt: ctx.now,
        paidAt: input.paid ? input.date : null,
        notes: '',
        external: true,
        fileId: input.fileId,
        archived: false,
      });
      ctx.log(tx, { action: 'invoice.external', entity: { kind: 'invoice', id: ref.id }, summary: `Factura ${input.invoiceNumber} registrada · ${client.name}` });
    });
    return { id: ref.id };
  },
});

const archiveToggle = (name: string, col: string, archived: boolean, label: string) =>
  defineAction({
    name,
    description: `${archived ? 'Archiva' : 'Recupera'} ${label}.`,
    input: IdInput,
    critical: false,
    handler: async (ctx, { id }) => {
      await ctx.db.runTransaction(async (tx) => {
        const ref = ctx.col(col).doc(id);
        if (!(await tx.get(ref)).exists) throw new ActionError('No existe.');
        tx.update(ref, { archived, updatedAt: ctx.now });
        ctx.log(tx, { action: name, entity: { kind: col, id }, summary: `${label[0]!.toUpperCase()}${label.slice(1)} ${archived ? 'archivado' : 'recuperado'}` });
      });
      return { id };
    },
  });

/* ===================== Expenses ===================== */

function expenseAmounts(total: number, vatRate: number) {
  const { base, vat } = splitVat(total, vatRate);
  return { total, vatRate, base, vat };
}

export const createExpense = defineAction({
  name: 'expense.create',
  description: 'Registra un gasto.',
  input: ExpenseInput,
  critical: false,
  handler: async (ctx, input) => {
    const ref = ctx.col('expenses').doc();
    await ctx.db.runTransaction(async (tx) => {
      const doc = ExpenseSchema.parse({
        ...baseFields(ctx, ref.id),
        createdAt: ctx.now.toISOString(),
        updatedAt: ctx.now.toISOString(),
        vendorTaxId: '',
        concept: '',
        invoiceNumber: '',
        notes: '',
        ...clean(input),
        ...expenseAmounts(input.total, input.vatRate),
        status: input.status ?? (input.fileId ? 'confirmed' : 'pending'),
        subscriptionId: input.subscriptionId ?? null,
        clientId: input.clientId ?? null,
        fileId: input.fileId ?? null,
        archived: false,
      });
      tx.set(ref, { ...doc, createdAt: ctx.now, updatedAt: ctx.now });
      ctx.log(tx, { action: 'expense.create', entity: { kind: 'expense', id: ref.id }, summary: `Gasto: ${input.vendor} · ${formatEUR(input.total)}` });
    });
    return { id: ref.id };
  },
});

export const updateExpense = defineAction({
  name: 'expense.update',
  description: 'Edita un gasto.',
  input: UpdateExpenseInput,
  critical: false,
  handler: async (ctx, { id, patch }) => {
    await ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('expenses').doc(id);
      const snap = await tx.get(ref);
      const cur = snap.exists ? parseDoc(ExpenseSchema, id, snap.data() ?? {}) : null;
      if (!cur) throw new ActionError('El gasto no existe.');
      const total = patch.total ?? cur.total;
      const vatRate = patch.vatRate ?? cur.vatRate;
      tx.update(ref, { ...clean(patch), ...expenseAmounts(total, vatRate), updatedAt: ctx.now });
    });
    return { id };
  },
});

export const deleteExpense = defineAction({
  name: 'expense.delete',
  description: 'Elimina un gasto registrado por error.',
  input: IdInput,
  critical: true,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('expenses').doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ActionError('El gasto no existe.');
      tx.delete(ref);
      ctx.log(tx, { action: 'expense.delete', entity: { kind: 'expense', id }, summary: `Gasto eliminado: ${String((snap.data() ?? {}).vendor ?? '')}`, before: snap.data() });
    });
    return { id };
  },
});

export const billingActions = [
  createJob,
  updateJob,
  deleteJob,
  archiveToggle('job.archive', 'jobs', true, 'trabajo'),
  archiveToggle('job.unarchive', 'jobs', false, 'trabajo'),
  createDraftInvoice,
  updateInvoice,
  issueInvoice,
  markInvoiceSent,
  markInvoicePaid,
  markInvoiceUnpaid,
  cancelInvoice,
  createExternalInvoice,
  archiveToggle('invoice.archive', 'invoices', true, 'factura'),
  archiveToggle('invoice.unarchive', 'invoices', false, 'factura'),
  createExpense,
  updateExpense,
  deleteExpense,
  archiveToggle('expense.archive', 'expenses', true, 'gasto'),
  archiveToggle('expense.unarchive', 'expenses', false, 'gasto'),
];
