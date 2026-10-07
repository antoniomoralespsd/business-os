import type { CollRefLike, Data, DbLike, DocRefLike, DocSnapLike, QueryLike, QuerySnapLike, TxLike, WhereOp } from './db';

/**
 * In-memory Firestore stand-in. Strict on purpose: it rejects `undefined` values and
 * reads after writes inside a transaction, so bugs surface in tests instead of production.
 * Also offers `listen()` for the offline demo's realtime reads.
 */

type Filter = { field: string; op: WhereOp; value: unknown };
type Listener = { colPath: string; filters: Filter[]; cb: (docs: { id: string; data: Data }[]) => void };

let autoId = 0;
const newId = () => `m${Date.now().toString(36)}${(autoId++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function getPath(obj: Data, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Data)[k] : undefined), obj);
}

function cmp(a: unknown, b: unknown): number {
  const norm = (v: unknown) => (v instanceof Date ? v.getTime() : v);
  const x = norm(a) as never;
  const y = norm(b) as never;
  if (x === y) return 0;
  if (x === null || x === undefined) return -1;
  if (y === null || y === undefined) return 1;
  return x < y ? -1 : 1;
}

export function matches(data: Data, f: Filter): boolean {
  const v = getPath(data, f.field);
  switch (f.op) {
    case '==':
      return v instanceof Date && f.value instanceof Date ? v.getTime() === f.value.getTime() : (v ?? null) === f.value;
    case '!=':
      return v !== undefined && v !== f.value;
    case '<':
      return v !== undefined && v !== null && cmp(v, f.value) < 0;
    case '<=':
      return v !== undefined && v !== null && cmp(v, f.value) <= 0;
    case '>':
      return v !== undefined && v !== null && cmp(v, f.value) > 0;
    case '>=':
      return v !== undefined && v !== null && cmp(v, f.value) >= 0;
    case 'in':
      return Array.isArray(f.value) && f.value.includes(v);
    case 'array-contains':
      return Array.isArray(v) && v.includes(f.value);
  }
}

function assertNoUndefined(v: unknown, path = ''): void {
  if (v === undefined) throw new Error(`MemoryDb: undefined value at "${path}" (Firestore rejects undefined)`);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    for (const [k, x] of Object.entries(v)) assertNoUndefined(x, path ? `${path}.${k}` : k);
  }
}

const clone = <T>(v: T): T => {
  if (v instanceof Date) return new Date(v.getTime()) as T;
  if (Array.isArray(v)) return v.map(clone) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
  return v;
};

function setPath(obj: Data, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k] as Data;
  }
  o[keys[keys.length - 1]!] = value;
}

export class MemoryDb implements DbLike {
  /** path of collection → (docId → data) */
  private store = new Map<string, Map<string, Data>>();
  private listeners = new Set<Listener>();
  private batching = 0;
  private dirty = new Set<string>();
  onChange: (() => void) | null = null;

  /* ---------- internal storage ---------- */
  private col(path: string) {
    let c = this.store.get(path);
    if (!c) this.store.set(path, (c = new Map()));
    return c;
  }
  readDoc(path: string): Data | undefined {
    const i = path.lastIndexOf('/');
    const d = this.store.get(path.slice(0, i))?.get(path.slice(i + 1));
    return d ? clone(d) : undefined;
  }
  writeDoc(path: string, data: Data | null, merge = false) {
    if (data) assertNoUndefined(data);
    const i = path.lastIndexOf('/');
    const colPath = path.slice(0, i);
    const id = path.slice(i + 1);
    const c = this.col(colPath);
    if (data === null) c.delete(id);
    else if (merge && c.has(id)) {
      const cur = c.get(id)!;
      for (const [k, v] of Object.entries(clone(data))) cur[k] = v;
    } else c.set(id, clone(data));
    this.dirty.add(colPath);
    if (this.batching === 0) this.flush();
  }
  updateDoc(path: string, data: Data) {
    assertNoUndefined(data);
    const cur = this.readDoc(path);
    if (!cur) throw new Error(`MemoryDb: update on missing document ${path}`);
    for (const [k, v] of Object.entries(clone(data))) setPath(cur, k, v);
    this.writeDoc(path, cur);
  }
  runQuery(colPath: string, filters: Filter[], order: { field: string; dir: 'asc' | 'desc' }[], lim: number | null) {
    let rows = [...(this.store.get(colPath)?.entries() ?? [])]
      .filter(([, d]) => filters.every((f) => matches(d, f)))
      .map(([id, d]) => ({ id, data: clone(d) }));
    for (const o of [...order].reverse()) {
      rows = rows.sort((a, b) => cmp(getPath(a.data, o.field), getPath(b.data, o.field)) * (o.dir === 'desc' ? -1 : 1));
    }
    return lim === null ? rows : rows.slice(0, lim);
  }
  private flush() {
    if (this.dirty.size === 0) return;
    const changed = new Set(this.dirty);
    this.dirty.clear();
    for (const l of this.listeners) if (changed.has(l.colPath)) l.cb(this.runQuery(l.colPath, l.filters, [], null));
    this.onChange?.();
  }

  /* ---------- realtime (demo) ---------- */
  listen(colPath: string, filters: Filter[], cb: Listener['cb']): () => void {
    const l = { colPath, filters, cb };
    this.listeners.add(l);
    queueMicrotask(() => this.listeners.has(l) && cb(this.runQuery(colPath, filters, [], null)));
    return () => this.listeners.delete(l);
  }

  /* ---------- persistence (demo) ---------- */
  dump(): Record<string, Record<string, Data>> {
    const out: Record<string, Record<string, Data>> = {};
    for (const [p, c] of this.store) out[p] = Object.fromEntries(c);
    return JSON.parse(JSON.stringify(out, (_k, v) => (v instanceof Date ? { __date: v.toISOString() } : v)));
  }
  load(dump: Record<string, Record<string, Data>>) {
    const revive = (v: unknown): unknown => {
      if (v && typeof v === 'object' && '__date' in (v as Data)) return new Date((v as { __date: string }).__date);
      if (Array.isArray(v)) return v.map(revive);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
      return v;
    };
    this.store.clear();
    for (const [p, docs] of Object.entries(dump)) this.store.set(p, new Map(Object.entries(docs).map(([id, d]) => [id, revive(d) as Data])));
  }

  /* ---------- DbLike ---------- */
  doc(path: string): DocRefLike {
    return new MemDocRef(this, path);
  }
  collection(path: string): CollRefLike {
    return new MemCollRef(this, path);
  }
  async runTransaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T> {
    const writes: (() => void)[] = [];
    let wrote = false;
    const guard = () => {
      if (wrote) throw new Error('MemoryDb: transaction read after write (Firestore requires all reads first)');
    };
    const tx: TxLike = {
      get: async (ref) => {
        guard();
        return ref.get();
      },
      getQuery: async (q) => {
        guard();
        return q.get();
      },
      set: (ref, data, opts) => {
        wrote = true;
        assertNoUndefined(data);
        writes.push(() => this.writeDoc(ref.path, data, opts?.merge));
      },
      update: (ref, data) => {
        wrote = true;
        assertNoUndefined(data);
        writes.push(() => this.updateDoc(ref.path, data));
      },
      delete: (ref) => {
        wrote = true;
        writes.push(() => this.writeDoc(ref.path, null));
      },
    };
    const result = await fn(tx);
    this.batching++;
    try {
      for (const w of writes) w();
    } finally {
      this.batching--;
      this.flush();
    }
    return result;
  }
}

class MemDocRef implements DocRefLike {
  constructor(private db: MemoryDb, readonly path: string) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }
  collection(name: string): CollRefLike {
    return new MemCollRef(this.db, `${this.path}/${name}`);
  }
  async get(): Promise<DocSnapLike> {
    const d = this.db.readDoc(this.path);
    return { id: this.id, exists: d !== undefined, data: () => d };
  }
  async set(data: Data, opts?: { merge?: boolean }) {
    this.db.writeDoc(this.path, data, opts?.merge);
  }
  async update(data: Data) {
    this.db.updateDoc(this.path, data);
  }
  async delete() {
    this.db.writeDoc(this.path, null);
  }
}

class MemQuery implements QueryLike {
  constructor(
    protected db: MemoryDb,
    readonly path: string,
    protected filters: Filter[] = [],
    protected order: { field: string; dir: 'asc' | 'desc' }[] = [],
    protected lim: number | null = null,
  ) {}
  where(field: string, op: WhereOp, value: unknown): QueryLike {
    return new MemQuery(this.db, this.path, [...this.filters, { field, op, value }], this.order, this.lim);
  }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): QueryLike {
    return new MemQuery(this.db, this.path, this.filters, [...this.order, { field, dir }], this.lim);
  }
  limit(n: number): QueryLike {
    return new MemQuery(this.db, this.path, this.filters, this.order, n);
  }
  async get(): Promise<QuerySnapLike> {
    const rows = this.db.runQuery(this.path, this.filters, this.order, this.lim);
    const docs = rows.map((r) => ({ id: r.id, exists: true, data: () => r.data }));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class MemCollRef extends MemQuery implements CollRefLike {
  get id() {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }
  doc(id?: string): DocRefLike {
    return new MemDocRef(this.db, `${this.path}/${id ?? newId()}`);
  }
}
