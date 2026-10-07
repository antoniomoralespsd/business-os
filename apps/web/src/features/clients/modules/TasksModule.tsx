'use client';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Task } from '@bos/schemas';
import { bucketOf, orderAtEnd, primaryNextStatus, STATUS_LABEL, todayISO } from '@bos/domain';
import { Badge, Button, Card, Input, Loading, Segmented } from '@/components/ui/kit';
import { StatusIcon } from '@/features/tasks/components/StatusIcon';
import { act, useTasksAll } from '@/data/hooks';
import { shortDate } from '@/lib/format';
import type { ClientModuleProps } from './registry';

type View = 'open' | 'waiting' | 'done';

export function TasksModule({ client }: ClientModuleProps) {
  const { data } = useTasksAll([{ field: 'clientId', op: '==', value: client.id }]);
  const [view, setView] = useState<View>('open');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());

  const groups = useMemo(() => {
    const t = (data ?? []).filter((x) => !x.archived);
    const by = (b: string) => t.filter((x) => bucketOf(x.status) === b);
    const sort = (l: Task[]) => l.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.order - b.order);
    return { open: sort(by('action')), waiting: sort(by('waiting')), done: by('done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, 40) };
  }, [data]);

  const add = async () => {
    if (!title.trim()) return;
    const siblings = (data ?? []).filter((t) => t.dueDate === date);
    const r = await act('task.create', { title: title.trim(), clientId: client.id, dueDate: date || null, order: orderAtEnd(siblings) });
    if (r) setTitle('');
  };

  if (!data) return <Loading />;
  const list = groups[view];
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Nueva tarea para ${client.name}…`} className="min-w-[220px] flex-1" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" aria-label="Fecha" />
        <Button type="submit" variant="primary" icon={<Plus size={14} />} disabled={!title.trim()}>
          Añadir
        </Button>
      </form>
      <Segmented<View>
        value={view}
        onChange={setView}
        options={[
          { value: 'open', label: `Por hacer · ${groups.open.length}` },
          { value: 'waiting', label: `En revisión · ${groups.waiting.length}` },
          { value: 'done', label: 'Hechas' },
        ]}
      />
      <Card>
        {list.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-ink-3">Nada por aquí.</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((t) => {
              const next = primaryNextStatus(t.status);
              return (
                <li key={t.id} className={clsx('flex items-center gap-3 px-4 py-2.5', t.status === 'review' && 'hatch', t.status === 'completed' && 'opacity-55')}>
                  <button type="button" title={next?.label} disabled={!next} onClick={() => next && act('task.status', { id: t.id, status: next.status })}>
                    <StatusIcon status={t.status} />
                  </button>
                  <span className="tabular w-14 shrink-0 text-[12px] text-ink-3">{t.dueDate ? shortDate(t.dueDate) : 'Sin fecha'}</span>
                  <span className={clsx('min-w-0 flex-1 truncate text-[13px]', t.status === 'completed' && 'line-through')}>{t.title}</span>
                  {t.status === 'changes_requested' && <Badge tone="changes">Cambios</Badge>}
                  {t.status === 'in_progress' && <Badge tone="info">{STATUS_LABEL.in_progress}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
