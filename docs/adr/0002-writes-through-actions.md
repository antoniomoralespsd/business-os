# 0002 — Todas las escrituras pasan por /api/actions

El cliente solo lee Firestore (listeners en tiempo real). Toda escritura es una acción registrada (Zod + sesión + membresía + transacción + activity_logs).
Permite: historial completo, deshacer, validación única y que el Command Center / la IA usen exactamente las mismas acciones.
Las reglas de Firestore niegan toda escritura desde el navegador.
