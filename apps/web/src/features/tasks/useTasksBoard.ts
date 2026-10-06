'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Client, CreateTaskInput, ID, ISODate, Task, TaskStatus } from '@bos/schemas';
import { STATUS_LABEL, statusTransitionPatch } from '@bos/domain';
import { tasksGateway } from './gateway';

type Override = Partial<Task> & { __expires: number };

/**
 * Live tasks for a date range with optimistic writes:
 * a mutation applies an override immediately, calls the gateway, and the override is
 * dropped once the server snapshot matches it (or after a timeout). On failure the
 * override is removed (= the card snaps back) and a toast explains why.
 */
export function useTasksBoard(range: { from: ISODate; to: ISODate }) {
  const gw = tasksGateway();
  const [serverTasks, setServerTasks] = useState<Task[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [overrides, setOverrides] = useState<Map<ID, Override>>(new Map());
  const [temps, setTemps] = useState<Map<string, { task: Task; realId: ID | null }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  useEffect(() => {
    setServerTasks(null);
    return gw.subscribeTasks(range, setServerTasks, (e) => setError(e.message));
  }, [gw, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => gw.subscribeClients(setClients, (e) => setError(e.message)), [gw]);

  // Reconcile: drop overrides the server has caught up with, and temps whose real doc arrived.
  useEffect(() => {
    if (!serverTasks) return;
    const byId = new Map(serverTasks.map((t) => [t.id, t]));
    setOverrides((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, o] of prev) {
        const s = byId.get(id);
        const settled =
          Date.now() > o.__expires ||
          (s && Object.entries(o).every(([k, v]) => k === '__expires' || (s as Record<string, unknown>)[k] === v));
        if (settled) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setTemps((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [tmp, v] of prev) {
        if (v.realId && byId.has(v.realId)) {
          next.delete(tmp);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [serverTasks]);

  const tasks = useMemo(() => {
    if (!serverTasks) return null;
    const merged = serverTasks
      .map((t) => {
        const o = overrides.get(t.id);
        if (!o) return t;
        const { __expires: _e, ...patch } = o;
        return { ...t, ...patch };
      })
      .filter((t) => !t.archived);
    const realIds = new Set(serverTasks.map((t) => t.id));
    for (const { task, realId } of temps.values()) if (!realId || !realIds.has(realId)) merged.push(task);
    return merged;
  }, [serverTasks, overrides, temps]);

  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const optimistic = useCallback(
    async (id: ID, patch: Partial<Task>, run: () => Promise<void>, errorPrefix: string) => {
      const prev = overridesRef.current.get(id);
      setOverrides((m) => new Map(m).set(id, { ...(m.get(id) ?? {}), ...patch, __expires: Date.now() + 8000 }));
      try {
        await run();
      } catch (e) {
        setOverrides((m) => {
          const next = new Map(m);
          if (prev) next.set(id, prev);
          else next.delete(id);
          return next;
        });
        toast.error(errorPrefix, { description: e instanceof Error ? e.message : undefined });
        throw e;
      }
    },
    [],
  );

  const findTask = useCallback((id: ID) => tasks?.find((t) => t.id === id), [tasks]);

  const actions = useMemo(
    () => ({
      async create(input: CreateTaskInput) {
        const tmpId = `tmp-${Math.random().toString(36).slice(2)}`;
        const at = new Date().toISOString();
        const task: Task = {
          id: tmpId, workspaceId: '', createdAt: at, updatedAt: at, createdBy: '', archived: false, jobId: null,
          completedAt: null, reviewStartedAt: null, ...input,
        };
        setTemps((m) => new Map(m).set(tmpId, { task, realId: null }));
        try {
          const { id } = await gw.createTask(input);
          setTemps((m) => (m.has(tmpId) ? new Map(m).set(tmpId, { task, realId: id }) : m));
          return id;
        } catch (e) {
          setTemps((m) => {
            const next = new Map(m);
            next.delete(tmpId);
            return next;
          });
          toast.error('No se pudo crear la tarea', { description: e instanceof Error ? e.message : undefined });
          return null;
        }
      },
      move(id: ID, dueDate: ISODate | null, order: number) {
        return optimistic(id, { dueDate, order }, () => gw.moveTask({ id, dueDate, order }), 'No se pudo mover la tarea').catch(() => {});
      },
      setStatus(id: ID, status: TaskStatus) {
        const t = findTask(id);
        if (!t || t.status === status) return Promise.resolve();
        const patch = statusTransitionPatch(t, status, new Date().toISOString());
        return optimistic(id, patch, () => gw.setStatus({ id, status }), 'No se pudo cambiar el estado')
          .then(() => {
            if (status === 'review') toast(`«${t.title}» enviada a revisión`, { description: 'Ya no cuenta como trabajo pendiente.' });
          })
          .catch(() => {});
      },
      update(id: ID, patch: Partial<Pick<Task, 'title' | 'clientId' | 'description' | 'priority'>>) {
        return optimistic(id, patch, () => gw.updateTask({ id, patch }), 'No se pudo guardar').catch(() => {});
      },
      archive(id: ID) {
        const t = findTask(id);
        return optimistic(id, { archived: true }, () => gw.archiveTask(id), 'No se pudo archivar')
          .then(() =>
            toast('Tarea archivada', {
              description: t?.title,
              action: { label: 'Deshacer', onClick: () => void gw.unarchiveTask(id).then(() => setOverrides((m) => { const n = new Map(m); n.delete(id); return n; })) },
            }),
          )
          .catch(() => {});
      },
      async remove(id: ID) {
        await optimistic(id, { archived: true }, () => gw.deleteTask(id), 'No se pudo eliminar').catch(() => {});
      },
      history: (id: ID) => gw.history(id),
    }),
    [gw, optimistic, findTask],
  );

  return { tasks, clients, clientsById, error, actions, statusLabel: STATUS_LABEL };
}

export type TasksBoard = ReturnType<typeof useTasksBoard>;
