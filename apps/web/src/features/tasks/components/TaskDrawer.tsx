'use client';
import * as Dialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { Archive, CalendarOff, Check, Send, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActivityLog, Client, ISODate, Task, TaskPriority, TaskStatus } from '@bos/schemas';
import { TASK_STATUSES } from '@bos/schemas';
import { addDays, daysBetween, formatLongDay, STATUS_LABEL, todayISO } from '@bos/domain';
import { clientColor } from '@/lib/clientColors';
import { StatusIcon } from './StatusIcon';
import { JobLink } from './JobLink';

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Baja' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
];

export interface TaskDrawerProps {
  task: Task | null;
  clients: Client[];
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Pick<Task, 'title' | 'clientId' | 'description' | 'priority'>>) => void;
  onStatus: (id: string, s: TaskStatus) => void;
  onMove: (id: string, dueDate: ISODate | null) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  loadHistory: (id: string) => Promise<ActivityLog[]>;
}

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso));

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-start gap-3 py-2">
      <span className="eyebrow pt-[7px] text-ink-3">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function TaskDrawer({ task, clients, onClose, onUpdate, onStatus, onMove, onArchive, onDelete, loadHistory }: TaskDrawerProps) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<ActivityLog[] | null>(null);
  const id = task?.id;

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setNotes(task.description);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id || id.startsWith('tmp-')) return setHistory([]);
    let alive = true;
    setHistory(null);
    loadHistory(id).then((h) => alive && setHistory(h)).catch(() => alive && setHistory([]));
    return () => {
      alive = false;
    };
  }, [id, task?.status, task?.dueDate, loadHistory]);

  const commitTitle = () => task && title.trim() && title.trim() !== task.title && onUpdate(task.id, { title: title.trim() });
  const commitNotes = () => task && notes !== task.description && onUpdate(task.id, { description: notes });

  const waitingDays = task?.status === 'review' && task.reviewStartedAt ? daysBetween(task.reviewStartedAt.slice(0, 10), todayISO()) : null;

  return (
    <Dialog.Root open={task !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/10" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-line bg-surface shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-[slideIn_180ms_var(--ease)]"
        >
          {task && (
            <>
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div className="flex items-center gap-2">
                  <StatusIcon status={task.status} />
                  <span className="eyebrow text-ink-2">{STATUS_LABEL[task.status]}</span>
                  {waitingDays !== null && waitingDays > 0 && (
                    <span className="text-[11.5px] text-ink-3">· esperando {waitingDays} {waitingDays === 1 ? 'día' : 'días'}</span>
                  )}
                </div>
                <Dialog.Close className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-2 hover:bg-surface-3" aria-label="Cerrar">
                  <X size={16} />
                </Dialog.Close>
              </div>

              <div className="scroll-thin flex-1 overflow-y-auto px-5 pb-6">
                <Dialog.Title asChild>
                  <textarea
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.target as HTMLTextAreaElement).blur();
                      }
                    }}
                    rows={2}
                    className="font-display mt-4 w-full resize-none bg-transparent text-[32px] leading-[1.05] outline-none"
                    aria-label="Título"
                  />
                </Dialog.Title>

                {/* One-click primary actions */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {task.status !== 'review' && task.status !== 'completed' && (
                    <button type="button" onClick={() => onStatus(task.id, 'review')} className="btn-primary inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-semibold">
                      <Send size={14} /> Enviado · en revisión
                    </button>
                  )}
                  {task.status === 'review' && (
                    <>
                      <button type="button" onClick={() => onStatus(task.id, 'completed')} className="btn-primary inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-semibold">
                        <Check size={14} /> Aprobado
                      </button>
                      <button
                        type="button"
                        onClick={() => onStatus(task.id, 'changes_requested')}
                        className="inline-flex items-center gap-2 rounded-[4px] border border-changes/40 px-3.5 py-2 text-[13px] font-semibold text-changes hover:bg-changes/5"
                      >
                        Piden cambios
                      </button>
                    </>
                  )}
                  {task.status === 'completed' && (
                    <button type="button" onClick={() => onStatus(task.id, 'pending')} className="rounded-[4px] border border-line px-3.5 py-2 text-[13px] font-semibold hover:bg-surface-3">
                      Reabrir
                    </button>
                  )}
                </div>

                {task.clientId && !task.id.startsWith('tmp-') && <JobLink task={task} client={clients.find((c) => c.id === task.clientId)} />}

                <div className="mt-5 divide-y divide-line border-y border-line">
                  <Field label="Estado">
                    <div className="flex flex-wrap gap-1">
                      {TASK_STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => onStatus(task.id, s)}
                          className={clsx(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]',
                            task.status === s ? 'border-ink bg-ink text-on-ink' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                          )}
                        >
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Cliente">
                    <div className="flex items-center gap-2">
                      {task.clientId && (
                        <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: clientColor(clients.find((c) => c.id === task.clientId)?.color) }} />
                      )}
                      <select
                        value={task.clientId ?? ''}
                        onChange={(e) => onUpdate(task.id, { clientId: e.target.value || null })}
                        className="w-full rounded-[4px] border border-line bg-surface-2 px-2 py-1.5 text-[13px] outline-none focus:border-ink"
                      >
                        <option value="">Sin cliente</option>
                        {clients
                          .filter((c) => c.status !== 'archived')
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  </Field>
                  <Field label="Fecha">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        value={task.dueDate ?? ''}
                        onChange={(e) => onMove(task.id, e.target.value || null)}
                        className="rounded-[4px] border border-line bg-surface-2 px-2 py-1.5 text-[13px] outline-none focus:border-ink"
                      />
                      <button type="button" onClick={() => onMove(task.id, todayISO())} className="rounded-[4px] px-2 py-1 text-[12px] text-ink-2 hover:bg-surface-3">
                        Hoy
                      </button>
                      <button type="button" onClick={() => onMove(task.id, addDays(todayISO(), 1))} className="rounded-[4px] px-2 py-1 text-[12px] text-ink-2 hover:bg-surface-3">
                        Mañana
                      </button>
                      {task.dueDate && (
                        <button type="button" onClick={() => onMove(task.id, null)} className="inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-[12px] text-ink-2 hover:bg-surface-3">
                          <CalendarOff size={12} /> Sin fecha
                        </button>
                      )}
                    </div>
                    {task.dueDate && <p className="mt-1 text-[11.5px] text-ink-3">{formatLongDay(task.dueDate)}</p>}
                  </Field>
                  <Field label="Prioridad">
                    <div className="inline-flex rounded-[6px] border border-line p-0.5">
                      {PRIORITIES.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => onUpdate(task.id, { priority: p.value })}
                          className={clsx('rounded-[4px] px-3 py-1 text-[12px]', task.priority === p.value ? 'bg-ink text-on-ink' : 'text-ink-2 hover:text-ink')}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>

                <div className="mt-5">
                  <span className="eyebrow text-ink-3">Notas</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={commitNotes}
                    rows={6}
                    placeholder="Cambiar foto de artista cuando la envíen…"
                    className="mt-2 w-full resize-y rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-ink"
                  />
                </div>

                <div className="mt-5">
                  <span className="eyebrow text-ink-3">Historial</span>
                  <ol className="mt-2 space-y-1.5">
                    {history === null && <li className="text-[12px] text-ink-3">Cargando…</li>}
                    {history?.length === 0 && <li className="text-[12px] text-ink-3">Sin cambios registrados todavía.</li>}
                    {history?.map((h) => (
                      <li key={h.id} className="flex gap-3 text-[12.5px]">
                        <span className="tabular w-[92px] shrink-0 text-ink-3">{fmtTime(h.at)}</span>
                        <span className="text-ink-2">{h.summary}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-line px-5 py-3">
                <button type="button" onClick={() => onArchive(task.id)} className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[12.5px] text-ink-2 hover:bg-surface-3">
                  <Archive size={14} /> Archivar
                </button>
                <button type="button" onClick={() => onDelete(task.id)} className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[12.5px] text-danger hover:bg-danger/5">
                  <Trash2 size={14} /> Eliminar
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
