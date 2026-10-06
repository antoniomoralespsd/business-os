import { describe, expect, it } from 'vitest';
import type { Task } from '@bos/schemas';
import { createMemoryGateway } from './memory';

const empty = { tasks: [], clients: [] };
const next = (gw: ReturnType<typeof createMemoryGateway>, range = { from: '2026-10-12', to: '2026-10-18' }) =>
  new Promise<Task[]>((resolve) => {
    let first = true;
    const off = gw.subscribeTasks(range, (t) => {
      if (first) { first = false; off(); resolve(t); }
    }, () => {});
  });

describe('TasksGateway contract (memory implementation)', () => {
  it('creates, moves, changes status and logs history', async () => {
    const gw = createMemoryGateway({ latencyMs: 0, seed: empty });
    const { id } = await gw.createTask({ title: 'Flyer', clientId: null, dueDate: '2026-10-13', order: 1024, status: 'pending', priority: 'normal', description: '' });
    await gw.moveTask({ id, dueDate: '2026-10-14', order: 512 });
    await gw.setStatus({ id, status: 'review' });
    const [t] = await next(gw);
    expect(t).toMatchObject({ id, dueDate: '2026-10-14', order: 512, status: 'review' });
    expect(t!.reviewStartedAt).not.toBeNull();
    const h = await gw.history(id);
    expect(h.map((x) => x.action)).toEqual(['task.status', 'task.move', 'task.create']);
  });

  it('returns undated tasks with any range and hides archived ones', async () => {
    const gw = createMemoryGateway({ latencyMs: 0, seed: empty });
    const a = await gw.createTask({ title: 'Sin fecha', clientId: null, dueDate: null, order: 1, status: 'pending', priority: 'normal', description: '' });
    const b = await gw.createTask({ title: 'Otra semana', clientId: null, dueDate: '2026-11-30', order: 1, status: 'pending', priority: 'normal', description: '' });
    const c = await gw.createTask({ title: 'Archivada', clientId: null, dueDate: '2026-10-12', order: 1, status: 'pending', priority: 'normal', description: '' });
    await gw.archiveTask(c.id);
    const ids = (await next(gw)).map((t) => t.id);
    expect(ids).toEqual([a.id]);
    expect(ids).not.toContain(b.id);
  });

  it('rejects writes when the backend fails (so the UI can roll back)', async () => {
    const gw = createMemoryGateway({ latencyMs: 0, seed: empty, failRate: 1 });
    await expect(gw.createTask({ title: 'x', clientId: null, dueDate: null, order: 1, status: 'pending', priority: 'normal', description: '' })).rejects.toThrow();
  });
});
