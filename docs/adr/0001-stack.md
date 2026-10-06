# 0001 — Stack y hosting

Decisión: Next.js 15 + Firebase (Auth, Firestore, Functions, Secret Manager) en un único proyecto GCP, desplegado con Firebase App Hosting.
Motivo: una sola facturación e identidad de servicio; Drive/Gmail viven en Google; sin secretos cruzados entre proveedores.
Descartado: Vercel (segundo proveedor sin ventaja), Firebase Storage como almacén principal (los archivos viven en Drive).
