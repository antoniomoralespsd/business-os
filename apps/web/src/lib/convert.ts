import { TaskSchema, ClientSchema, ActivityLogSchema, type Task, type Client, type ActivityLog } from '@bos/schemas';

/** Firestore Timestamp (client or admin SDK) → ISO string. Works on both via duck typing. */
function toISO(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

const INSTANT_FIELDS = ['createdAt', 'updatedAt', 'completedAt', 'reviewStartedAt', 'at'] as const;

function normalizeInstants(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const f of INSTANT_FIELDS) {
    if (f in out) {
      // serverTimestamp() is null in the local snapshot until the write commits: use "now" so the UI stays stable.
      out[f] = toISO(out[f]) ?? (f === 'createdAt' || f === 'updatedAt' || f === 'at' ? new Date().toISOString() : null);
    }
  }
  return out;
}

export function taskFromDoc(id: string, data: Record<string, unknown>): Task | null {
  const parsed = TaskSchema.safeParse({ ...normalizeInstants(data), id });
  if (!parsed.success) {
    console.warn('[tasks] skipping malformed task', id, parsed.error.issues);
    return null;
  }
  return parsed.data;
}

export function clientFromDoc(id: string, data: Record<string, unknown>): Client | null {
  const parsed = ClientSchema.safeParse({ ...normalizeInstants(data), id });
  return parsed.success ? parsed.data : null;
}

export function activityFromDoc(id: string, data: Record<string, unknown>): ActivityLog | null {
  const parsed = ActivityLogSchema.safeParse({ ...normalizeInstants(data), id });
  return parsed.success ? parsed.data : null;
}
