import { describe, expect, it } from 'vitest';
import { fillSequence, labelFromName, looksNamed, proposeFileName } from './naming';

describe('file names like Toni\'s', () => {
  it('names monthly expenses by vendor and month', () => {
    expect(proposeFileName({ kind: 'expense', date: '2026-10-01', ext: 'pdf', vendor: 'Tesorería General de la Seguridad Social', originalName: '092681022420261001170335001612.pdf' })).toBe('autonomos octubre.pdf');
    expect(proposeFileName({ kind: 'expense', date: '2026-10-05', ext: 'pdf', vendor: 'Telefónica Móviles (O2)', originalName: 'FACTURA02_OM4VMFJ0372811.pdf' })).toBe('o2 octubre.pdf');
    expect(proposeFileName({ kind: 'expense', date: '2026-10-03', ext: 'pdf', vendor: 'OpenAI, LLC', originalName: 'invoice (1).pdf' })).toBe('chatgpt octubre.pdf');
    expect(proposeFileName({ kind: 'expense', date: '2026-10-08', ext: 'jpg', vendor: 'ESTACION DE SERVICIO X', originalName: 'IMG_2031.jpg' })).toBe('gasolina octubre.jpg');
    expect(proposeFileName({ kind: 'expense', date: '2026-10-08', ext: 'jpg', vendor: 'Bar Pepe', originalName: 'IMG_2031.jpg' })).toBe('gasto oct 26 {n}.jpg');
    expect(proposeFileName({ kind: 'expense', date: '2026-10-08', ext: 'pdf', vendor: 'Cosa Rara SL', learned: { 'cosa rara': 'imprenta' }, originalName: 'x123456789.pdf' })).toBe('imprenta octubre.pdf');
  });
  it('keeps names you already gave', () => {
    expect(looksNamed('luz marzo.pdf')).toBe(true);
    expect(looksNamed('0528 Otto JUNIO Antonio Morales (01_07_26) - Factura.pdf')).toBe(true);
    expect(looksNamed('Receipt-2805-7355-7540.pdf')).toBe(false);
    expect(proposeFileName({ kind: 'expense', date: '2026-03-01', ext: 'pdf', vendor: 'Endesa', originalName: 'luz marzo.pdf' })).toBe('luz marzo.pdf');
  });
  it('names your own invoices with the usual convention', () => {
    expect(proposeFileName({ kind: 'income', date: '2026-07-01', ext: 'pdf', invoiceNumber: '528', clientName: 'Otto', owner: 'Antonio Morales', originalName: 'factura.pdf' })).toBe('0528 Otto JUNIO Antonio Morales (01_07_26) - Factura.pdf');
    expect(proposeFileName({ kind: 'income', date: '2026-03-31', ext: 'pdf', invoiceNumber: '31', clientName: 'Obvio', rectificativa: true, originalName: 'x.pdf' })).toBe('FR0031 Obvio MARZO Antonio Morales (31_03_26) - Factura.pdf');
  });
  it('numbers repeated names in the folder', () => {
    expect(fillSequence('gasto oct 26 {n}.jpg', ['gasto oct 26 1.jpg', 'gasto oct 26 2.jpg', 'luz octubre.pdf'])).toBe('gasto oct 26 3.jpg');
    expect(fillSequence('gasto oct 26 {n}.jpg', [])).toBe('gasto oct 26 1.jpg');
    expect(fillSequence('adobe octubre.pdf', ['adobe octubre.pdf'])).toBe('adobe octubre 2.pdf');
    expect(fillSequence('o2 octubre.pdf', [])).toBe('o2 octubre.pdf');
  });
  it('learns the label from a name you typed', () => {
    expect(labelFromName('imprenta octubre 2.pdf')).toBe('imprenta');
    expect(labelFromName('gasto oct 26 3.jpg')).toBeNull();
  });
});
