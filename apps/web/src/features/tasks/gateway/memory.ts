import type { ActivityLog, Client, CreateTaskInput, Task, TaskStatus } from '@bos/schemas';
import { addDays, formatLongDay, startOfWeek, statusChangeSummary, statusTransitionPatch, todayISO } from '@bos/domain';
import type { TasksGateway } from './types';

/**
 * In-memory implementation of TasksGateway. Same contract as Firestore:
 * used by unit tests and by the static demo (NEXT_PUBLIC_DATA_MODE=memory).
 */
export interface MemoryOptions {
  latencyMs?: number;
  /** Probability (0–1) that a write fails, to exercise optimistic rollback. */
  failRate?: number;
  storageKey?: string | null;
  seed?: { tasks: Task[]; clients: Client[] };
}

type Listener<T> = (data: T) => void;

export function createMemoryGateway(opts: MemoryOptions = {}): TasksGateway {
  const latency = opts.latencyMs ?? 120;
  const failRate = opts.failRate ?? 0;
  const storageKey = opts.storageKey ?? null;

  const initial = loadStored(storageKey) ?? opts.seed ?? demoSeed();
  let tasks = new Map(initial.tasks.map((t) => [t.id, t]));
  const clients = initial.clients;
  let logs: ActivityLog[] = loadStoredLogs(storageKey);
  const taskListeners = new Set<{ from: string; to: string; cb: Listener<Task[]> }>();

  const now = () => new Date().toISOString();
  const wait = () => new Promise((r) => setTimeout(r, latency));
  const maybeFail = () => {
    if (Math.random() < failRate) throw new Error('Error simulado al guardar');
  };
  const persist = () => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ tasks: [...tasks.values()], clients, logs }));
    } catch {
      /* storage unavailable: demo keeps working in memory */
    }
  };
  const emit = () => {
    for (const l of taskListeners) l.cb(select(l.from, l.to));
    persist();
  };
  const select = (from: string, to: string) =>
    [...tasks.values()].filter((t) => !t.archived && (t.dueDate === null || (t.dueDate >= from && t.dueDate <= to)));
  const log = (taskId: string, action: string, summary: string) => {
    const at = now();
    logs = [
      { id: `log-${logs.length + 1}-${Date.now()}`, workspaceId: 'demo', createdAt: at, updatedAt: at, createdBy: 'demo', at, actor: { type: 'user', id: 'demo' }, action, entity: { kind: 'task', id: taskId }, summary, correlationId: at },
      ...logs,
    ];
  };
  const get = (id: string) => {
    const t = tasks.get(id);
    if (!t) throw new Error('La tarea no existe.');
    return t;
  };
  const put = (t: Task) => {
    tasks = new Map(tasks);
    tasks.set(t.id, { ...t, updatedAt: now() });
  };

  return {
    subscribeTasks({ from, to }, onData) {
      const l = { from, to, cb: onData };
      taskListeners.add(l);
      queueMicrotask(() => onData(select(from, to)));
      return () => taskListeners.delete(l);
    },
    subscribeClients(onData) {
      queueMicrotask(() => onData(clients));
      return () => {};
    },
    async createTask(input: CreateTaskInput) {
      await wait();
      maybeFail();
      const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const at = now();
      const p = statusTransitionPatch({ status: 'pending', completedAt: null, reviewStartedAt: null }, input.status, at);
      put({ id, workspaceId: 'demo', createdAt: at, updatedAt: at, createdBy: 'demo', archived: false, jobId: null, ...input, ...p });
      log(id, 'task.create', 'Tarea creada');
      emit();
      return { id };
    },
    async updateTask({ id, patch }) {
      await wait();
      maybeFail();
      put({ ...get(id), ...patch });
      log(id, 'task.update', 'Tarea editada');
      emit();
    },
    async moveTask({ id, dueDate, order }) {
      await wait();
      maybeFail();
      const t = get(id);
      put({ ...t, dueDate, order });
      if (t.dueDate !== dueDate) log(id, 'task.move', `Fecha: ${t.dueDate ? formatLongDay(t.dueDate) : 'Sin fecha'} → ${dueDate ? formatLongDay(dueDate) : 'Sin fecha'}`);
      emit();
    },
    async setStatus({ id, status }) {
      await wait();
      maybeFail();
      const t = get(id);
      if (t.status === status) return;
      put({ ...t, ...statusTransitionPatch(t, status, now()) });
      log(id, 'task.status', statusChangeSummary(t.status, status));
      emit();
    },
    async archiveTask(id) {
      await wait();
      put({ ...get(id), archived: true });
      log(id, 'task.archive', 'Tarea archivada');
      emit();
    },
    async unarchiveTask(id) {
      await wait();
      put({ ...get(id), archived: false });
      log(id, 'task.unarchive', 'Tarea recuperada');
      emit();
    },
    async deleteTask(id) {
      await wait();
      maybeFail();
      tasks = new Map(tasks);
      tasks.delete(id);
      emit();
    },
    async history(taskId) {
      await wait();
      return logs.filter((l) => l.entity.id === taskId);
    },
  };
}

function loadStored(key: string | null): { tasks: Task[]; clients: Client[] } | null {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tasks: Task[]; clients: Client[] };
    return Array.isArray(parsed.tasks) && Array.isArray(parsed.clients) ? parsed : null;
  } catch {
    return null;
  }
}

function loadStoredLogs(key: string | null): ActivityLog[] {
  if (!key || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as { logs?: ActivityLog[] }) : null;
    return parsed?.logs ?? [];
  } catch {
    return [];
  }
}

/* ---------------- Demo seed: the current week, shaped like a real agency week ---------------- */

export const DEMO_CLIENTS: Array<Pick<Client, 'id' | 'name' | 'shortName' | 'aliases' | 'color'>> = [
  { id: 'city-hall', name: 'City Hall', shortName: 'CITY HALL', aliases: ['city', 'ch'], color: 'blue' },
  { id: 'level-bcn', name: 'Level Barcelona', shortName: 'LEVEL BCN', aliases: ['level bcn', 'level barcelona'], color: 'lime' },
  { id: 'level-and', name: 'Level Andorra', shortName: 'LEVEL AND', aliases: ['level and', 'level andorra'], color: 'teal' },
  { id: 'icon', name: 'Icon', shortName: 'ICON', aliases: [], color: 'cyan' },
  { id: 'otto', name: 'Otto', shortName: 'OTTO', aliases: [], color: 'amber' },
  { id: 'makumba', name: 'Makumba', shortName: 'MAKUMBA', aliases: [], color: 'coral' },
  { id: 'la-cova', name: 'La Cova', shortName: 'LA COVA', aliases: ['cova'], color: 'stone' },
  { id: 'descarada', name: 'Descarada', shortName: 'DESCARADA', aliases: [], color: 'pink' },
  { id: 'bellaka', name: 'Bellaka', shortName: 'BELLAKA', aliases: [], color: 'violet' },
  { id: 'esb', name: 'Espacios Singulares', shortName: 'ESP. SINGULARES', aliases: ['espacios singulares', 'esb'], color: 'ink' },
  { id: 'paradise', name: 'Paradise London', shortName: 'PARADISE', aliases: ['paradise', 'paradise london'], color: 'coral' },
  { id: 'hybrunch', name: 'Hybrunch', shortName: 'HYBRUNCH', aliases: [], color: 'amber' },
];

export function demoSeed(today = todayISO()): { tasks: Task[]; clients: Client[] } {
  const at = new Date().toISOString();
  const base = { workspaceId: 'demo', createdAt: at, updatedAt: at, createdBy: 'demo' };
  const clients: Client[] = DEMO_CLIENTS.map((c) => ({ ...base, ...c, status: 'active' as const }));
  const mon = startOfWeek(today);
  const day = (i: number) => addDays(mon, i);
  let n = 0;
  const t = (d: string | null, clientId: string | null, title: string, status: TaskStatus = 'pending', extra: Partial<Task> = {}): Task => {
    n++;
    const p = statusTransitionPatch({ status: 'pending', completedAt: null, reviewStartedAt: null }, status, at);
    return { ...base, id: `demo-${n}`, title, clientId, description: '', dueDate: d, priority: 'normal', order: n * 1024, archived: false, jobId: null, ...p, ...extra };
  };
  const tasks: Task[] = [
    t(day(0), 'level-bcn', 'Flyer viernes', 'completed'),
    t(day(0), 'level-bcn', 'Flyer sábado', 'completed'),
    t(day(0), 'icon', 'Flyer viernes', 'completed'),
    t(day(0), 'icon', 'Flyer sábado', 'review', { description: 'Mandado por WhatsApp a las 17:30.' }),
    t(day(0), 'icon', 'Flyer domingo', 'completed'),
    t(day(0), 'level-and', 'Flyer viernes', 'completed'),
    t(day(0), 'level-and', 'Flyer sábado sala 2', 'review'),
    t(day(1), null, 'Contestar 620', 'completed'),
    t(day(1), 'city-hall', '7 oct sala 2', 'completed'),
    t(day(1), 'icon', 'Cambio 11 oct', 'review'),
    t(day(1), 'icon', 'Cambio 9 oct', 'completed'),
    t(day(1), 'level-bcn', '11 oct', 'changes_requested', { description: 'Cliente quiere versión azul.' }),
    t(day(1), 'esb', 'Alternativo dossier', 'review'),
    t(day(1), 'otto', 'Week', 'completed'),
    t(day(2), 'city-hall', 'Cambio voz 31 oct', 'in_progress', { priority: 'high' }),
    t(day(2), null, 'FACTURAS', 'pending', { priority: 'high' }),
    t(day(2), 'paradise', 'Finde', 'pending'),
    t(day(2), 'hybrunch', '25 oct', 'changes_requested'),
    t(day(2), 'icon', 'Imprimir', 'pending'),
    t(day(2), 'city-hall', '20 oct', 'review'),
    t(day(2), 'city-hall', '21 oct sala 2', 'pending'),
    t(day(2), 'city-hall', 'Vídeo flyer 10 oct', 'in_progress'),
    t(day(3), 'city-hall', '29 oct sala 2', 'pending'),
    t(day(3), 'bellaka', 'Flyer artista', 'pending', { description: 'Esperando confirmación del lineup.' }),
    t(day(4), 'city-hall', 'Flyer Halloween', 'pending', { priority: 'high' }),
    t(day(4), 'makumba', 'Reel semana', 'pending'),
    t(day(5), 'descarada', 'Stories sábado', 'pending'),
    t(null, 'la-cova', 'Renovar logo', 'pending'),
    t(null, null, 'Ordenar carpeta de entregas', 'pending'),
    t(null, 'level-bcn', 'Plantilla carteles noviembre', 'pending'),
  ];
  return { tasks, clients };
}
