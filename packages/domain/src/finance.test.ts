import { describe, expect, it } from 'vitest';
import type { Expense, Invoice, Job, Subscription } from '@bos/schemas';
import { billingAlerts, formatInvoiceNumber, quarterOf, quarterRange, summarizeQuarter, unbilledByClient } from './billing';
import { classifyDocument, findCounterparty, monthInName, findDates, findTaxIds, findTotal, pathHints, suggestFilename } from './classify';
import { computeTotals, formatEUR, parseEuro, splitVat } from './money';
import { advanceRenewal, monthlyEquivalent, renewalWindow, subscriptionAlerts, subscriptionTotals, yearlyEquivalent } from './subscriptions';

const base = { workspaceId: 'w', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', createdBy: 'u' };

describe('money', () => {
  it('parses Spanish and English formats', () => {
    expect(parseEuro('49,99')).toBe(4999);
    expect(parseEuro('49.99')).toBe(4999);
    expect(parseEuro('1.234,56 €')).toBe(123456);
    expect(parseEuro('1,234.56')).toBe(123456);
    expect(parseEuro('30')).toBe(3000);
    expect(parseEuro('1.200')).toBe(120000);
    expect(parseEuro('abc')).toBeNull();
  });
  it('formats euros', () => {
    expect(formatEUR(123456)).toMatch(/1\.?234,56/);
    expect(formatEUR(4999)).toMatch(/49,99/);
  });
  it('computes Spanish invoice totals (IVA 21, IRPF 15)', () => {
    const t = computeTotals([{ quantity: 4, unitPrice: 3000 }], 21, 15);
    expect(t).toEqual({ subtotal: 12000, tax: 2520, withholding: 1800, total: 12720 });
  });
  it('splits VAT from a total', () => {
    expect(splitVat(4999, 21)).toEqual({ base: 4131, vat: 868 });
  });
});

describe('billing', () => {
  const inv = (o: Partial<Invoice>): Invoice => ({
    ...base, id: 'i', series: '', number: 1, invoiceNumber: '2026-001', clientId: 'c', client: { name: 'City Hall', legalName: '', taxId: '', address: '', email: '' },
    issuer: null, date: '2026-07-10', dueDate: '2026-08-09', lines: [], vatRate: 21, irpfRate: 15, subtotal: 10000, tax: 2100, withholding: 1500, total: 10600,
    status: 'issued', sentAt: null, paidAt: null, notes: '', external: false, fileId: null, archived: false, ...o,
  });
  const exp = (o: Partial<Expense>): Expense => ({
    ...base, id: 'e', date: '2026-07-17', vendor: 'MediaMarkt', vendorTaxId: '', concept: '', invoiceNumber: '', category: 'hardware', base: 4131, vatRate: 21, vat: 868, total: 4999,
    deductible: true, status: 'confirmed', subscriptionId: null, clientId: null, fileId: 'f', notes: '', archived: false, ...o,
  });
  it('numbers and quarters', () => {
    expect(formatInvoiceNumber('', 2026, 84)).toBe('2026-084');
    expect(formatInvoiceNumber('F', 2026, 5)).toBe('F2026-005');
    expect(quarterOf('2026-09-30')).toEqual({ year: 2026, q: 3 });
    expect(quarterRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });
  it('summarizes a quarter for the gestoría', () => {
    const s = summarizeQuarter([inv({}), inv({ id: 'd', status: 'draft' }), inv({ id: 'x', date: '2026-10-01' })], [exp({}), exp({ id: 'nd', deductible: false })], 2026, 3);
    expect(s.invoices).toBe(1);
    expect(s.incomeBase).toBe(10000);
    expect(s.vatCollected).toBe(2100);
    expect(s.vatPaid).toBe(868);
    expect(s.vatToPay).toBe(2100 - 868);
    expect(s.profit).toBe(10000 - 4131);
    expect(s.irpfInstallment).toBe(Math.max(0, Math.round((10000 - 4131) * 0.2) - 1500));
  });
  it('raises alerts for unbilled work, unsent and overdue invoices', () => {
    const jobs: Job[] = [
      { ...base, id: 'j1', clientId: 'c', date: '2026-09-02', concept: 'Flyer', quantity: 1, unitPrice: 3000, invoiceId: null, taskId: null, archived: false },
      { ...base, id: 'j2', clientId: 'c', date: '2026-09-09', concept: 'Flyer', quantity: 1, unitPrice: 3000, invoiceId: 'i', taskId: null, archived: false },
    ];
    expect(unbilledByClient(jobs).get('c')).toEqual({ count: 1, amount: 3000, oldest: '2026-09-02' });
    const alerts = billingAlerts({ jobs, invoices: [inv({ status: 'issued' }), inv({ id: 'o', status: 'sent', dueDate: '2026-09-01' })], expenses: [exp({ status: 'pending' })], clientName: () => 'City Hall' }, '2026-10-07');
    expect(alerts.map((a) => a.id)).toEqual(['unbilled-c', 'unsent-i', 'overdue-o', 'expenses-pending']);
    expect(alerts[0]!.severity).toBe('warning');
  });
});

describe('subscriptions', () => {
  const sub = (o: Partial<Subscription>): Subscription => ({
    ...base, id: 's', name: 'Adobe CC', vendor: 'Adobe', category: 'software', plan: '', amount: 6049, vatRate: 21, currency: 'EUR', cycle: 'monthly', startDate: null,
    nextRenewalDate: '2026-10-10', endDate: null, autoRenew: true, status: 'active', remindDaysBefore: 7, account: '', paymentLabel: '', manageUrl: '', deductible: true, notes: '', lastChargeDate: null, ...o,
  });
  it('normalizes costs', () => {
    expect(monthlyEquivalent(sub({ amount: 12000, cycle: 'yearly' }))).toBe(1000);
    expect(yearlyEquivalent(sub({ amount: 1000, cycle: 'monthly' }))).toBe(12000);
    expect(subscriptionTotals([sub({}), sub({ id: 'c', status: 'cancelled' })]).monthly).toBe(6049);
  });
  it('advances renewals keeping the day', () => {
    expect(advanceRenewal('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceRenewal('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    expect(advanceRenewal('2026-10-10', 'yearly')).toBe('2027-10-10');
    expect(advanceRenewal('2026-10-10', 'quarterly')).toBe('2027-01-10');
  });
  it('warns before renewals and about unregistered charges', () => {
    expect(renewalWindow(sub({}), '2026-10-07')).toBe('week');
    const a = subscriptionAlerts([sub({}), sub({ id: 'old', name: 'Dropbox', nextRenewalDate: '2026-10-01' }), sub({ id: 't', name: 'Figma', status: 'trial', endDate: '2026-10-08', nextRenewalDate: null })], '2026-10-07', (c) => `${c / 100} €`);
    expect(a.map((x) => x.id).sort()).toEqual(['charge-old', 'renew-s', 'trial-t']);
  });
});

describe('document classifier', () => {
  const ctx = {
    issuer: { name: 'Iris Design', legalName: 'Antonio Morales', taxId: '12345678Z' },
    clients: [
      { id: 'city-hall', name: 'City Hall', legalName: 'City Hall Barcelona SL', taxId: 'B12345678', aliases: ['city'], status: 'active' as const },
      { id: 'bellaka', name: 'Bellaka', legalName: '', taxId: '', aliases: [], status: 'active' as const },
    ],
    subscriptions: [{ id: 'sub-adobe', name: 'Adobe Creative Cloud', vendor: 'Adobe' }],
    today: '2026-10-07',
  };

  it('extracts tax ids, dates and totals', () => {
    expect(findTaxIds('CIF: B-12345678 · NIF 12345678Z · VAT IE6364992H')).toEqual(['B12345678', '12345678Z', 'IE6364992H']);
    expect(findDates('Fecha: 17/07/2026 y 2026-08-01 y 3 de septiembre de 2026')).toEqual(['2026-07-17', '2026-08-01', '2026-09-03']);
    expect(findTotal('Subtotal 41,31 €\nIVA 21% 8,68 €\nTOTAL 49,99 €').value).toBe(4999);
  });

  it('recognizes an Adobe invoice as a software expense linked to the subscription', () => {
    const text = `Adobe Systems Software Ireland Ltd\nVAT IE6364992H\nInvoice Number: IEE2026001234\nInvoice Date 05/10/2026\nBill to: Antonio Morales 12345678Z\nSubtotal 49,99 €\nVAT 21% 10,50 €\nTotal 60,49 €`;
    const p = classifyDocument({ filename: 'adobe-invoice.pdf', mimeType: 'application/pdf', text }, ctx);
    expect(p.kind.value).toBe('expense');
    expect(p.vendor.value).toBe('Adobe');
    expect(p.category.value).toBe('software');
    expect(p.total.value).toBe(6049);
    expect(p.base.value).toBe(4999);
    expect(p.vatRate.value).toBe(21);
    expect(p.date.value).toBe('2026-10-05');
    expect(p.invoiceNumber.value).toBe('IEE2026001234');
    expect(p.subscriptionId.value).toBe('sub-adobe');
    expect(p.clientId.value).toBeNull();
  });

  it('recognizes my own invoice to a client as income', () => {
    const text = `Antonio Morales · Iris Design\nNIF 12345678Z\nFactura nº 2026-084\nFecha: 30/09/2026\nCliente: City Hall Barcelona SL\nCIF B12345678\nFlyer 02/09 30,00\nBase imponible 120,00 €\nIVA 21% 25,20 €\nIRPF 15% -18,00 €\nTotal 127,20 €`;
    const p = classifyDocument({ filename: 'Factura 2026-084.pdf', mimeType: 'application/pdf', text }, ctx);
    expect(p.kind.value).toBe('income');
    expect(p.clientId.value).toBe('city-hall');
    expect(p.total.value).toBe(12720);
    expect(p.base.value).toBe(12000);
    expect(p.irpfRate.value).toBe(15);
    expect(p.invoiceNumber.value).toBe('2026-084');
  });

  it('treats a WhatsApp photo as a ticket with the date from its name', () => {
    const p = classifyDocument({ filename: 'WhatsApp Image 2026-07-17 at 13.02.11.jpeg', mimeType: 'image/jpeg', text: '' }, ctx);
    expect(p.kind.value).toBe('expense');
    expect(p.date.value).toBe('2026-07-17');
    expect(p.total.value).toBeNull();
    expect(suggestFilename({ ...p, vendor: { value: 'MediaMarkt', confidence: 1, reason: '' }, total: { value: 4999, confidence: 1, reason: '' } }, null, 'jpg')).toBe('2026-07-17_MEDIAMARKT_49,99.jpg');
  });

  it('does not invent a vendor for unrelated documents', () => {
    const p = classifyDocument({ filename: 'contrato.pdf', mimeType: 'application/pdf', text: 'Contrato de colaboración entre las partes' }, ctx);
    expect(p.kind.value).toBe('other');
    expect(p.total.value).toBeNull();
  });

  it('reads hints from the folder structure', () => {
    expect(pathHints('2026/03 MARZO/Ingresos/f.pdf')).toEqual({ kind: 'income', rectificativa: false, year: 2026, month: 3 });
    expect(pathHints('FACTURAS/2026/01 ENERO/GASTOS/ticket.jpg')).toEqual({ kind: 'expense', rectificativa: false, year: 2026, month: 1 });
    expect(pathHints('2026/Rectificativas/R-001.pdf')).toEqual({ kind: 'income', rectificativa: true, year: 2026, month: null });
    expect(pathHints('suelto.pdf')).toEqual({ kind: null, rectificativa: false, year: null, month: null });
  });

  it('classifies a historic income invoice by folder even without my NIF, and names the unknown client', () => {
    const text = `Antonio Morales\nNIF 12345678Z\nFactura nº 2026-011\nFecha: 14/02/2026\nOcio Nocturno Sur SL\nCIF B87654321\nCalle Mayor 3, 08001 Barcelona\nBase imponible 200,00 €\nIVA 21% 42,00 €\nTotal 212,00 €`;
    const noIssuer = { ...ctx, issuer: { name: '', legalName: '', taxId: '' } };
    const p = classifyDocument({ filename: 'F2026-011.pdf', mimeType: 'application/pdf', text, path: '2026/02 FEBRERO/Ingresos/F2026-011.pdf' }, noIssuer);
    expect(p.kind.value).toBe('income');
    expect(p.taxId.value).toBe('B87654321');
    expect(p.counterparty.value).toBe('Ocio Nocturno Sur SL');
    expect(p.clientId.value).toBeNull();
    expect(p.date.value).toBe('2026-02-14');
    expect(p.total.value).toBe(21200);
  });

  it('marks corrective invoices and reads negative totals as amounts', () => {
    const text = `Factura rectificativa R-2026-002\nFecha: 03/04/2026\nCliente: City Hall Barcelona SL\nCIF B12345678\nTotal -60,50 €`;
    const p = classifyDocument({ filename: 'R-2026-002.pdf', mimeType: 'application/pdf', text, path: '2026/Rectificativas/R-2026-002.pdf' }, ctx);
    expect(p.rectificativa).toBe(true);
    expect(p.kind.value).toBe('income');
    expect(p.clientId.value).toBe('city-hall');
    expect(p.total.value).toBe(6050);
  });

  it('finds the counterparty from a label', () => {
    expect(findCounterparty('Facturar a: Bellaka Events SLU\nNIF B11111111', 'B11111111').value).toBe('Bellaka Events SLU');
  });

  it('reads the month from file names like "gasto nov 25 1.jpg"', () => {
    expect(monthInName('gasto nov 25 1.jpg', { year: 2026, month: 1 })).toEqual({ year: 2025, month: 11 });
    expect(monthInName('chatgpt enero 1.pdf', { year: 2026, month: 1 })).toEqual({ year: 2026, month: 1 });
    expect(monthInName('gasto dic 2.jpg', { year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
    expect(monthInName('F2026-011.pdf', { year: 2026, month: 2 })).toBeNull();
    const p = classifyDocument({ filename: 'gasto nov 25 1.jpg', mimeType: 'image/jpeg', text: '', path: '2026/01 ENERO/GASTOS/gasto nov 25 1.jpg' }, ctx);
    expect(p.kind.value).toBe('expense');
    expect(p.date.value).toBe('2025-11-01');
    expect(p.invoiceNumber.value).toBeNull();
  });

  it('reads an OCR ticket', () => {
    const text = 'MERCADONA, S.A.\nA-46103834\nC/ MAJOR 12 BARCELONA\nFACTURA SIMPLIFICADA: 2345-021-123456\n12/11/2025 18:32\nTOTAL (€) 23,45\nIVA BASE IMPONIBLE (€) CUOTA (€)\n10% 21,32 2,13';
    const p = classifyDocument({ filename: 'gasto nov 25 1.jpg', mimeType: 'image/jpeg', text, path: '2026/01 ENERO/GASTOS/gasto nov 25 1.jpg' }, ctx);
    expect(p.kind.value).toBe('expense');
    expect(p.total.value).toBe(2345);
    expect(p.date.value).toBe('2025-11-12');
    expect(p.vendor.value).toBe('MERCADONA, S.A.');
  });
});

