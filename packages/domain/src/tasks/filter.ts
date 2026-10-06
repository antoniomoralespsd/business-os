import type { Client, ID, ISODate, Task, TaskBucket, TaskStatus } from '@bos/schemas';
import { bucketOf } from './status';

export interface TaskFilter {
  clientId: ID | 'all';
  /** 'all' | a single status | a bucket shortcut */
  status: 'all' | TaskStatus | `bucket:${TaskBucket}`;
  query: string;
  showCompleted: boolean;
}

export const DEFAULT_FILTER: TaskFilter = { clientId: 'all', status: 'all', query: '', showCompleted: true };

const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '');

export function matchesFilter(task: Task, f: TaskFilter, clientsById: ReadonlyMap<ID, Pick<Client, 'name'>>): boolean {
  if (task.archived) return false;
  if (!f.showCompleted && task.status === 'completed') return false;
  if (f.clientId !== 'all' && task.clientId !== f.clientId) return false;
  if (f.status !== 'all') {
    if (f.status.startsWith('bucket:')) {
      if (bucketOf(task.status) !== f.status.slice(7)) return false;
    } else if (task.status !== f.status) return false;
  }
  const q = norm(f.query.trim());
  if (q) {
    const client = task.clientId ? clientsById.get(task.clientId)?.name ?? '' : '';
    const hay = norm(`${task.title} ${client} ${task.description}`);
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** Group tasks by day key ('none' for SIN FECHA), sorted by order. */
export function groupByDay(tasks: readonly Task[]): Map<ISODate | 'none', Task[]> {
  const map = new Map<ISODate | 'none', Task[]>();
  for (const t of tasks) {
    const key = t.dueDate ?? 'none';
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  return map;
}

export interface BucketCounts { action: number; waiting: number; done: number }

/** Counts for the header strip. Completed counts only tasks completed on `today`. */
export function bucketCounts(tasks: readonly Task[], today: ISODate): BucketCounts {
  const c: BucketCounts = { action: 0, waiting: 0, done: 0 };
  for (const t of tasks) {
    if (t.archived) continue;
    const b = bucketOf(t.status);
    if (b === 'done') {
      if (t.completedAt && t.completedAt.slice(0, 10) === today) c.done++;
    } else c[b]++;
  }
  return c;
}
