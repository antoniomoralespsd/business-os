'use client';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { ID } from '@bos/schemas';

export function DroppableList({ id, items, children, className }: { id: string; items: ID[]; children: ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className={clsx('flex flex-col gap-[5px] rounded-[8px] transition-colors', isOver && 'bg-ink/[0.025]', className)}>
        {children}
      </div>
    </SortableContext>
  );
}

export function DayHeader({ weekday, day, isToday, count }: { weekday: string; day: number; isToday: boolean; count: number }) {
  return (
    <div className="flex items-end justify-between px-1.5 pb-2 pt-3">
      <div className="flex items-baseline gap-2">
        <span className={clsx('eyebrow', isToday ? 'text-ink' : 'text-ink-3')}>{weekday}</span>
        <span className={clsx('font-display text-[26px] leading-none', isToday ? 'text-ink' : 'text-ink-2')}>{day}</span>
      </div>
      {count > 0 && <span className="tabular mb-0.5 text-[11px] text-ink-3">{count}</span>}
      {isToday && <span className="iris-bar-x absolute inset-x-1.5 top-0 h-[3px] rounded-b" aria-hidden />}
    </div>
  );
}
