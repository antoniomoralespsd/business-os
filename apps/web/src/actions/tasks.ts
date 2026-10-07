import { CreateTaskInput, MoveTaskInput, SetTaskStatusInput, TaskIdInput, UpdateTaskInput, type Task } from '@bos/schemas';
import { formatLongDay, statusChangeSummary, statusTransitionPatch, STATUS_LABEL } from '@bos/domain';
import { taskFromDoc } from '@/lib/convert';
import type { DocRefLike, TxLike } from '@/data/db';
import { ActionError, baseFields, defineAction, type ActionContext } from './define';

async function loadTask(ctx: ActionContext, tx: TxLike, id: string): Promise<{ ref: DocRefLike; task: Task }> {
  const ref = ctx.col('tasks').doc(id);
  const snap = await tx.get(ref);
  const task = snap.exists ? taskFromDoc(snap.id, snap.data() ?? {}) : null;
  if (!task) throw new ActionError('La tarea no existe.');
  return { ref, task };
}

const toDate = (iso: string | null) => (iso ? new Date(iso) : null);
const dayLabel = (d: string | null) => (d ? formatLongDay(d) : 'Sin fecha');

export const createTask = defineAction({
  name: 'task.create',
  description: 'Crea una tarea en un día (o sin fecha).',
  input: CreateTaskInput,
  critical: false,
  handler: async (ctx, input) => {
    const ref = ctx.col('tasks').doc();
    await ctx.db.runTransaction(async (tx) => {
      const p = statusTransitionPatch({ status: 'pending', completedAt: null, reviewStartedAt: null }, input.status, ctx.now.toISOString());
      tx.set(ref, {
        ...baseFields(ctx, ref.id),
        title: input.title,
        clientId: input.clientId,
        description: input.description,
        dueDate: input.dueDate,
        status: input.status,
        priority: input.priority,
        order: input.order,
        archived: false,
        completedAt: toDate(p.completedAt),
        reviewStartedAt: toDate(p.reviewStartedAt),
        jobId: null,
      });
      ctx.log(tx, { action: 'task.create', entity: { kind: 'task', id: ref.id }, summary: 'Tarea creada', after: { title: input.title, dueDate: input.dueDate } });
    });
    return { id: ref.id };
  },
});

export const updateTask = defineAction({
  name: 'task.update',
  description: 'Edita título, cliente, notas o prioridad de una tarea.',
  input: UpdateTaskInput,
  critical: false,
  handler: async (ctx, { id, patch }) => {
    await ctx.db.runTransaction(async (tx) => {
      const { ref, task } = await loadTask(ctx, tx, id);
      const changed = Object.entries(patch).filter(([k, v]) => v !== undefined && task[k as keyof Task] !== v);
      if (changed.length === 0) return;
      tx.update(ref, { ...Object.fromEntries(changed), updatedAt: ctx.now });
      const labels: Record<string, string> = { title: 'Título', clientId: 'Cliente', description: 'Notas', priority: 'Prioridad' };
      ctx.log(tx, {
        action: 'task.update',
        entity: { kind: 'task', id },
        summary: `${changed.map(([k]) => labels[k] ?? k).join(', ')} actualizado`,
        before: Object.fromEntries(changed.map(([k]) => [k, task[k as keyof Task]])),
        after: Object.fromEntries(changed),
      });
    });
    return { id };
  },
});

export const moveTask = defineAction({
  name: 'task.move',
  description: 'Cambia el día y/o el orden de una tarea (drag & drop).',
  input: MoveTaskInput,
  critical: false,
  handler: async (ctx, { id, dueDate, order }) => {
    await ctx.db.runTransaction(async (tx) => {
      const { ref, task } = await loadTask(ctx, tx, id);
      tx.update(ref, { dueDate, order, updatedAt: ctx.now });
      if (task.dueDate !== dueDate) {
        ctx.log(tx, { action: 'task.move', entity: { kind: 'task', id }, summary: `Fecha: ${dayLabel(task.dueDate)} → ${dayLabel(dueDate)}`, before: { dueDate: task.dueDate }, after: { dueDate } });
      }
    });
    return { id };
  },
});

export const setTaskStatus = defineAction({
  name: 'task.status',
  description: `Cambia el estado de una tarea (${Object.values(STATUS_LABEL).join(', ')}).`,
  input: SetTaskStatusInput,
  critical: false,
  handler: async (ctx, { id, status }) => {
    await ctx.db.runTransaction(async (tx) => {
      const { ref, task } = await loadTask(ctx, tx, id);
      if (task.status === status) return;
      const p = statusTransitionPatch(task, status, ctx.now.toISOString());
      tx.update(ref, { status: p.status, completedAt: toDate(p.completedAt), reviewStartedAt: toDate(p.reviewStartedAt), updatedAt: ctx.now });
      ctx.log(tx, { action: 'task.status', entity: { kind: 'task', id }, summary: statusChangeSummary(task.status, status), before: { status: task.status }, after: { status } });
    });
    return { id };
  },
});

export const archiveTask = defineAction({
  name: 'task.archive',
  description: 'Oculta una tarea de las vistas habituales sin borrarla (va al Archivo).',
  input: TaskIdInput,
  critical: false,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const { ref } = await loadTask(ctx, tx, id);
      tx.update(ref, { archived: true, updatedAt: ctx.now });
      ctx.log(tx, { action: 'task.archive', entity: { kind: 'task', id }, summary: 'Tarea archivada' });
    });
    return { id };
  },
});

export const unarchiveTask = defineAction({
  name: 'task.unarchive',
  description: 'Recupera una tarea archivada.',
  input: TaskIdInput,
  critical: false,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const { ref } = await loadTask(ctx, tx, id);
      tx.update(ref, { archived: false, updatedAt: ctx.now });
      ctx.log(tx, { action: 'task.unarchive', entity: { kind: 'task', id }, summary: 'Tarea recuperada del archivo' });
    });
    return { id };
  },
});

export const deleteTask = defineAction({
  name: 'task.delete',
  description: 'Elimina una tarea. Guarda una copia completa en el historial.',
  input: TaskIdInput,
  critical: true,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const { ref, task } = await loadTask(ctx, tx, id);
      tx.delete(ref);
      ctx.log(tx, { action: 'task.delete', entity: { kind: 'task', id }, summary: `Tarea eliminada: ${task.title}`, before: task });
    });
    return { id };
  },
});

export const taskActions = [createTask, updateTask, moveTask, setTaskStatus, archiveTask, unarchiveTask, deleteTask];
