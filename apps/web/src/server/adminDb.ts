import 'server-only';
import type { Firestore } from 'firebase-admin/firestore';
import type { DbLike, TxLike } from '@/data/db';
import { adminDb } from './firebaseAdmin';

/** Adapts the Admin SDK to DbLike (only the transaction API differs: get(query) → getQuery). */
export function adminDbLike(): DbLike {
  const db: Firestore = adminDb();
  return {
    doc: (p) => db.doc(p) as never,
    collection: (p) => db.collection(p) as never,
    runTransaction: (fn) =>
      db.runTransaction((t) => {
        const tx: TxLike = {
          get: (ref) => t.get(ref as never) as never,
          getQuery: (q) => t.get(q as never) as never,
          set: (ref, data, opts) => void (opts ? t.set(ref as never, data as never, opts) : t.set(ref as never, data as never)),
          update: (ref, data) => void t.update(ref as never, data as never),
          delete: (ref) => void t.delete(ref as never),
        };
        return fn(tx);
      }),
  };
}
