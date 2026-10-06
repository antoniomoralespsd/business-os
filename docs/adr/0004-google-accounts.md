# 0004 — Varias cuentas de Google con roles

Toni usa tres cuentas. Se modelan como `google_accounts` con roles (login, drive_billing, drive_storage, gmail_invoices).
Toda referencia a Drive guarda `accountId`. Facturas y documentos fiscales solo en la cuenta de negocio (antoniomorales.psd); el almacén pesado (ESDI) solo para material de trabajo replicable.
