import type { z } from 'zod';
import { ActivityLogSchema, ClientSchema, TaskSchema, type ActivityLog, type Client, type Task } from '@bos/schemas';

/** Firestore Timestamp (client or admin SDK), Date or ISO string → ISO string. */
export function toISO(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

const INSTANT_FIELDS = ['createdAt', 'updatedAt', 'completedAt', 'reviewStartedAt', 'at', 'sentAt'] as const;
const ALWAYS_SET = new Set(['createdAt', 'updatedAt', 'at']);

function normalizeInstants(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const f of INSTANT_FIELDS) {
    if (f in out) out[f] = toISO(out[f]) ?? (ALWAYS_SET.has(f) ? new Date().toISOString() : null);
  }
  return out;
}

/** Parse any stored document with its schema. Malformed documents are skipped (and logged). */
export function parseDoc<S extends z.ZodTypeAny>(schema: S, id: string, data: Record<string, unknown>): z.infer<S> | null {
  const parsed = schema.safeParse({ ...normalizeInstants(data), id });
  if (!parsed.success) {
    console.warn('[data] skipping malformed document', id, parsed.error.issues.slice(0, 3));
    return null;
  }
  return parsed.data;
}

export const taskFromDoc = (id: string, data: Record<string, unknown>): Task | null => parseDoc(TaskSchema, id, data);
export const clientFromDoc = (id: string, data: Record<string, unknown>): Client | null => parseDoc(ClientSchema, id, data);
export const activityFromDoc = (id: string, data: Record<string, unknown>): ActivityLog | null => parseDoc(ActivityLogSchema, id, data);
