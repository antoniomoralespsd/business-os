import { Archive, CheckSquare, FileText, Inbox, Repeat, Settings, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  mobile?: boolean;
}

/**
 * Deliberately short. What used to be separate sections lives inside these:
 * - Revisar (alerts: unbilled work, invoices to send, renewals…) → strip at the top of Tareas.
 * - Trabajos → inside each client and in Facturación.
 * - Reglas de clasificación → applied automatically in Inbox.
 */
export const NAV: NavItem[] = [
  { href: '/tasks', label: 'Tareas', icon: CheckSquare, mobile: true },
  { href: '/clients', label: 'Clientes', icon: Users, mobile: true },
  { href: '/billing', label: 'Facturación', icon: FileText, mobile: true },
  { href: '/subscriptions', label: 'Suscripciones', icon: Repeat },
  { href: '/inbox', label: 'Inbox', icon: Inbox, mobile: true },
  { href: '/archive', label: 'Archivo', icon: Archive },
  { href: '/settings', label: 'Ajustes', icon: Settings, mobile: true },
];
