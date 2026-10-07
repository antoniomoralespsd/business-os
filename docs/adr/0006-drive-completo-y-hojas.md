# 0006 — Drive completo y hojas de factura

**Estado:** aceptada · 2026-10-07 · amplía la 0005

## Contexto
Toni ordena su Drive (cuenta personal) en `AGENCIA / 00 - AÑOS / año / mes / INGRESOS|GASTOS`, `01 - FACTURAS` (hojas editables), `02 - ALBARANES`, `03 - RECTIFICATIVAS`. Quiere que la app guarde ahí, lea lo que ya hay, exporte sus hojas a PDF y numere los albaranes. Con `drive.file` la app no ve esas carpetas.

## Decisión
- El token del navegador pide el permiso **`drive`** completo (sigue siendo de 1 h, solo en la pestaña). Google muestra «app no verificada»: es una app personal.
- `settings/google.layout` guarda los ids de la carpeta AGENCIA y sus subcarpetas (detectadas por prefijo 00/01/02/03).
- Destino de lo confirmado: `00 - AÑOS/<año>/<MM MES>/INGRESOS|GASTOS` (mes de la fecha de emisión) o `<año>/Rectificativas`. Pendiente: `05 - PENDIENTE DE CLASIFICAR`; descartado: `…/Descartados`. Nunca se borra ni se manda a la papelera.
- Ingresos y archivos que ya estaban en Drive conservan su nombre; los gastos subidos se renombran `AAAA-MM-DD_PROVEEDOR_importe`.
- Exportar una hoja a PDF usa la URL de exportación de Docs (A4, ajustar al ancho, sin cuadrícula), que no admite CORS: la ruta `/api/drive/sheet-pdf` hace esa única petición con el token que envía el navegador en una cabecera. El token no se guarda ni se registra.
- La hoja manda: al exportar, la factura se registra con las cifras exactas de la hoja (número, fecha, base, IVA, IRPF, total). Si la misma factura ya estaba (por número y año), se enlaza, no se duplica.
- Albaranes en su colección `albaranes`, fuera de Facturación y de los trimestres.

## Consecuencias
- Requiere habilitar Google Drive API y Google Sheets API en el proyecto.
- Más poder en el token: por eso sigue sin salir de la pestaña salvo para la exportación puntual a PDF.
