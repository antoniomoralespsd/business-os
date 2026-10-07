import { ComingSoon } from '@/components/shell/ComingSoon';

export default function Page() {
  return (
    <ComingSoon href="/billing">
      Ingresos y gastos ordenados por mes y trimestre. Cada factura o ticket que subas se reconoce como gasto o ingreso y va a su
      sitio. Te avisa de lo que falta: trabajos sin facturar, cobros sin factura, facturas sin enviar. Exportación trimestral
      para la gestoría.
    </ComingSoon>
  );
}
