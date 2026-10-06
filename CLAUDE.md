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
- Ningún secreto en el cliente ni en el repo. Tokens OAuth → Secret Manager.
- Diseño: tokens en `apps/web/src/app/globals.css`. Rogie solo para títulos grandes y cifras; Figtree para todo lo demás. El degradado iris es acento, nunca relleno de tarjetas.
- **No construir módulos no aprobados.** Los módulos pendientes muestran `ComingSoon`.

## Estado

- Fase 0: hecho (shell, sesión, acciones, activity log, reglas, índices).
- Tareas: hecho (calendario semanal, drag & drop, estados, drawer, sin fecha, filtros, móvil).
- Siguiente: conectar proyecto Firebase real → Clientes → Google Drive (multi-cuenta) → Inbox.
