'use client';
import { ActivityLogSchema, ClientSchema, TaskSchema, type ActivityLog, type Client, type Task } from '@bos/schemas';
import { callAction } from '@/lib/actionsClient';
import { parseDoc } from '@/lib/convert';
import { readPort } from '@/data/read';
import type { TasksGateway } from './types';

/**
 * Tasks gateway over the generic data layer: reads via ReadPort (Firestore or demo DB),
 * writes via registered actions. One implementation for both modes.
 */
const gateway: TasksGateway = {
  subscribeTasks({ from, to }, onData, onError) {
    // Two single-field live queries (no composite index): dated range + undated.
    let dated: Task[] | null = null;
    let undated: Task[] | null = null;
    const emit = () => dated && undated && onData([...dated, ...undated]);
    const parse = (rows: { id: string; data: Record<string, unknown> }[]) =>
      rows.map((r) => parseDoc(TaskSchema, r.id, r.data)).filter((t): t is Task => t !== null && !t.archived);
    const a = readPort().subscribe('tasks', [{ field: 'dueDate', op: '>=', value: from }, { field: 'dueDate', op: '<=', value: to }], (rows) => {
      dated = parse(rows);
      emit();
    }, onError);
    const b = readPort().subscribe('tasks', [{ field: 'dueDate', op: '==', value: null }], (rows) => {
      undated = parse(rows);
      emit();
    }, onError);
    return () => {
      a();
      b();
    };
  },
  subscribeClients(onData, onError) {
    return readPort().subscribe(
      'clients',
      [],
      (rows) => onData(rows.map((r) => parseDoc(ClientSchema, r.id, r.data)).filter((c): c is Client => c !== null).sort((x, y) => x.name.localeCompare(y.name, 'es'))),
      onError,
    );
  },
  async createTask(input) {
    return callAction<{ id: string }>('task.create', input);
  },
  async updateTask(input) {
    await callAction('task.update', input);
  },
  async moveTask(input) {
    await callAction('task.move', input);
  },
  async setStatus(input) {
    await callAction('task.status', input);
  },
  async archiveTask(id) {
    await callAction('task.archive', { id });
  },
  async unarchiveTask(id) {
    await callAction('task.unarchive', { id });
  },
  async deleteTask(id) {
    await callAction('task.delete', { id });
  },
  async history(taskId) {
    const rows = await readPort().getOnce('activity_logs', [{ field: 'entity.id', op: '==', value: taskId }]);
    return rows
      .map((r) => parseDoc(ActivityLogSchema, r.id, r.data))
      .filter((x): x is ActivityLog => x !== null && x.entity.kind === 'task')
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 50);
  },
};

export function tasksGateway(): TasksGateway {
  return gateway;
}

export type { TasksGateway } from './types';
