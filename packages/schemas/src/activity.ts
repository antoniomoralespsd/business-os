import { z } from 'zod';
import { ActorSchema, BaseDocSchema, IdSchema, InstantSchema } from './common';

export const ActivityLogSchema = BaseDocSchema.extend({
  at: InstantSchema,
  actor: ActorSchema,
  /** Dotted action name, e.g. 'task.status', 'invoice.generate'. */
  action: z.string(),
  entity: z.object({ kind: z.string(), id: IdSchema }),
  /** Human summary in Spanish: "Estado → En revisión". */
  summary: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  correlationId: z.string(),
});
export type ActivityLog = z.infer<typeof ActivityLogSchema>;
