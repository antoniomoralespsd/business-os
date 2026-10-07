import { ComingSoon } from '@/components/shell/ComingSoon';

export default function Page() {
  return (
    <ComingSoon href="/archive">
      Arrastra aquí cualquier archivo (facturas, tickets, flyers, PDFs, fotos del móvil). La app detecta qué es, de qué cliente o
      proveedor, si es un gasto o un ingreso, y te propone dónde guardarlo en Drive y con qué nombre. Confirmas y lo archiva.
    </ComingSoon>
  );
}
