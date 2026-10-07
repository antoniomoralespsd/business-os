import { describe, expect, it } from 'vitest';
import { ExpenseSchema, InboxItemSchema, InvoiceSchema, JobSchema, SubscriptionSchema, TaskSchema } from '@bos/schemas';
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

  it('imports a historic invoice folder: creates or learns clients, rectificativas, paid, drive and settings', async () => {
    const { call, one, all } = setup();
    await call('client.create', { name: 'City Hall' });
    const ctx = { issuer: { name: '', legalName: '', taxId: '' }, clients: [], subscriptions: [], today: '2026-10-07' };
    const mk = async (n: number, text: string, path: string) => {
      const proposal = classifyDocument({ filename: `f${n}.pdf`, mimeType: 'application/pdf', text, path }, ctx);
      return (await call<{ id: string }>('inbox.create', { filename: `f${n}.pdf`, mimeType: 'application/pdf', size: 10, sha256: String(n).repeat(64).slice(0, 64), sourcePath: path, textExcerpt: text, proposal })).id;
    };
    const a = await mk(1, 'Antonio\nNIF 12345678Z\nFactura nº F-1\nFecha: 10/02/2026\nOcio Sur SL\nCIF B87654321\nTotal 121,00 €', '2026/02 FEBRERO/Ingresos/f1.pdf');
    const b = await mk(2, 'Antonio\nNIF 12345678Z\nFactura nº F-2\nFecha: 11/03/2026\nOcio Sur SL\nCIF B87654321\nTotal 242,00 €', '2026/03 MARZO/Ingresos/f2.pdf');
    const r = await mk(3, 'Factura rectificativa R-1\nFecha: 12/03/2026\nCIF B11111111\nTotal -60,50 €', '2026/Rectificativas/f3.pdf');
    expect(parseDoc(InboxItemSchema, a, await one('inbox', a))!.sourcePath).toBe('2026/02 FEBRERO/Ingresos/f1.pdf');

    // New client created from the invoice, then reused (same NIF) instead of duplicated.
    const ra = await call<{ clientId: string; learned: boolean }>('inbox.confirm', { id: a, kind: 'income', date: '2026-02-10', total: 12100, vatRate: 21, invoiceNumber: 'F-1', taxId: 'B87654321', newClient: { name: 'Ocio Sur SL', taxId: 'B87654321' }, paid: true });
    const rb = await call<{ clientId: string }>('inbox.confirm', { id: b, kind: 'income', date: '2026-03-11', total: 24200, vatRate: 21, invoiceNumber: 'F-2', taxId: 'B-87654321', newClient: { name: 'Ocio Sur', taxId: 'B-87654321' } });
    expect(ra).toMatchObject({ clientId: 'ocio-sur-sl', learned: true });
    expect(rb.clientId).toBe('ocio-sur-sl');
    expect((await all('clients')).length).toBe(2);
    const invs = (await all('invoices')).map((d) => parseDoc(InvoiceSchema, String(d.id), d)!);
    expect(invs.find((i) => i.invoiceNumber === 'F-1')).toMatchObject({ status: 'paid', total: 12100 });
    expect(invs.find((i) => i.invoiceNumber === 'F-2')).toMatchObject({ status: 'sent' });

    // Assigning to an existing client teaches it the NIF.
    const rr = await call<{ id: string; learned: boolean }>('inbox.confirm', { id: r, kind: 'income', date: '2026-03-12', total: 6050, vatRate: 21, invoiceNumber: 'R-1', taxId: 'B11111111', clientId: 'city-hall', rectificativa: true });
    expect(rr.learned).toBe(true);
    expect((await one('clients', 'city-hall')).taxId).toBe('B11111111');
    expect(parseDoc(InvoiceSchema, rr.id, await one('invoices', rr.id))).toMatchObject({ total: -6050, subtotal: -5000 });
    expect(parseDoc(InboxItemSchema, r, await one('inbox', r))!.filedAs).toMatchObject({ kind: 'income', rectificativa: true, date: '2026-03-12' });

    await call('inbox.attachDrive', { id: r, drive: { account: 'antoniomorales.psd@gmail.com', fileId: 'abc', name: 'x.pdf', folder: 'Business OS/Facturación/2026/Rectificativas', webViewLink: 'https://drive.google.com/file/d/abc/view' } });
    expect(parseDoc(InboxItemSchema, r, await one('inbox', r))!.drive?.fileId).toBe('abc');

    await call('settings.google', { add: 'antoniomorales.psd@gmail.com' });
    await call('settings.google', { add: 'a9214@esdi.edu.es' });
    expect(await one('settings', 'google')).toMatchObject({ billingAccount: 'antoniomorales.psd@gmail.com' });
    await call('settings.google', { remove: 'antoniomorales.psd@gmail.com' });
    expect(await one('settings', 'google')).toMatchObject({ billingAccount: 'a9214@esdi.edu.es' });
  });

  it('removes pending uploads, undoes a confirmation and links an already registered invoice', async () => {
    const { call, one, all } = setup();
    await call('client.create', { name: 'Otto' });
    const ctx = { issuer: { name: '', legalName: '', taxId: '' }, clients: [], subscriptions: [], today: '2026-10-07' };
    const mk = async (n: number) => {
      const proposal = classifyDocument({ filename: `f${n}.pdf`, mimeType: 'application/pdf', text: '' }, ctx);
      return (await call<{ id: string }>('inbox.create', { filename: `f${n}.pdf`, mimeType: 'application/pdf', size: 1, sha256: String(n).repeat(64).slice(0, 64), proposal })).id;
    };
    const [a, b, c] = [await mk(1), await mk(2), await mk(3)];
    const inv = await call<{ id: string }>('inbox.confirm', { id: a, kind: 'income', date: '2026-07-01', total: 58300, vatRate: 21, irpfRate: 15, invoiceNumber: '0528', clientId: 'otto' });
    // Same invoice again (PDF from Drive + PDF from the PC) → linked, not duplicated.
    const again = await call<{ id: string; duplicate?: boolean }>('inbox.confirm', { id: b, kind: 'income', date: '2026-07-01', total: 58300, vatRate: 21, irpfRate: 15, invoiceNumber: '528', clientId: 'otto' });
    expect(again).toMatchObject({ id: inv.id, duplicate: true });
    expect((await all('invoices')).length).toBe(1);
    // Undo the linked one: the invoice stays (it belongs to the other file).
    await call('inbox.undo', { id: b });
    expect((await all('invoices')).length).toBe(1);
    // Undo the original: its imported invoice goes away and the file is pending again.
    await call('inbox.undo', { id: a });
    expect((await all('invoices')).length).toBe(0);
    expect((await one('inbox', a)).status).toBe('needs_confirmation');
    // Bulk undo.
    await call('inbox.confirm', { id: a, kind: 'income', date: '2026-07-01', total: 58300, vatRate: 21, invoiceNumber: '0528', clientId: 'otto' });
    expect(await call('inbox.undoMany', { ids: [a, b] })).toEqual({ undone: 1, removed: 1 });
    expect((await all('invoices')).length).toBe(0);
    // Remove pending ones; completed ones are protected.
    await call('inbox.confirm', { id: c, kind: 'other', date: '2026-07-01', total: 0, vatRate: 0 });
    expect((await call<{ removed: number }>('inbox.remove', { ids: [a, b, c] })).removed).toBe(2);
    expect((await all('inbox')).map((d) => d.id)).toEqual([c]);
  });

  it('syncs, numbers by date and marks albaranes as collected', async () => {
    const { call, all } = setup();
    const base = { recipients: ['Level barcelona'], clientIds: [], lines: 3 };
    await call('albaran.sync', { items: [
      { ...base, driveFileId: 'f-ago', driveName: 'ALBARAN LEVEL AGOSTO 2026', title: 'LEVEL AGOSTO 2026', date: '2026-08-31', total: 70000 },
      { ...base, driveFileId: 'f-jun', driveName: 'ALBARAN LEVEL JUNIO 2026', title: 'LEVEL JUNIO 2026', date: '2026-06-30', total: 50000 },
    ] });
    const r = await call<{ numbered: { id: string; number: number }[] }>('albaran.number', { restart: true });
    const rows = await all('albaranes');
    const byFile = (f: string) => rows.find((x) => x.driveFileId === f)!;
    expect(r.numbered.find((n) => n.id === byFile('f-jun').id)?.number).toBe(1);
    expect(r.numbered.find((n) => n.id === byFile('f-ago').id)?.number).toBe(2);
    await call('albaran.sync', { items: [{ ...base, driveFileId: 'f-sep', driveName: 'x', title: 'LEVEL SEPTIEMBRE', date: '2026-09-30', total: 1000 }] });
    const r2 = await call<{ numbered: { number: number }[] }>('albaran.number', { restart: false });
    expect(r2.numbered.map((n) => n.number)).toEqual([3]);
    await call('albaran.update', { id: String(byFile('f-jun').id), patch: { status: 'paid' } });
    expect((await all('albaranes')).find((x) => x.driveFileId === 'f-jun')).toMatchObject({ status: 'paid' });
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
