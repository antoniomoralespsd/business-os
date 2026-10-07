import { describe, expect, it } from 'vitest';
import { ExpenseSchema, InvoiceSchema, JobSchema, SubscriptionSchema, TaskSchema } from '@bos/schemas';
import { classifyDocument } from '@bos/domain';
import { parseDoc } from '@/lib/convert';
import { MemoryDb } from '@/data/memoryDb';
import { ACTIONS } from './index';
import { makeContext, runAction } from './define';

const WS = 'main';
function setup() {
  const db = new MemoryDb();
  const call = <T = Record<string, unknown>>(name: string, input: unknown) => runAction(ACTIONS, makeContext(db, WS, { type: 'user', id: 'u1' }), name, input) as Promise<T>;
  const all = async (col: string): Promise<Record<string, unknown>[]> => (await db.collection(`workspaces/${WS}/${col}`).get()).docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  const one = async (col: string, id: string) => (await db.doc(`workspaces/${WS}/${col}/${id}`).get()).data() as Record<string, unknown>;
  return { db, call, all, one };
}

describe('actions on MemoryDb', () => {
  it('rejects invalid input and unknown actions with readable errors', async () => {
    const { call } = setup();
    await expect(call('nope', {})).rejects.toThrow('Acción desconocida');
    await expect(call('client.create', { name: '' })).rejects.toThrow('Datos no válidos');
  });

  it('runs the full billing flow: client → jobs → draft → issue → sent → paid', async () => {
    const { call, all, one } = setup();
    const { id: clientId } = await call<{ id: string }>('client.create', { name: 'Bellaka', billing: { defaultRate: 3000, vatRate: 21, irpfRate: 15, paymentTermsDays: 15 } });
    expect(clientId).toBe('bellaka');
    // second client with same name gets a free id
    expect((await call<{ id: string }>('client.create', { name: 'Bellaka' })).id).toBe('bellaka-2');

    const jobIds: string[] = [];
    for (const d of ['02', '09', '16', '23']) jobIds.push((await call<{ id: string }>('job.create', { clientId, date: `2026-09-${d}`, concept: 'Flyer', unitPrice: 3000 })).id);

    await expect(call('invoice.issue', { id: 'x' })).rejects.toThrow('no existe');
    const { id: invId } = await call<{ id: string }>('invoice.draft', { clientId, date: '2026-09-30', jobIds });
    let inv = parseDoc(InvoiceSchema, invId, await one('invoices', invId))!;
    expect(inv).toMatchObject({ status: 'draft', subtotal: 12000, tax: 2520, withholding: 1800, total: 12720, dueDate: '2026-10-15', number: null });
    expect(inv.lines.map((l) => l.date)).toEqual(['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23']);
    // jobs are reserved
    expect((await all('jobs')).every((j) => j.invoiceId === invId)).toBe(true);
    await expect(call('invoice.draft', { clientId, date: '2026-09-30', jobIds: [jobIds[0]] })).rejects.toThrow('ya está en otra factura');

    // removing a line frees its job
    await call('invoice.update', { id: invId, patch: { lines: inv.lines.slice(0, 3) } });
    inv = parseDoc(InvoiceSchema, invId, await one('invoices', invId))!;
    expect(inv.subtotal).toBe(9000);
    expect((await one('jobs', jobIds[3]!)).invoiceId).toBeNull();

    // issuing needs fiscal data
    await expect(call('invoice.issue', { id: invId })).rejects.toThrow('Faltan tus datos fiscales');
    await call('settings.issuer', { name: 'Iris Design', legalName: 'Antonio Morales', taxId: '12345678Z', nextNumber: { '2026': 84 } });
    const issued = await call<{ invoiceNumber: string }>('invoice.issue', { id: invId });
    expect(issued.invoiceNumber).toBe('2026-084');
    await expect(call('invoice.update', { id: invId, patch: { notes: 'x' } })).rejects.toThrow('Solo se pueden editar borradores');

    // next invoice continues the sequence
    const { id: inv2 } = await call<{ id: string }>('invoice.draft', { clientId, date: '2026-10-01', jobIds: [jobIds[3]] });
    expect((await call<{ invoiceNumber: string }>('invoice.issue', { id: inv2 })).invoiceNumber).toBe('2026-085');

    await call('invoice.sent', { id: invId });
    await call('invoice.paid', { id: invId, date: '2026-10-10' });
    inv = parseDoc(InvoiceSchema, invId, await one('invoices', invId))!;
    expect(inv.status).toBe('paid');
    expect(inv.paidAt).toBe('2026-10-10');
    expect(inv.issuer?.taxId).toBe('12345678Z');

    // cancelling an issued invoice keeps its number and frees its jobs
    await call('invoice.cancel', { id: inv2 });
    expect((await one('invoices', inv2)).status).toBe('cancelled');
    expect((await one('invoices', inv2)).invoiceNumber).toBe('2026-085');
    expect((await one('jobs', jobIds[3]!)).invoiceId).toBeNull();
    // a cancelled number is never reused
    const { id: inv3 } = await call<{ id: string }>('invoice.draft', { clientId, date: '2026-10-02', jobIds: [jobIds[3]] });
    expect((await call<{ invoiceNumber: string }>('invoice.issue', { id: inv3 })).invoiceNumber).toBe('2026-086');

    // invoiced jobs are locked
    await expect(call('job.update', { id: jobIds[0], patch: { unitPrice: 1 } })).rejects.toThrow('ya está en una factura');
    await expect(call('job.delete', { id: jobIds[0] })).rejects.toThrow('No se puede borrar');

    // every step is in the activity log
    const log = (await all('activity_logs')).map((l) => l.action);
    expect(log).toEqual(expect.arrayContaining(['client.create', 'job.create', 'invoice.draft', 'invoice.issue', 'invoice.sent', 'invoice.paid', 'invoice.cancel']));
  });

  it('records expenses with VAT split and a subscription charge', async () => {
    const { call, one, all } = setup();
    const { id: e } = await call<{ id: string }>('expense.create', { date: '2026-07-17', vendor: 'MediaMarkt', category: 'hardware', total: 4999, vatRate: 21 });
    const exp = parseDoc(ExpenseSchema, e, await one('expenses', e))!;
    expect(exp).toMatchObject({ base: 4131, vat: 868, status: 'pending' });

    const { id: s } = await call<{ id: string }>('subscription.create', { name: 'Adobe CC', vendor: 'Adobe', category: 'software', amount: 6049, cycle: 'monthly', status: 'active', nextRenewalDate: '2026-10-10', startDate: '2025-01-31' });
    const r = await call<{ expenseId: string }>('subscription.charge', { id: s });
    const sub = parseDoc(SubscriptionSchema, s, await one('subscriptions', s))!;
    expect(sub.lastChargeDate).toBe('2026-10-10');
    expect(sub.nextRenewalDate).toBe('2026-11-10');
    const charge = parseDoc(ExpenseSchema, r.expenseId, await one('expenses', r.expenseId))!;
    expect(charge).toMatchObject({ vendor: 'Adobe', total: 6049, subscriptionId: s, status: 'pending', category: 'software' });
    expect((await all('expenses')).length).toBe(2);
  });

  it('turns inbox uploads into an expense or an income invoice, and flags duplicates', async () => {
    const { call, one } = setup();
    await call('client.create', { name: 'City Hall', taxId: 'B12345678' });
    const text = 'Adobe Systems Software Ireland Ltd\nInvoice Number: IEE1\nInvoice Date 05/10/2026\nTotal 60,49 €\nVAT 21%';
    const proposal = classifyDocument({ filename: 'adobe.pdf', mimeType: 'application/pdf', text }, { issuer: { name: '', legalName: '', taxId: '' }, clients: [], subscriptions: [], today: '2026-10-07' });
    const sha = 'a'.repeat(64);
    const a = await call<{ id: string; duplicateOf: string | null }>('inbox.create', { filename: 'adobe.pdf', mimeType: 'application/pdf', size: 1000, sha256: sha, storagePath: null, textExcerpt: text, proposal });
    const b = await call<{ id: string; duplicateOf: string | null }>('inbox.create', { filename: 'adobe (1).pdf', mimeType: 'application/pdf', size: 1000, sha256: sha, storagePath: null, textExcerpt: text, proposal });
    expect(a.duplicateOf).toBeNull();
    expect(b.duplicateOf).toBe(a.id);

    const res = await call<{ kind: string; id: string }>('inbox.confirm', { id: a.id, kind: 'expense', date: '2026-10-05', vendor: 'Adobe', total: 6049, vatRate: 21, category: 'software' });
    expect(res.kind).toBe('expense');
    expect((await one('expenses', res.id)).fileId).toBe(a.id);
    expect((await one('inbox', a.id)).status).toBe('completed');
    await expect(call('inbox.confirm', { id: a.id, kind: 'expense', date: '2026-10-05', vendor: 'Adobe', total: 1, vatRate: 21 })).rejects.toThrow('ya está procesado');

    await expect(call('inbox.confirm', { id: b.id, kind: 'income', date: '2026-09-30', total: 12720, vatRate: 21, irpfRate: 15 })).rejects.toThrow('cliente');
    const inc = await call<{ kind: string; id: string }>('inbox.confirm', { id: b.id, kind: 'income', date: '2026-09-30', total: 12720, vatRate: 21, irpfRate: 15, clientId: 'city-hall', invoiceNumber: '2026-084' });
    const inv = parseDoc(InvoiceSchema, inc.id, await one('invoices', inc.id))!;
    expect(inv).toMatchObject({ external: true, invoiceNumber: '2026-084', subtotal: 12000, total: 12720, status: 'sent' });
  });

  it('links a job to the task it came from', async () => {
    const { call, one } = setup();
    await call('client.create', { name: 'Icon' });
    const { id: taskId } = await call<{ id: string }>('task.create', { title: 'Flyer viernes', clientId: 'icon', dueDate: '2026-10-09', order: 1024 });
    const { id: jobId } = await call<{ id: string }>('job.create', { clientId: 'icon', date: '2026-10-09', concept: 'Flyer viernes', unitPrice: 3000, taskId });
    expect(parseDoc(TaskSchema, taskId, await one('tasks', taskId))!.jobId).toBe(jobId);
    expect(parseDoc(JobSchema, jobId, await one('jobs', jobId))!.taskId).toBe(taskId);
    await call('job.delete', { id: jobId });
    expect(parseDoc(TaskSchema, taskId, await one('tasks', taskId))!.jobId).toBeNull();
  });

  it('stores only ciphertext in the vault and can reset it', async () => {
    const { call, all } = setup();
    const meta = { salt: 'c2FsdHNhbHQ=', iterations: 310000, verifier: { iv: 'aXZpdml2aXY=', data: 'Y2lwaGVy' } };
    await call('vault.setup', meta);
    await expect(call('vault.setup', meta)).rejects.toThrow('ya está creada');
    await call('vault.create', { clientId: 'icon', label: 'Instagram', username: '@icon', secret: { iv: 'aXZpdml2aXY=', data: 'ZW5j' } });
    expect((await all('vault'))[0]).toMatchObject({ label: 'Instagram', secret: { data: 'ZW5j' } });
    await expect(call('vault.reset', { confirm: 'no' })).rejects.toThrow('Datos no válidos');
    await call('vault.reset', { confirm: 'BORRAR' });
    expect(await all('vault')).toEqual([]);
  });

  it('imports this week from Asana once, detecting clients', async () => {
    const { call, all } = setup();
    for (const c of [{ name: 'City Hall', aliases: ['city'] }, { name: 'Icon' }, { name: 'Level Andorra', aliases: ['level and'] }, { name: 'Level Barcelona', aliases: ['level bcn'] }]) await call('client.create', c);
    expect((await call<{ applied: string[] }>('system.migrate', {})).applied).toEqual(['2026-10-07-import-week-41']);
    expect((await call<{ applied: string[] }>('system.migrate', {})).applied).toEqual([]);
    const tasks = (await all('tasks')).map((t) => parseDoc(TaskSchema, t.id as string, t)!);
    expect(tasks.length).toBe(32);
    expect(tasks.filter((t) => t.status === 'completed').length).toBe(20);
    expect(tasks.filter((t) => t.dueDate === '2026-10-07' && t.status === 'pending').length).toBe(12);
    const icon = tasks.find((t) => t.id === 'import-w41-2026-10-06-3')!;
    expect(icon).toMatchObject({ title: 'Cambio 11 oct', clientId: 'icon' });
    expect(tasks.find((t) => t.id === 'import-w41-2026-10-05-6')).toMatchObject({ title: 'Sab1', clientId: 'level-andorra' });
    expect(tasks.find((t) => t.id === 'import-w41-2026-10-07-1')).toMatchObject({ title: 'FACTURAS', clientId: null, priority: 'high' });
  });

  it('enforces Firestore transaction rules (reads before writes, no undefined)', async () => {
    const db = new MemoryDb();
    await expect(
      db.runTransaction(async (tx) => {
        tx.set(db.doc('a/1'), { x: 1 });
        await tx.get(db.doc('a/2'));
      }),
    ).rejects.toThrow('read after write');
    await expect(db.doc('a/1').set({ x: undefined })).rejects.toThrow('undefined');
  });
});
