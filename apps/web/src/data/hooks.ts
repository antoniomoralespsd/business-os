'use client';
import { useEffect, useMemo, useState } from 'react';
import type { z } from 'zod';
import { toast } from 'sonner';
import {
  ClientSchema,
  ExpenseSchema,
  GoogleSettingsSchema,
  InboxItemSchema,
  InvoiceSchema,
  IssuerSettingsSchema,
  JobSchema,
  SubscriptionSchema,
  TaskSchema,
  VaultEntrySchema,
  VaultMetaSchema,
  type Client,
  type GoogleSettings,
  type IssuerSettings,
} from '@bos/schemas';
import { callAction } from '@/lib/actionsClient';
import { parseDoc } from '@/lib/convert';
import { readPort, type Filter } from './read';

/** Live list of a workspace collection, parsed with its schema. `null` while loading. */
export function useCollection<S extends z.ZodTypeAny>(col: string, schema: S, filters: Filter[] = [], enabled = true) {
  const [data, setData] = useState<z.infer<S>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(filters);
  useEffect(() => {
    if (!enabled) return;
    setData(null);
    return readPort().subscribe(
      col,
      JSON.parse(key) as Filter[],
      (rows) => setData(rows.map((r) => parseDoc(schema, r.id, r.data)).filter((x): x is z.infer<S> => x !== null)),
      (e) => setError(e.message),
    );
  }, [col, key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error };
}

export function useDocData(col: string, id: string) {
  const [data, setData] = useState<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => readPort().subscribeDoc(col, id, setData, () => setData(null)), [col, id]);
  return data;
}

/* ---------- typed shortcuts ---------- */

export const useClients = () => useCollection('clients', ClientSchema);
export const useTasksAll = (filters: Filter[] = []) => useCollection('tasks', TaskSchema, filters);
export const useJobs = (filters: Filter[] = []) => useCollection('jobs', JobSchema, filters);
export const useInvoices = (filters: Filter[] = []) => useCollection('invoices', InvoiceSchema, filters);
export const useExpenses = (filters: Filter[] = []) => useCollection('expenses', ExpenseSchema, filters);
export const useSubscriptions = () => useCollection('subscriptions', SubscriptionSchema);
export const useInbox = () => useCollection('inbox', InboxItemSchema);
export const useVaultEntries = (filters: Filter[] = []) => useCollection('vault', VaultEntrySchema, filters);

export function useIssuer(): IssuerSettings | null {
  const raw = useDocData('settings', 'issuer');
  return useMemo(() => (raw === undefined ? null : IssuerSettingsSchema.parse(raw ?? {})), [raw]);
}

export function useGoogleSettings(): GoogleSettings | null {
  const raw = useDocData('settings', 'google');
  return useMemo(() => (raw === undefined ? null : GoogleSettingsSchema.parse(raw ?? {})), [raw]);
}

export function useVaultMeta() {
  const raw = useDocData('settings', 'vault');
  return useMemo(() => {
    if (raw === undefined) return undefined; // loading
    if (raw === null) return null; // not set up
    const p = VaultMetaSchema.safeParse(raw);
    return p.success ? p.data : null;
  }, [raw]);
}

export function useClientMap(clients: Client[] | null) {
  return useMemo(() => new Map((clients ?? []).map((c) => [c.id, c])), [clients]);
}

/** Run an action with a toast on error; returns the result or null. */
export async function act<T = unknown>(name: string, input: unknown, success?: string): Promise<T | null> {
  try {
    const r = await callAction<T>(name, input);
    if (success) toast(success);
    return r;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Algo ha fallado');
    return null;
  }
}
