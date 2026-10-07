'use client';
import { Printer } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { formatEUR } from '@bos/domain';
import { useInvoices, useIssuer } from '@/data/hooks';
import { numericDate } from '@/lib/format';

function InvoicePrint() {
  const id = useSearchParams().get('i');
  const { data } = useInvoices();
  const issuerSettings = useIssuer();
  const inv = (data ?? []).find((i) => i.id === id);

  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
    if (inv) document.title = `Factura ${inv.invoiceNumber ?? 'borrador'} · ${inv.client.name}`;
  }, [inv]);

  if (!data) return <p className="p-10 text-ink-3">Cargando…</p>;
  if (!inv) return <p className="p-10">Factura no encontrada.</p>;
  const issuer = inv.issuer ?? { name: issuerSettings?.name ?? '', legalName: issuerSettings?.legalName ?? '', taxId: issuerSettings?.taxId ?? '', address: issuerSettings?.address ?? '', email: issuerSettings?.email ?? '' };

  return (
    <div className="relative z-[1] min-h-dvh bg-[#e9e8e5] py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-end gap-2 px-4 print:hidden">
        <button type="button" onClick={() => window.print()} className="btn-primary px-4 py-2 text-[13px]">
          <Printer size={14} /> Imprimir / Guardar PDF
        </button>
      </div>
      <article className="relative mx-auto flex min-h-[297mm] w-full max-w-[210mm] flex-col bg-white px-[18mm] py-[16mm] text-[#0a0a0a] shadow-[0_8px_40px_-12px_rgba(0,0,0,.25)] print:shadow-none">
        <span className="iris-bar absolute inset-y-0 left-0 w-[5px]" aria-hidden />
        <header className="flex items-start justify-between gap-8">
          <div>
            <p className="font-display text-[54px] leading-[0.9]">Factura</p>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5c5c5c]">Nº {inv.invoiceNumber ?? 'BORRADOR'}</p>
          </div>
          <div className="text-right text-[11.5px] leading-relaxed">
            <p className="font-display text-[26px] leading-none">{issuer.name || issuer.legalName}</p>
            {issuer.name && issuer.legalName && <p className="mt-2">{issuer.legalName}</p>}
            <p>NIF {issuer.taxId}</p>
            <p className="whitespace-pre-line">{issuer.address}</p>
            <p>{issuer.email}</p>
          </div>
        </header>

        <section className="mt-12 grid grid-cols-2 gap-8 text-[11.5px] leading-relaxed">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9a9a9a]">Facturar a</p>
            <p className="text-[14px] font-semibold">{inv.client.legalName || inv.client.name}</p>
            {inv.client.taxId && <p>NIF/CIF {inv.client.taxId}</p>}
            <p className="whitespace-pre-line">{inv.client.address}</p>
            <p>{inv.client.email}</p>
          </div>
          <div className="text-right">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9a9a9a]">Fechas</p>
            <p>Emisión: {numericDate(inv.date)}</p>
            <p>Vencimiento: {numericDate(inv.dueDate)}</p>
          </div>
        </section>

        <table className="mt-10 w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b-2 border-[#0a0a0a] text-left text-[10px] uppercase tracking-[0.14em]">
              <th className="py-2 font-semibold">Fecha</th>
              <th className="py-2 font-semibold">Concepto</th>
              <th className="py-2 text-right font-semibold">Uds.</th>
              <th className="py-2 text-right font-semibold">Precio</th>
              <th className="py-2 text-right font-semibold">Importe</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-b border-[#e7e5e2]">
                <td className="tabular py-2.5 pr-3 text-[#5c5c5c]">{l.date ? numericDate(l.date) : ''}</td>
                <td className="py-2.5 pr-3">{l.concept}</td>
                <td className="tabular py-2.5 text-right">{l.quantity}</td>
                <td className="tabular py-2.5 text-right">{formatEUR(l.unitPrice)}</td>
                <td className="tabular py-2.5 text-right">{formatEUR(Math.round(l.quantity * l.unitPrice))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="ml-auto mt-8 w-[75mm] text-[12px]">
          <div className="flex justify-between py-1">
            <span>Base imponible</span>
            <span className="tabular">{formatEUR(inv.subtotal)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span>IVA {inv.vatRate} %</span>
            <span className="tabular">{formatEUR(inv.tax)}</span>
          </div>
          {inv.withholding > 0 && (
            <div className="flex justify-between py-1">
              <span>Retención IRPF {inv.irpfRate} %</span>
              <span className="tabular">−{formatEUR(inv.withholding)}</span>
            </div>
          )}
          <div className="mt-2 flex items-baseline justify-between border-t-2 border-[#0a0a0a] pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Total</span>
            <span className="font-display tabular text-[30px] leading-none">{formatEUR(inv.total)}</span>
          </div>
        </section>

        <footer className="mt-auto pt-12 text-[11px] leading-relaxed text-[#5c5c5c]">
          {inv.notes && <p className="whitespace-pre-line">{inv.notes}</p>}
          {issuerSettings?.iban && <p className="mt-1">IBAN: {issuerSettings.iban}</p>}
        </footer>
      </article>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <InvoicePrint />
    </Suspense>
  );
}
