import { describe, expect, it } from 'vitest';
import { mergeAiExtraction } from './aiMerge';
import { classifyDocument, findDates, findVatRate } from './classify';
import { expenseLabel, proposeFileName } from './naming';

/** Real documents that were misread in October 2026 (texts anonymised). */
const ctx = {
  issuer: { name: 'Iris Design', legalName: 'Antonio Morales', taxId: '12345678Z' },
  clients: [{ id: 'otto', name: 'Otto', legalName: '', taxId: 'B00000000', aliases: [], status: 'active' as const }],
  subscriptions: [],
  today: '2026-10-10',
};
const doc = (filename: string, text: string) => classifyDocument({ filename, mimeType: 'application/pdf', text }, ctx);

describe('Inbox: real cases', () => {
  it('reads dates in every format the suppliers use, never in the future', () => {
    expect(findDates('Invoice date 13-SEP-2026')).toEqual(['2026-09-13']);
    expect(findDates('September 13th, 2026')).toEqual(['2026-09-13']);
    expect(findDates('Sep 3 2026')).toEqual(['2026-09-03']);
    expect(findDates('13 de setembre de 2026')).toEqual(['2026-09-13']);
    expect(findDates('Ticket 12/06/77')).toEqual([]);
  });

  it('a Seguridad Social receipt charged by BBVA is "autonomos", 0 % VAT, expense', () => {
    const text = 'BBVA\nRecibo de la Seguridad Social\nTesorería General de la Seguridad Social\nR.E. Autonomos\nTitular: Antonio Morales 12345678Z\nFecha de cargo 30/09/2026\nImporte 299,57 €';
    const p = doc('recibo.pdf', text);
    expect(p.kind.value).toBe('expense');
    expect(p.vatRate.value).toBe(0);
    expect(p.vendor.value).toBe('Seguridad Social');
    // Even if "bbva" had been learned for this vendor, a tax keeps its name.
    expect(expenseLabel('BBVA', text, { bbva: 'bbva' })).toBe('autonomos');
    expect(proposeFileName({ kind: 'expense', date: '2026-09-30', ext: 'pdf', vendor: 'BBVA', text, learned: { bbva: 'bbva' } })).toBe('autonomos septiembre.pdf');
  });

  it('an O2 bill with your NIF as titular is an expense, not income', () => {
    const text = 'Telefónica de España SAU\nO2 Fibra y Móvil\nTitular: Antonio Morales\nNIF 12345678Z\nFactura nº 0002-ARGENTARIA\nFecha de emisión: 01/08/2026\nFecha de cargo: 08/08/2026\nTotal 38,00 €';
    const p = doc('factura.pdf', text);
    expect(p.kind.value).toBe('expense');
    expect(p.date.value).toBe('2026-08-01');
  });

  it('a fuel ticket keeps its 21 % VAT even if it says "exento" somewhere', () => {
    expect(findVatRate('BALLENOIL\nGasóleo A\nBase 41,32\nIVA 21% 8,68\nTotal 50,00\nOperación exenta de propina').value).toBe(21);
  });

  it('prefers the issue date over the due date', () => {
    const p = doc('luz.pdf', 'Iberdrola Clientes SAU\nFecha de vencimiento: 05/10/2026\nFecha de emisión: 18/09/2026\nTotal 45,10 €');
    expect(p.date.value).toBe('2026-09-18');
  });

  it('ignores an AI date in the future', () => {
    const rules = doc('x.pdf', 'Fecha: 18/09/2026\nTotal 10,00 €');
    const ai = { documentType: 'invoice', issuerName: 'X', issuerTaxId: null, customerName: null, customerTaxId: null, invoiceNumber: null, date: '2026-10-28', total: 10, base: null, vatAmount: null, vatRate: 21, irpfRate: null, category: 'otros', isRectificativa: false } as const;
    const m = mergeAiExtraction(rules, ai as never, { ownTaxId: '12345678Z', clients: [], folderKind: null, today: '2026-10-10' });
    expect(m.date.value).toBe('2026-09-18');
  });
});
