import { describe, expect, it } from 'vitest';
import { albaranTitle, nextSheetTitle, parseSheetDoc, parseSheetTitle } from './sheets';

const row = (cells: Record<string, string>) => {
  const r = Array(7).fill('');
  for (const [k, v] of Object.entries(cells)) r[k.charCodeAt(0) - 65] = v;
  return r;
};

const invoiceRows = [
  row({}), row({}),
  row({ B: 'Nombre Apellido' }), row({ B: '12345678Z' }), row({ B: 'Calle Falsa 1' }), row({ B: '08000, Barcelona' }), row({}),
  row({ B: 'Factura' }), row({}), row({}),
  row({ B: 'A la atención de', F: 'N.º de factura' }),
  row({ B: 'EJEMPLO SL', F: '528' }),
  row({ B: 'B08778037' }),
  row({ B: 'Calle 15', D: 'Proyecto', F: 'Fecha' }),
  row({ B: '08006 Barcelona', D: 'Diseños Otto', F: '1/07/2026' }),
  row({}), row({}),
  row({ B: 'Descripción', E: 'Cantidad', F: 'Precio unitario', G: 'Precio total' }),
  row({ B: 'Feed + historia 5 JUN', E: '1', F: '25,00 €', G: '25,00 €' }),
  row({ B: 'Feed + historia animada 6 JUN', E: '2', F: '40,00 €', G: '80,00 €' }),
  row({ G: '€0,00' }),
  row({ F: 'Base imponible', G: '105,00 €' }),
  row({ F: 'Cuota de IVA (21%)', G: '22,05 €' }),
  row({ F: 'Retención IRPF (15%)', G: '-15,75 €' }),
  row({ F: '111,30 €' }),
  row({}),
  row({ C: 'Forma de pago', D: 'Transferencia bancaria' }),
];

describe('invoice sheets', () => {
  it('parses the title convention', () => {
    expect(parseSheetTitle('0528 Otto JUNIO Antonio Morales (01/07/26)')).toEqual({ prefix: '', number: '0528', label: 'Otto JUNIO', date: '2026-07-01', rectificativa: false, albaran: false });
    expect(parseSheetTitle('FR0031 Obvio Barcelona FEB MAR Antonio Morales (31/03/26)')).toMatchObject({ number: 'FR0031', label: 'Obvio Barcelona FEB MAR', rectificativa: true });
    expect(parseSheetTitle('ALBARAN LEVEL AGOSTO 2026 Antonio Morales')).toMatchObject({ number: null, label: 'LEVEL AGOSTO 2026', albaran: true, date: null });
    expect(parseSheetTitle('ALB-003 LEVEL JULIO 2026 Antonio Morales (31/07/26)')).toMatchObject({ number: '003', label: 'LEVEL JULIO 2026', albaran: true });
  });

  it('reads number, date, client, lines and totals with the cells to edit', () => {
    const d = parseSheetDoc(invoiceRows);
    expect(d).toMatchObject({ number: '528', numberCell: 'F12', date: '2026-07-01', dateCell: 'F15', taxId: 'B08778037', project: 'Diseños Otto', base: 10500, vatRate: 21, vat: 2205, irpfRate: 15, irpf: 1575, total: 11130 });
    expect(d.recipients[0]).toBe('EJEMPLO SL');
    expect(d.lines).toEqual([
      { concept: 'Feed + historia 5 JUN', quantity: 1, unitPrice: 2500, total: 2500 },
      { concept: 'Feed + historia animada 6 JUN', quantity: 2, unitPrice: 4000, total: 8000 },
    ]);
  });

  it('names next month copies and albaranes', () => {
    const t = parseSheetTitle('0550 Descarada ABR MAY JUN JUL Antonio Morales (01/08/26)');
    expect(nextSheetTitle(t, { number: '0560', date: '2026-09-01', workMonth: 8 })).toBe('0560 Descarada AGOSTO Antonio Morales (01/09/26)');
    expect(albaranTitle(3, 'LEVEL JULIO 2026', '2026-07-31')).toBe('ALB-003 LEVEL JULIO 2026 Antonio Morales (31/07/26)');
  });
});
