'use client';
import { CheckSquare, FileText, KeyRound, LayoutGrid, Link2, NotebookPen, Receipt, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Client } from '@bos/schemas';
import { DetailsModule } from './DetailsModule';
import { InvoicesModule, JobsModule } from './BillingModules';
import { LinksModule } from './LinksModule';
import { NotesModule } from './NotesModule';
import { OverviewModule } from './OverviewModule';
import { TasksModule } from './TasksModule';
import { VaultModule } from './VaultModule';

export interface ClientModuleProps {
  client: Client;
  /** Navigate to another module of the same client. */
  goTo: (moduleId: string) => void;
}

/**
 * Each client folder is a small system made of modules. To create a module only one client
 * needs (e.g. "Salas y eventos" for City Hall), add it here with `scope: [clientId]`;
 * it then appears in "Añadir módulo" for that client only.
 */
export interface ClientModuleDef {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  Component: ComponentType<ClientModuleProps>;
  /** Cannot be removed (the folder needs it). */
  core?: boolean;
  /** Only offered to these clients. */
  scope?: string[];
}

export const CLIENT_MODULES: ClientModuleDef[] = [
  { id: 'overview', label: 'Resumen', description: 'Lo importante del cliente de un vistazo', icon: LayoutGrid, Component: OverviewModule, core: true },
  { id: 'tasks', label: 'Tareas', description: 'Sus tareas pendientes, en revisión y hechas', icon: CheckSquare, Component: TasksModule },
  { id: 'jobs', label: 'Trabajos', description: 'Trabajos hechos y pendientes de facturar', icon: Receipt, Component: JobsModule },
  { id: 'invoices', label: 'Facturas', description: 'Facturas emitidas y cobros', icon: FileText, Component: InvoicesModule },
  { id: 'links', label: 'Enlaces', description: 'Carpetas de Drive, Dropbox, WeTransfer, redes…', icon: Link2, Component: LinksModule },
  { id: 'vault', label: 'Accesos', description: 'Usuarios y contraseñas cifrados', icon: KeyRound, Component: VaultModule },
  { id: 'notes', label: 'Notas', description: 'Instrucciones, formatos, contactos, briefing', icon: NotebookPen, Component: NotesModule },
  { id: 'details', label: 'Datos y tarifas', description: 'Datos fiscales, tarifas, IVA, IRPF, módulos', icon: SlidersHorizontal, Component: DetailsModule, core: true },
];

export const moduleById = (id: string) => CLIENT_MODULES.find((m) => m.id === id);

export function modulesFor(client: Client): ClientModuleDef[] {
  const enabled = client.modules.map(moduleById).filter((m): m is ClientModuleDef => !!m);
  for (const core of CLIENT_MODULES.filter((m) => m.core)) if (!enabled.includes(core)) enabled.push(core);
  return enabled;
}

export function availableToAdd(client: Client): ClientModuleDef[] {
  return CLIENT_MODULES.filter((m) => !client.modules.includes(m.id) && !m.core && (!m.scope || m.scope.includes(client.id)));
}
