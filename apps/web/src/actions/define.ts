import { randomId } from '@/lib/ids';
import type { z } from 'zod';
import type { Actor } from '@bos/schemas';
import type { CollRefLike, DbLike, TxLike } from '@/data/db';

/**
 * Action = the only way anything is written. Shared by the server (/api/actions, Admin SDK)
 * and the offline demo (MemoryDb in the browser). Handlers must not import server-only code.
 */
export interface ActionContext {
  db: DbLike;
  workspaceId: string;
  actor: Actor;
  now: Date;
  correlationId: string;
  col: (name: string) => CollRefLike;
  log: (tx: TxLike, entry: LogEntry) => void;
}

export interface LogEntry {
  action: string;
  entity: { kind: string; id: string };
  summary: string;
  before?: unknown;
  after?: unknown;
}

export class ActionError extends Error {}

export interface ActionDefinition<I extends z.ZodTypeAny, O> {
  name: string;
  description: string;
  input: I;
  /** Critical actions are never executed from an AI plan without explicit confirmation. */
  critical: boolean;
  handler: (ctx: ActionContext, input: z.infer<I>) => Promise<O>;
}

/** Type-erased action for the registry map (input is validated with `input` before `handler` runs). */
export interface AnyAction {
  name: string;
  description: string;
  input: z.ZodTypeAny;
  critical: boolean;
  handler: (ctx: ActionContext, input: never) => Promise<unknown>;
}

export function defineAction<I extends z.ZodTypeAny, O>(def: ActionDefinition<I, O>): ActionDefinition<I, O> {
  return def;
}

/** Strip undefined values (Firestore rejects them); keeps null. Shallow + one level for plain objects. */
export function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? clean(v as Record<string, unknown>) : v;
  }
  return out as T;
}

export function makeContext(db: DbLike, workspaceId: string, actor: Actor): ActionContext {
  const correlationId = randomId();
  const ws = db.doc(`workspaces/${workspaceId}`);
  const col = (name: string) => ws.collection(name);
  const now = new Date();
  return {
    db,
    workspaceId,
    actor,
    now,
    correlationId,
    col,
    log: (tx, e) => {
      const ref = col('activity_logs').doc();
      tx.set(
        ref,
        clean({
          id: ref.id,
          workspaceId,
          at: new Date(),
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
          actor,
          correlationId,
          action: e.action,
          entity: e.entity,
          summary: e.summary,
          before: e.before === undefined ? null : JSON.parse(JSON.stringify(e.before)),
          after: e.after === undefined ? null : JSON.parse(JSON.stringify(e.after)),
        }),
      );
    },
  };
}

/** Base fields for a new document. */
export function baseFields(ctx: ActionContext, id: string) {
  return { id, workspaceId: ctx.workspaceId, createdAt: ctx.now, updatedAt: ctx.now, createdBy: ctx.actor.id };
}

/** Runs a validated action. Used by the API route and the demo runtime. */
export async function runAction(actions: ReadonlyMap<string, AnyAction>, ctx: ActionContext, name: string, rawInput: unknown) {
  const def = actions.get(name);
  if (!def) throw new ActionError(`Acción desconocida: ${name}`);
  const parsed = def.input.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ActionError(`Datos no válidos${first ? `: ${first.path.join('.')} ${first.message}` : ''}`);
  }
  return def.handler(ctx, parsed.data as never);
}
