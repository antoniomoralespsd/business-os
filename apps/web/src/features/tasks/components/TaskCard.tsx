'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { Clock3 } from 'lucide-react';
import { memo } from 'react';
import type { Client, Task } from '@bos/schemas';
import { primaryNextStatus, STATUS_BADGE } from '@bos/domain';
import { clientColor } from '@/lib/clientColors';
import { StatusIcon } from './StatusIcon';
import { TaskMenu, type TaskMenuHandlers } from './TaskMenu';

export interface TaskCardProps {
  task: Task;
  client: Client | undefined;
  onOpen: (id: string) => void;
  onPrimary: (task: Task) => void;
  menu: TaskMenuHandlers;
}

/** Compact card body. Used both in the list and in the drag overlay. */
export function TaskCardBody({ task, client, onPrimary, menu, overlay }: Omit<TaskCardProps, 'onOpen'> & { overlay?: boolean }) {
  const next = primaryNextStatus(task.status);
  const waiting = task.status === 'review';
  const done = task.status === 'completed';
  const changes = task.status === 'changes_requested';
  // Only the two states that change what I do next get a text badge; the rest read from the status icon.
  const badge = waiting || changes ? STATUS_BADGE[task.status] : '';
  const label = client?.shortName || client?.name;

  return (
    <div
      className={clsx(
        'group relative flex gap-2 rounded-[8px] border px-2 py-[7px] transition-[opacity,box-shadow,background] duration-150',
        waiting && 'hatch border-dashed border-line-strong bg-surface-3 opacity-[0.68] hover:opacity-100',
        done && 'border-line bg-surface opacity-45 hover:opacity-80',
        !waiting && !done && 'border-line bg-surface hover:border-line-strong hover:shadow-[var(--shadow-card)]',
        overlay && 'rotate-[1.5deg] border-line-strong opacity-100 shadow-[var(--shadow-pop)]',
      )}
    >
      {changes && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-changes" aria-hidden />}
      <button
        type="button"
        title={next ? `${next.label} → ${next.status === 'review' ? 'En revisión' : 'Completado'}` : 'Completada'}
        aria-label={next ? next.label : 'Completada'}
        disabled={!next}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onPrimary(task);
        }}
        className="mt-[1px] grid h-4 w-4 shrink-0 place-items-center rounded-full transition-transform hover:scale-110 disabled:hover:scale-100"
      >
        <StatusIcon status={task.status} />
      </button>
      <div className="min-w-0 flex-1">
        {label && (
          <div className="flex min-w-0 items-center gap-1.5 leading-none">
            <span className="h-[6px] w-[6px] shrink-0 rounded-[1.5px]" style={{ background: clientColor(client?.color) }} />
            <span className={clsx('eyebrow truncate text-[9.5px]', waiting || done ? 'text-ink-3' : 'text-ink-2')}>{label}</span>
          </div>
        )}
        <p
          className={clsx(
            'mt-[3px] line-clamp-2 break-words text-[12.5px] leading-[1.3]',
            done && 'text-ink-2 line-through decoration-ink-3',
            waiting && 'text-ink-2',
            !done && !waiting && 'text-ink',
            task.priority === 'high' && !done && 'font-semibold',
            !label && 'mt-0',
          )}
        >
          {task.title}
        </p>
        {badge && (
          <span
            className={clsx(
              'mt-[5px] inline-flex items-center gap-1 rounded-[3px] px-1 py-[2px] text-[8.5px] font-bold leading-none tracking-[0.1em]',
              changes && 'bg-changes/12 text-changes',
              waiting && 'bg-ink/[0.06] text-ink-2',
            )}
          >
            {waiting && <Clock3 size={9} strokeWidth={2.5} />}
            {badge}
          </span>
        )}
      </div>
      {!overlay && (
        <div className="absolute right-1 top-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <div className="rounded-[4px] bg-surface/90 backdrop-blur-sm">
            <TaskMenu task={task} h={menu} />
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCardImpl(props: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={clsx('touch-manipulation outline-none', isDragging && 'opacity-30')}
      {...attributes}
      {...listeners}
      onClick={() => props.onOpen(props.task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onOpen(props.task.id);
        listeners?.onKeyDown?.(e);
      }}
      aria-label={`${props.client?.name ? props.client.name + ': ' : ''}${props.task.title}`}
    >
      <TaskCardBody {...props} />
    </div>
  );
}

export const TaskCard = memo(TaskCardImpl);
