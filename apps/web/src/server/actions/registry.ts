import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor } from '@bos/schemas';

export interface ActionContext {
  db: Firestore;
  workspaceId: string;
  actor: Actor;
  now: Date;
  correlationId: string;
  /** Collection reference inside the workspace. */
  col: (name: string) => FirebaseFirestore.CollectionReference;
  /** Queue an activity_logs entry inside the given transaction. */
  log: (tx: Transaction, entry: LogEntry) => void;
}

export interface LogEntry {
  action: string;
  entity: { kind: string; id: string };
  summary: string;
  before?: unknown;
  after?: unknown;
}

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

export function makeContext(db: Firestore, workspaceId: string, actor: Actor): ActionContext {
  const correlationId = randomUUID();
  const ws = db.doc(`workspaces/${workspaceId}`);
  const col = (name: string) => ws.collection(name);
  return {
    db,
    workspaceId,
    actor,
    now: new Date(),
    correlationId,
    col,
    log: (tx, e) => {
      const ref = col('activity_logs').doc();
      tx.set(ref, {
        id: ref.id,
        workspaceId,
        at: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: actor.id,
        actor,
        correlationId,
        ...e,
        before: e.before ?? null,
        after: e.after ?? null,
      });
    },
  };
}
