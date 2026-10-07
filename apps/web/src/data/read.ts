'use client';
import { collection, doc, getDocs, onSnapshot, query, where, type QueryConstraint } from 'firebase/firestore';
import { DATA_MODE, WORKSPACE_ID } from '@/lib/config';
import { clientDb, goToLogin, whileSignedIn } from '@/lib/firebaseClient';
import type { Data, WhereOp } from './db';
import { demoDb } from './runtime';

export type Filter = { field: string; op: WhereOp; value: unknown };
export type Row = { id: string; data: Data };
export type Unsub = () => void;

/**
 * Read side of the data layer (writes go through actions). Same contract for Firestore and the demo DB.
 * Only single-field filters are used so no composite indexes are needed.
 */
export interface ReadPort {
  subscribe(col: string, filters: Filter[], onData: (rows: Row[]) => void, onError: (e: Error) => void): Unsub;
  subscribeDoc(col: string, id: string, onData: (data: Data | null) => void, onError: (e: Error) => void): Unsub;
  getOnce(col: string, filters: Filter[]): Promise<Row[]>;
}

/** Firestore errors in plain Spanish. */
export function friendlyError(e: Error): Error {
  const code = (e as { code?: string }).code;
  if (code === 'permission-denied') {
    return new Error('Sin permiso para leer los datos. Cierra sesión y vuelve a entrar; si sigue, revisa que las reglas de Firestore estén publicadas.');
  }
  if (code === 'unavailable') return new Error('Sin conexión con la base de datos. Se reintentará automáticamente.');
  return e;
}

const wsCol = (name: string) => collection(clientDb(), 'workspaces', WORKSPACE_ID, name);
const constraints = (filters: Filter[]): QueryConstraint[] => filters.map((f) => where(f.field, f.op, f.value));

const firestoreRead: ReadPort = {
  subscribe(col, filters, onData, onError) {
    return whileSignedIn(
      () =>
        onSnapshot(
          query(wsCol(col), ...constraints(filters)),
          (snap) => onData(snap.docs.map((d) => ({ id: d.id, data: d.data() }))),
          (e) => onError(friendlyError(e)),
        ),
      goToLogin,
    );
  },
  subscribeDoc(col, id, onData, onError) {
    return whileSignedIn(
      () =>
        onSnapshot(
          doc(clientDb(), 'workspaces', WORKSPACE_ID, col, id),
          (snap) => onData(snap.exists() ? snap.data() : null),
          (e) => onError(friendlyError(e)),
        ),
      goToLogin,
    );
  },
  async getOnce(col, filters) {
    const snap = await getDocs(query(wsCol(col), ...constraints(filters)));
    return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  },
};

const memoryRead: ReadPort = {
  subscribe(col, filters, onData) {
    return demoDb().listen(`workspaces/${WORKSPACE_ID}/${col}`, filters, onData);
  },
  subscribeDoc(col, id, onData) {
    const path = `workspaces/${WORKSPACE_ID}/${col}`;
    return demoDb().listen(path, [], (rows) => onData(rows.find((r) => r.id === id)?.data ?? null));
  },
  async getOnce(col, filters) {
    return demoDb().runQuery(`workspaces/${WORKSPACE_ID}/${col}`, filters, [], null);
  },
};

export const readPort = (): ReadPort => (DATA_MODE === 'memory' ? memoryRead : firestoreRead);
