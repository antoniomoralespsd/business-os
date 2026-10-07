# 0005 — Google Drive desde el navegador con `drive.file`

**Estado:** aceptada · 2026-10-07

## Contexto
Toni quiere que todo lo que sube al Inbox (facturas, tickets) acabe en su Google Drive, ordenado. Tiene tres cuentas de Google. Guardar tokens de actualización en el servidor exige un cliente OAuth propio, su secreto en Secret Manager y permisos extra para la cuenta de servicio de App Hosting.

## Decisión
- El navegador pide un **token de acceso de 1 hora** con el permiso `drive.file` mediante un popup de Google sobre una **instancia secundaria de Firebase Auth en memoria** (no toca la sesión de la app ni crea secretos nuevos: usa el cliente OAuth que Firebase ya tiene).
- El token solo vive en la pestaña (memoria + `sessionStorage`). Nunca llega a Firestore ni al servidor.
- `drive.file` solo ve los archivos y carpetas que crea la app: no puede leer ni tocar el resto del Drive.
- Firestore guarda solo la referencia (`inbox.drive`: cuenta, id, carpeta, enlace) mediante la acción `inbox.attachDrive`, y las cuentas conectadas en `settings/google` (sin tokens).
- Estructura: `Business OS/Inbox` al subir; al confirmar se mueve y renombra a `Business OS/Facturación/AAAA/MM MES/Ingresos|Gastos`, `…/AAAA/Rectificativas` o `Business OS/Documentos/AAAA`; lo descartado va a `Business OS/Descartados` (nunca se borra).

## Consecuencias
- Sin automatizaciones en segundo plano sobre Drive (requieren token de servidor). Cuando haga falta (por ejemplo, ordenar el Drive antiguo o leer Gmail de noche), se añadirá OAuth de servidor con el refresh token en Secret Manager, como dice la regla general.
- Cada hora Google pide reconectar con un clic.
- Requiere la API de Google Drive habilitada en el proyecto `bussiness-os`.
