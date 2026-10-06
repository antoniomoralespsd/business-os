import { z } from 'zod';
import { BaseDocSchema, IdSchema, ISODateSchema, InstantSchema } from './common';

export const TASK_STATUSES = ['pending', 'in_progress', 'review', 'changes_requested', 'completed'] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

/**
 * action  → requiere acción mía (pending, in_progress, changes_requested)
 * waiting → esperando a terceros (review)
 * done    → finalizado (completed)
 */
export type TaskBucket = 'action' | 'waiting' | 'done';

export const TaskSchema = BaseDocSchema.extend({
  title: z.string().min(1).max(200),
  clientId: IdSchema.nullable(),
  /** Free-text notes. */
  description: z.string().max(10_000),
  /** null = SIN FECHA. */
  dueDate: ISODateSchema.nullable(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  /** Fractional order inside a day column (or inside SIN FECHA). */
  order: z.number(),
  archived: z.boolean(),
  completedAt: InstantSchema.nullable(),
  reviewStartedAt: InstantSchema.nullable(),
  /** Future link to a billable Job. */
  jobId: IdSchema.nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

/* ---------- Action inputs (validated server-side) ---------- */

export const CreateTaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  clientId: IdSchema.nullable().default(null),
  dueDate: ISODateSchema.nullable(),
  order: z.number(),
  status: TaskStatusSchema.default('pending'),
  priority: TaskPrioritySchema.default('normal'),
  description: z.string().max(10_000).default(''),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const UpdateTaskInput = z.object({
  id: IdSchema,
  patch: z
    .object({
      title: z.string().trim().min(1).max(200),
      clientId: IdSchema.nullable(),
      description: z.string().max(10_000),
      priority: TaskPrioritySchema,
    })
    .partial(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

export const MoveTaskInput = z.object({
  id: IdSchema,
  dueDate: ISODateSchema.nullable(),
  order: z.number(),
});
export type MoveTaskInput = z.infer<typeof MoveTaskInput>;

export const SetTaskStatusInput = z.object({
  id: IdSchema,
  status: TaskStatusSchema,
});
export type SetTaskStatusInput = z.infer<typeof SetTaskStatusInput>;

export const TaskIdInput = z.object({ id: IdSchema });
export type TaskIdInput = z.infer<typeof TaskIdInput>;
