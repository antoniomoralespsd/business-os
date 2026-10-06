'use client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Archive, CalendarArrowUp, CalendarClock, CalendarOff, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Task, TaskStatus } from '@bos/schemas';
import { QUICK_STATUS_ACTIONS } from '@bos/domain';
import { StatusIcon } from './StatusIcon';

export interface TaskMenuHandlers {
  onMoveToday: () => void;
  onMoveTomorrow: () => void;
  onUnschedule: () => void;
  onStatus: (s: TaskStatus) => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

const item =
  'flex cursor-default select-none items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-surface-3';

function Item({ children, onSelect, danger }: { children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <DropdownMenu.Item className={`${item} ${danger ? 'text-danger' : 'text-ink'}`} onSelect={onSelect}>
      {children}
    </DropdownMenu.Item>
  );
}

export function TaskMenu({ task, h, trigger }: { task: Task; h: TaskMenuHandlers; trigger?: ReactNode }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label="Acciones de la tarea"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="grid h-5 w-5 place-items-center rounded-[4px] text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
          className="z-50 min-w-[210px] rounded-[10px] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          <Item onSelect={h.onMoveToday}>
            <CalendarArrowUp size={14} /> Mover a hoy
          </Item>
          <Item onSelect={h.onMoveTomorrow}>
            <CalendarClock size={14} /> Mover a mañana
          </Item>
          {task.dueDate !== null && (
            <Item onSelect={h.onUnschedule}>
              <CalendarOff size={14} /> Quitar fecha
            </Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          {QUICK_STATUS_ACTIONS.filter((a) => a.status !== task.status).map((a) => (
            <Item key={a.status} onSelect={() => h.onStatus(a.status)}>
              <StatusIcon status={a.status} size={13} /> {a.label}
            </Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <Item onSelect={h.onEdit}>
            <Pencil size={14} /> Editar
          </Item>
          <Item onSelect={h.onArchive}>
            <Archive size={14} /> Archivar
          </Item>
          <Item onSelect={h.onDelete} danger>
            <Trash2 size={14} /> Eliminar…
          </Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
