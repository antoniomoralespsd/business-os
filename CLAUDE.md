# Business OS — guía para Claude Code

Sistema interno de Iris Design (Toni). Documento de arquitectura completo: ver el doc "Business OS — Documento de arquitectura" (secciones A–T). Este archivo resume las reglas que no se pueden saltar.

## Comandos

```bash
pnpm install
pnpm dev                 # Next.js en http://localhost:3000 (usa apps/web/.env.local)
pnpm test                # Vitest: dominio + contratos
pnpm typecheck
pnpm build               # build de producción
pnpm build:demo          # demo estática con datos en memoria → apps/web/out
pnpm seed                # carga clientes iniciales (ver apps/web/scripts/seed.ts)
firebase emulators:start # Auth + Firestore locales (requiere firebase-tools y Java)
firebase deploy --only firestore:rules,firestore:indexes
```

## Capas (solo se habla hacia abajo)

1. `apps/web/src/app`, `features/*/components` — UI. Lee Firestore en tiempo real vía gateways.
2. `apps/web/src/server/actions` — **única puerta de escritura**. Cada acción: Zod → sesión → membresía → transacción → `activity_logs`.
3. `packages/domain` — lógica pura (fechas, estados, orden, parsing). Sin I/O, sin Firebase. Todo con tests.
4. `packages/schemas` — Zod + tipos. Fuente única de tipos.
5. Gateways (`features/*/gateway`) — puerto + implementación Firestore + implementación en memoria (tests y demo).

## Reglas

- TypeScript estricto. Nada de `any`.
- El navegador **nunca escribe** en Firestore. Las reglas lo impiden (`allow write: if false`). Toda escritura = acción registrada en `server/actions/index.ts` y llamada con `callAction()`.
- Fechas de negocio = `ISODate` string `'YYYY-MM-DD'` en Europe/Madrid. Instantes = Timestamp en Firestore / ISO string fuera.
- Dinero en céntimos enteros.
- Todo doc cuelga de `workspaces/{workspaceId}/…`.
- Archivos de servidor que no deben entrar en la demo estática usan la extensión `.server.ts` (`route.server.ts`, `middleware.server.ts`).
- Ningún secreto en el cliente ni en el repo. Tokens OAuth de servidor → Secret Manager. Excepción: Drive usa tokens de 1 h solo en el navegador (ADR 0005/0006); la app nunca borra archivos de Drive.
- Diseño: tokens en `apps/web/src/app/globals.css`. Rogie solo para títulos grandes y cifras; Figtree para todo lo demás. El degradado iris es acento, nunca relleno de tarjetas.
- **No construir módulos no aprobados.** Los módulos pendientes muestran `ComingSoon`.

## Estado

- Fase 0: hecho (shell, sesión, acciones, activity log, reglas, índices). Firebase real `bussiness-os` conectado; App Hosting despliega en cada push a `main`.
- Tareas: hecho (calendario semanal, drag & drop, estados, drawer, sin fecha, filtros, móvil, franja "Revisar", registrar como trabajo facturable).
- Clientes: hecho (carpeta por cliente con módulos: resumen, tareas, trabajos, facturas, enlaces, caja fuerte cifrada en el navegador, notas, datos y tarifas).
- Facturación, Suscripciones, Inbox (clasificación gasto/ingreso por reglas), Archivo, Ajustes, modo oscuro: hecho.
- Migraciones puntuales: acción `system.migrate`, registradas en `migrations/{id}`.
- Inbox: sube carpetas enteras (pistas por carpeta: mes, Gastos/Ingresos/Rectificativas), agrupa ingresos por cliente, crea/aprende clientes por NIF, confirma en bloque y guarda en Google Drive (ADR 0005).
- Drive con la carpeta AGENCIA (00 - AÑOS…): importar desde Drive, exportar hojas de 01 - FACTURAS a PDF y registrarlas, duplicar para el mes siguiente (ADR 0006).
- Albaranes: sección propia, numeración por fecha y renombrado en Drive, cobrado/pendiente; fuera de los trimestres.
- Tareas: vista Semana / Mes.
- Pendiente: Gmail, automatizaciones nocturnas (requieren OAuth de servidor).
