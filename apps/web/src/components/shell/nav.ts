import { Archive, CheckSquare, FileText, Repeat, Settings, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Short status shown on hover while the module is not built yet. */
  phase?: string;
  mobile?: boolean;
}

/**
 * Deliberately short. Things that used to be separate sections now live inside these:
 * - "Revisar" (alerts: unbilled work, missing invoices…) → shown inside Tareas.
 * - Inbox → "Archivar" (drop anything, it gets classified and filed).
 * - Trabajos → inside each client and in Facturación.
 * - Reglas de automatización → Ajustes.
 */
export const NAV: NavItem[] = [
  { href: '/tasks', label: 'Tareas', icon: CheckSquare, mobile: true },
  { href: '/clients', label: 'Clientes', icon: Users, phase: 'Próximo', mobile: true },
  { href: '/billing', label: 'Facturación', icon: FileText, phase: 'Pronto', mobile: true },
  { href: '/subscriptions', label: 'Suscripciones', icon: Repeat, phase: 'Pronto' },
  { href: '/archive', label: 'Archivar', icon: Archive, phase: 'Pronto', mobile: true },
  { href: '/settings', label: 'Ajustes', icon: Settings, phase: 'Pronto' },
];
