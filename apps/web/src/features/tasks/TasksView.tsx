'use client';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Inbox, PanelRightClose, PanelRightOpen, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ID, ISODate, Task } from '@bos/schemas';
import {
  addDays,
  bucketCounts,
  dayOfMonth,
  DEFAULT_FILTER,
  formatLongDay,
  formatWeekRange,
  groupByDay,
  matchesFilter,
  orderAtEnd,
  orderBetween,
  parseQuickAdd,
  primaryNextStatus,
  STATUS_LABEL,
  todayISO,
  weekDays,
  weekdayIndex,
  WEEKDAY_SHORT,
  type TaskFilter,
} from '@bos/domain';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { usePersistentState } from '@/lib/usePersistentState';
import { DayHeader, DroppableList } from './components/DayColumn';
import { QuickAdd } from './components/QuickAdd';
import { TaskCard, TaskCardBody } from './components/TaskCard';
import { TaskDrawer } from './components/TaskDrawer';
import { ReviewStrip } from './components/ReviewStrip';
import type { TaskMenuHandlers } from './components/TaskMenu';
import { useTasksBoard } from './useTasksBoard';

const NONE = 'day:none';
const containerOf = (d: ISODate | null) => (d ? `day:${d}` : NONE);
const dateOf = (container: string): ISODate | null => (container === NONE ? null : container.slice(4));

/** Pointer-first collision so empty columns accept drops; falls back to closest center (keyboard). */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length > 0) {
    // Prefer a task under the pointer over its column.
    const task = hits.find((h) => !String(h.id).startsWith('day:'));
    return task ? [task] : hits;
  }
  return closestCenter(args);
};

/** Rendered only on the client: the board depends on "today" in Europe/Madrid and live data. */
export function TasksView() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted) return <div className="h-full" aria-busy="true" />;
  return <TasksBoardView />;
}

function TasksBoardView() {
  const today = todayISO();
  const [anchor, setAnchor] = useState<ISODate>(today);
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [mobileDay, setMobileDay] = useState<ISODate>(today);
  const [showWeekend, setShowWeekend] = usePersistentState('bos.tasks.weekend', true);
  const [showUndated, setShowUndated] = usePersistentState('bos.tasks.undated', true);
  const [filter, setFilter] = usePersistentState<TaskFilter>('bos.tasks.filter', DEFAULT_FILTER);
  const [openId, setOpenId] = useState<ID | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ID | null>(null);

  const days = useMemo(() => weekDays(anchor), [anchor]);
  const range = useMemo(() => ({ from: days[0]!, to: days[6]! }), [days]);
  const board = useTasksBoard(range);
  const { tasks, clients, clientsById, actions } = board;

  const visibleDays = showWeekend ? days : days.slice(0, 5);
  const visible = useMemo(() => (tasks ?? []).filter((t) => matchesFilter(t, filter, clientsById)), [tasks, filter, clientsById]);
  const grouped = useMemo(() => groupByDay(visible), [visible]);
  const allGrouped = useMemo(() => groupByDay(tasks ?? []), [tasks]);
  const counts = useMemo(() => bucketCounts(tasks ?? [], today), [tasks, today]);

  /* ---------- drag & drop ---------- */
  const [drag, setDrag] = useState<{ activeId: ID; containers: Record<string, ID[]> } | null>(null);

  const baseContainers = useMemo(() => {
    const c: Record<string, ID[]> = { [NONE]: (grouped.get('none') ?? []).map((t) => t.id) };
    for (const d of days) c[containerOf(d)] = (grouped.get(d) ?? []).map((t) => t.id);
    return c;
  }, [grouped, days]);
  const containers = drag?.containers ?? baseContainers;
  const taskById = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = useCallback(
    (id: string, cs: Record<string, ID[]>) => (id in cs ? id : Object.keys(cs).find((k) => cs[k]!.includes(id))),
    [],
  );

  const onDragStart = (e: DragStartEvent) => setDrag({ activeId: String(e.active.id), containers: baseContainers });

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !drag) return;
    const from = findContainer(String(active.id), drag.containers);
    const to = findContainer(String(over.id), drag.containers);
    if (!from || !to || from === to) return;
    setDrag((d) => {
      if (!d) return d;
      const src = d.containers[from]!.filter((x) => x !== active.id);
      const dst = [...d.containers[to]!];
      const overIdx = dst.indexOf(String(over.id));
      dst.splice(overIdx >= 0 ? overIdx : dst.length, 0, String(active.id));
      return { ...d, containers: { ...d.containers, [from]: src, [to]: dst } };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const d = drag;
    setDrag(null);
    if (!d || !over) return;
    const id = String(active.id);
    const container = findContainer(id, d.containers);
    if (!container) return;
    let list = d.containers[container]!;
    const overIdx = list.indexOf(String(over.id));
    const curIdx = list.indexOf(id);
    if (overIdx >= 0 && overIdx !== curIdx) list = arrayMove(list, curIdx, overIdx);
    const index = list.indexOf(id);
    const dueDate = dateOf(container);
    // New order = between the visible neighbours it was dropped between.
    const prev = index > 0 ? taskById.get(list[index - 1]!) : undefined;
    const next = index < list.length - 1 ? taskById.get(list[index + 1]!) : undefined;
    const order = orderBetween(prev?.order ?? null, next?.order ?? null);
    const task = taskById.get(id);
    if (!task || (task.dueDate === dueDate && task.order === order)) return;
    void actions.move(id, dueDate, order);
  };

  /* ---------- task actions ---------- */
  const moveTo = useCallback(
    (id: ID, dueDate: ISODate | null) => {
      const siblings = (allGrouped.get(dueDate ?? 'none') ?? []).filter((t) => t.id !== id);
      void actions.move(id, dueDate, orderAtEnd(siblings));
      if (dueDate && (dueDate < range.from || dueDate > range.to) && !isMobile) setAnchor(dueDate);
    },
    [actions, allGrouped, range, isMobile],
  );

  const menuFor = useCallback(
    (t: Task): TaskMenuHandlers => ({
      onMoveToday: () => moveTo(t.id, today),
      onMoveTomorrow: () => moveTo(t.id, addDays(today, 1)),
      onUnschedule: () => moveTo(t.id, null),
      onStatus: (s) => void actions.setStatus(t.id, s),
      onEdit: () => setOpenId(t.id),
      onArchive: () => void actions.archive(t.id),
      onDelete: () => setConfirmDelete(t.id),
    }),
    [actions, moveTo, today],
  );

  const onPrimary = useCallback((t: Task) => {
    const next = primaryNextStatus(t.status);
    if (next) void actions.setStatus(t.id, next.status);
  }, [actions]);

  const create = useCallback(
    (dueDate: ISODate | null, text: string) => {
      const { title, clientId } = parseQuickAdd(text, clients);
      const siblings = allGrouped.get(dueDate ?? 'none') ?? [];
      void actions.create({ title, clientId, dueDate, order: orderAtEnd(siblings), status: 'pending', priority: 'normal', description: '' });
    },
    [actions, allGrouped, clients],
  );

  /* ---------- keyboard: ← → weeks, T today ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]')) return;
      if (e.key === 'ArrowLeft') setAnchor((a) => addDays(a, -7));
      if (e.key === 'ArrowRight') setAnchor((a) => addDays(a, 7));
      if (e.key.toLowerCase() === 't') setAnchor(todayISO());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (isMobile && (mobileDay < range.from || mobileDay > range.to)) setAnchor(mobileDay);
  }, [isMobile, mobileDay, range]);

  const openTask = openId ? taskById.get(openId) ?? null : null;
  const activeTask = drag ? taskById.get(drag.activeId) : undefined;
  const loading = tasks === null;

  const renderList = (container: string) =>
    (containers[container] ?? []).map((id) => {
      const t = taskById.get(id);
      if (!t) return null;
      return <TaskCard key={id} task={t} client={t.clientId ? clientsById.get(t.clientId) : undefined} onOpen={setOpenId} onPrimary={onPrimary} menu={menuFor(t)} />;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---------- Header ---------- */}
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 px-4 pt-5 md:px-8 md:pt-7">
        <div>
          <p className="eyebrow text-ink-3">Business OS</p>
          <h1 className="font-display text-[44px] leading-[0.95] md:text-[56px]">Tareas</h1>
        </div>
        <div className="flex items-stretch gap-2" aria-live="polite">
          <Counter label="Requieren mi atención" value={counts.action} strong onClick={() => setFilter({ ...filter, status: filter.status === 'bucket:action' ? 'all' : 'bucket:action' })} active={filter.status === 'bucket:action'} />
          <Counter label="Esperando aprobación" value={counts.waiting} onClick={() => setFilter({ ...filter, status: filter.status === 'bucket:waiting' ? 'all' : 'bucket:waiting' })} active={filter.status === 'bucket:waiting'} />
          <Counter label="Hechas hoy" value={counts.done} muted />
        </div>
      </header>

      {/* ---------- Toolbar ---------- */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-line px-4 pb-3 md:px-8">
        <div className="flex items-center gap-1">
          <IconBtn label="Semana anterior" onClick={() => (isMobile ? setMobileDay((d) => addDays(d, -1)) : setAnchor((a) => addDays(a, -7)))}>
            <ChevronLeft size={16} />
          </IconBtn>
          <button
            type="button"
            onClick={() => {
              setAnchor(today);
              setMobileDay(today);
            }}
            className="rounded-[4px] border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold tracking-[0.08em] hover:border-ink"
          >
            HOY
          </button>
          <IconBtn label="Semana siguiente" onClick={() => (isMobile ? setMobileDay((d) => addDays(d, 1)) : setAnchor((a) => addDays(a, 7)))}>
            <ChevronRight size={16} />
          </IconBtn>
        </div>
        <label className="relative ml-1 cursor-pointer">
          <span className="text-[14px] font-semibold first-letter:uppercase">{isMobile ? formatLongDay(mobileDay) : formatWeekRange(days)}</span>
          <input
            type="date"
            value={isMobile ? mobileDay : anchor}
            onChange={(e) => {
              if (!e.target.value) return;
              setAnchor(e.target.value);
              setMobileDay(e.target.value);
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Ir a fecha"
          />
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={filter.query}
              onChange={(e) => setFilter({ ...filter, query: e.target.value })}
              placeholder="Buscar tareas"
              className="w-[170px] rounded-[4px] border border-line bg-surface py-1.5 pl-8 pr-2 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-ink"
            />
          </div>
          <select
            value={filter.clientId}
            onChange={(e) => setFilter({ ...filter, clientId: e.target.value })}
            className="rounded-[4px] border border-line bg-surface px-2 py-1.5 text-[12.5px] outline-none focus:border-ink"
            aria-label="Filtrar por cliente"
          >
            <option value="all">Todos los clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value as TaskFilter['status'] })}
            className="rounded-[4px] border border-line bg-surface px-2 py-1.5 text-[12.5px] outline-none focus:border-ink"
            aria-label="Filtrar por estado"
          >
            <option value="all">Todos los estados</option>
            <option value="bucket:action">Solo pendientes de mí</option>
            <option value="bucket:waiting">Solo en revisión</option>
            {(['pending', 'in_progress', 'changes_requested', 'completed'] as const).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Toggle on={filter.showCompleted} onChange={(v) => setFilter({ ...filter, showCompleted: v })} label="Completadas" />
          {!isMobile && <Toggle on={showWeekend} onChange={setShowWeekend} label="Fin de semana" />}
          {!isMobile && (
            <IconBtn label={showUndated ? 'Ocultar sin fecha' : 'Mostrar sin fecha'} onClick={() => setShowUndated(!showUndated)}>
              {showUndated ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </IconBtn>
          )}
        </div>
      </div>

      <ReviewStrip />

      {board.error && (
        <p className="mx-4 mt-3 rounded-[8px] border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger md:mx-8">
          No se pudieron cargar las tareas: {board.error}
        </p>
      )}

      {/* ---------- Board ---------- */}
      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDrag(null)}>
        {isMobile ? (
          <MobileDay
            days={days}
            day={mobileDay}
            today={today}
            onPick={setMobileDay}
            counts={(d) => (grouped.get(d) ?? []).length}
            list={renderList(containerOf(mobileDay))}
            ids={containers[containerOf(mobileDay)] ?? []}
            onCreate={(text) => create(mobileDay, text)}
            undated={renderList(NONE)}
            undatedIds={containers[NONE] ?? []}
            onCreateUndated={(text) => create(null, text)}
          />
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="scroll-thin min-w-0 flex-1 overflow-x-auto">
              <div className="grid h-full min-w-[840px]" style={{ gridTemplateColumns: `repeat(${visibleDays.length}, minmax(0, 1fr))` }}>
                {visibleDays.map((d) => {
                  const isToday = d === today;
                  const container = containerOf(d);
                  return (
                    <section key={d} className={clsx('relative flex min-h-0 flex-col border-r border-line last:border-r-0', isToday && 'bg-surface/45')} aria-label={formatLongDay(d)}>
                      <div className="sticky top-0 z-10">
                        <DayHeader weekday={WEEKDAY_SHORT[weekdayIndex(d)]!} day={dayOfMonth(d)} isToday={isToday} count={(grouped.get(d) ?? []).length} />
                      </div>
                      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-6">
                        {loading ? (
                          <Skeleton />
                        ) : (
                          <DroppableList id={container} items={containers[container] ?? []} className="min-h-[48px]">
                            {renderList(container)}
                          </DroppableList>
                        )}
                        <QuickAdd onCreate={(text) => create(d, text)} />
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
            {showUndated && (
              <aside className="flex w-[232px] shrink-0 flex-col border-l border-line bg-surface/40">
                <div className="flex items-center gap-2 px-3 pb-2 pt-4">
                  <Inbox size={14} className="text-ink-2" />
                  <span className="eyebrow text-ink">Sin fecha</span>
                  <span className="tabular ml-auto text-[11px] text-ink-3">{(containers[NONE] ?? []).length}</span>
                </div>
                <p className="px-3 pb-2 text-[11px] leading-snug text-ink-3">Arrastra una tarea a un día para programarla.</p>
                <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-6">
                  <DroppableList id={NONE} items={containers[NONE] ?? []} className="min-h-[64px]">
                    {renderList(NONE)}
                  </DroppableList>
                  <QuickAdd onCreate={(text) => create(null, text)} />
                </div>
              </aside>
            )}
          </div>
        )}
        <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {activeTask ? (
            <div className="w-[200px]">
              <TaskCardBody task={activeTask} client={activeTask.clientId ? clientsById.get(activeTask.clientId) : undefined} onPrimary={() => {}} menu={menuFor(activeTask)} overlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskDrawer
        task={openTask}
        clients={clients}
        onClose={() => setOpenId(null)}
        onUpdate={(id, patch) => void actions.update(id, patch)}
        onStatus={(id, s) => void actions.setStatus(id, s)}
        onMove={moveTo}
        onArchive={(id) => {
          setOpenId(null);
          void actions.archive(id);
        }}
        onDelete={(id) => setConfirmDelete(id)}
        loadHistory={actions.history}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="¿Eliminar tarea?"
        description={`«${confirmDelete ? taskById.get(confirmDelete)?.title ?? '' : ''}» se eliminará. Si solo quieres ocultarla, archívala.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => {
          if (!confirmDelete) return;
          if (openId === confirmDelete) setOpenId(null);
          void actions.remove(confirmDelete);
        }}
      />
    </div>
  );
}

/* ---------------- small pieces ---------------- */

function Counter({ label, value, strong, muted, onClick, active }: { label: string; value: number; strong?: boolean; muted?: boolean; onClick?: () => void; active?: boolean }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'relative flex min-w-[112px] flex-col items-start overflow-hidden rounded-[10px] border bg-surface px-3.5 py-2 text-left shadow-[var(--shadow-card)] transition-colors',
        active ? 'border-ink' : 'border-line',
        onClick && 'hover:border-line-strong',
      )}
    >
      {strong && <span className="iris-bar absolute inset-y-0 right-0 w-[4px]" aria-hidden />}
      <span className={clsx('eyebrow text-[9.5px]', muted ? 'text-ink-3' : 'text-ink-2')}>{label}</span>
      <span className={clsx('font-display tabular text-[30px] leading-none', muted ? 'text-ink-3' : 'text-ink')}>{value}</span>
    </Tag>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="grid h-8 w-8 place-items-center rounded-[4px] text-ink-2 hover:bg-surface hover:text-ink">
      {children}
    </button>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[12px] text-ink-2 hover:bg-surface">
      <span className={clsx('relative h-[14px] w-[24px] rounded-full transition-colors', on ? 'bg-ink' : 'bg-line-strong')}>
        <span className={clsx('absolute top-[2px] h-[10px] w-[10px] rounded-full bg-surface transition-[left] duration-150', on ? 'left-[12px]' : 'left-[2px]')} />
      </span>
      {label}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-[5px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[46px] animate-pulse rounded-[8px] bg-surface/70" />
      ))}
    </div>
  );
}

function MobileDay(props: {
  days: ISODate[];
  day: ISODate;
  today: ISODate;
  onPick: (d: ISODate) => void;
  counts: (d: ISODate) => number;
  list: React.ReactNode;
  ids: ID[];
  onCreate: (t: string) => void;
  undated: React.ReactNode;
  undatedIds: ID[];
  onCreateUndated: (t: string) => void;
}) {
  const week = weekDays(props.day);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 gap-1 px-3 py-2">
        {week.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => props.onPick(d)}
            className={clsx('flex flex-col items-center rounded-[8px] py-1.5', d === props.day ? 'bg-ink text-on-ink' : 'text-ink-2', d === props.today && d !== props.day && 'ring-1 ring-ink/30')}
          >
            <span className="text-[9.5px] font-semibold tracking-[0.12em]">{WEEKDAY_SHORT[weekdayIndex(d)]}</span>
            <span className="font-display text-[20px] leading-none">{dayOfMonth(d)}</span>
            <span className={clsx('mt-0.5 h-1 w-1 rounded-full', props.counts(d) > 0 ? (d === props.day ? 'bg-on-ink' : 'bg-ink-3') : 'bg-transparent')} />
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-28">
        <DroppableList id={containerOf(props.day)} items={props.ids} className="min-h-[48px]">
          {props.list}
        </DroppableList>
        <QuickAdd onCreate={props.onCreate} />
        <div className="mt-6 flex items-center gap-2">
          <Inbox size={14} className="text-ink-2" />
          <span className="eyebrow">Sin fecha</span>
          <span className="tabular ml-auto text-[11px] text-ink-3">{props.undatedIds.length}</span>
        </div>
        <DroppableList id={NONE} items={props.undatedIds} className="mt-2 min-h-[40px]">
          {props.undated}
        </DroppableList>
        <QuickAdd onCreate={props.onCreateUndated} />
      </div>
    </div>
  );
}

