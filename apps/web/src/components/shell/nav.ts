import {
  Bot,
  Briefcase,
  CheckSquare,
  FileText,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  Repeat,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Phase in which the module ships. undefined = available now. */
  phase?: string;
  mobile?: boolean;
}

export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, phase: 'Fase 1', mobile: true },
  { href: '/inbox', label: 'Inbox', icon: Inbox, phase: 'Fase 1', mobile: true },
  { href: '/tasks', label: 'Tareas', icon: CheckSquare, mobile: true },
  { href: '/clients', label: 'Clientes', icon: Users, phase: 'Fase 1', mobile: true },
  { href: '/jobs', label: 'Trabajos', icon: Briefcase, phase: 'Fase 1' },
  { href: '/billing', label: 'Facturación', icon: FileText, phase: 'Fase 2' },
  { href: '/subscriptions', label: 'Suscripciones', icon: Repeat, phase: 'Fase 2' },
  { href: '/files', label: 'Archivos', icon: FolderOpen, phase: 'Fase 1' },
  { href: '/automations', label: 'Automatizaciones', icon: Bot, phase: 'Fase 3' },
  { href: '/review', label: 'Revisar', icon: ShieldCheck, phase: 'Fase 2' },
  { href: '/settings', label: 'Ajustes', icon: Settings, phase: 'Fase 1' },
];
