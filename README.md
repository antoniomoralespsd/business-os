# Business OS

Sistema interno de gestión de Iris Design: tareas, clientes, trabajos, facturación y archivos (Drive) en una sola app.

## Probar sin Firebase (demo)

```bash
pnpm install
NEXT_PUBLIC_DATA_MODE=memory pnpm dev
```

Abre http://localhost:3000. Los datos viven en memoria/localStorage del navegador.

## Poner en marcha con Firebase

1. **Crear el proyecto** en https://console.firebase.google.com con la cuenta `antoniomorales.psd@gmail.com` → "Agregar proyecto" → nombre `business-os`. Google Analytics: no hace falta.
2. **Plan Blaze**: Configuración → Uso y facturación → Blaze, con presupuesto y alerta de 10 €. Con tu volumen el coste real es ~0 €.
3. **Firestore**: Compilación → Firestore Database → Crear → modo producción → región `europe-southwest1` (Madrid; no se puede cambiar después).
4. **Authentication**: Compilación → Authentication → Comenzar → proveedor **Google** → activar.
5. **App web**: Configuración del proyecto → Tus apps → `</>` → registra "Business OS web" y copia los valores a `apps/web/.env.local` (plantilla en `apps/web/.env.example`).
6. **Cuenta de servicio (solo para desarrollo local)**: Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada → guárdala fuera del repo y apunta `GOOGLE_APPLICATION_CREDENTIALS` a ella.
7. **Reglas e índices**:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add            # elige business-os
   firebase deploy --only firestore:rules,firestore:indexes
   ```
8. **Clientes iniciales**: `pnpm seed`.
9. **Arrancar**: `pnpm dev` → entra con Google.
10. **Publicar**: Compilación → App Hosting → conectar el repo de GitHub, raíz `apps/web`. Rellena los valores de `apps/web/apphosting.yaml`.
11. **Storage (para el Inbox)**: Compilación → Storage → Comenzar → modo producción → ubicación europea. Sin esto el Inbox clasifica pero no guarda el archivo.

## Estructura

```
apps/web            Next.js (UI + API de acciones)
packages/schemas    Zod + tipos
packages/domain     Lógica pura con tests
firebase/           Reglas e índices de Firestore
```

Más detalle en `CLAUDE.md`.
