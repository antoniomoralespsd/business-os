/**
 * Minimal structural subset of the Firestore Admin API that action handlers use.
 * Implemented by the real Admin SDK (server) and by MemoryDb (tests + offline demo),
 * so every write action runs the same code in both places.
 *
 * Rules for handlers:
 * - Inside a transaction, do all reads before any write (Firestore requires it; MemoryDb enforces it).
 * - Timestamps are plain `Date` objects (the Admin SDK stores them as Timestamps).
 * - Never write `undefined` (use null or omit the key).
 */
export type Data = Record<string, unknown>;
export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';

export interface DocSnapLike {
  id: string;
  exists: boolean;
  data(): Data | undefined;
}

export interface QuerySnapLike {
  docs: DocSnapLike[];
  empty: boolean;
  size: number;
}

export interface QueryLike {
  where(field: string, op: WhereOp, value: unknown): QueryLike;
  orderBy(field: string, dir?: 'asc' | 'desc'): QueryLike;
  limit(n: number): QueryLike;
  get(): Promise<QuerySnapLike>;
}

export interface DocRefLike {
  id: string;
  path: string;
  collection(name: string): CollRefLike;
  get(): Promise<DocSnapLike>;
  set(data: Data, opts?: { merge?: boolean }): Promise<unknown>;
  update(data: Data): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface CollRefLike extends QueryLike {
  id: string;
  path: string;
  doc(id?: string): DocRefLike;
}

export interface TxLike {
  get(ref: DocRefLike): Promise<DocSnapLike>;
  getQuery(q: QueryLike): Promise<QuerySnapLike>;
  set(ref: DocRefLike, data: Data, opts?: { merge?: boolean }): void;
  update(ref: DocRefLike, data: Data): void;
  delete(ref: DocRefLike): void;
}

export interface DbLike {
  doc(path: string): DocRefLike;
  collection(path: string): CollRefLike;
  runTransaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T>;
}
