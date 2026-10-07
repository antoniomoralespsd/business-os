'use client';
import { WORKSPACE_ID } from '@/lib/config';
import { ACTIONS } from '@/actions';
import { makeContext, runAction } from '@/actions/define';
import { seedDemo } from './demoSeed';
import { MemoryDb } from './memoryDb';

/**
 * Offline demo runtime: the real action handlers running against an in-browser MemoryDb,
 * persisted to localStorage. Used when NEXT_PUBLIC_DATA_MODE=memory.
 */
const STORAGE_KEY = 'bos-demo-v2';
let db: MemoryDb | null = null;

export function demoDb(): MemoryDb {
  if (db) return db;
  db = new MemoryDb();
  let restored = false;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      db.load(JSON.parse(raw));
      restored = true;
    }
  } catch {
    /* corrupted or unavailable storage: start fresh */
  }
  if (!restored) seedDemo(db, WORKSPACE_ID);
  let timer: ReturnType<typeof setTimeout> | null = null;
  db.onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db!.dump()));
      } catch {
        /* storage unavailable: demo keeps working in memory */
      }
    }, 200);
  };
  return db;
}

export function resetDemo() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  db = null;
}

export async function callDemoAction<T>(name: string, input: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, 120)); // feel like a network call
  return (await runAction(ACTIONS, makeContext(demoDb(), WORKSPACE_ID, { type: 'user', id: 'demo' }), name, input)) as T;
}
