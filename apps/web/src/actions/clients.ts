import { z } from 'zod';
import { ClientSchema, CreateClientInput, DEFAULT_CLIENT_MODULES, UpdateClientInput, type Client } from '@bos/schemas';
import { parseDoc } from '@/lib/convert';
import { slugify } from '@/lib/ids';
import type { TxLike } from '@/data/db';
import { ActionError, baseFields, clean, defineAction, type ActionContext } from './define';

export async function loadClient(ctx: ActionContext, tx: TxLike, id: string): Promise<Client> {
  const snap = await tx.get(ctx.col('clients').doc(id));
  const c = snap.exists ? parseDoc(ClientSchema, snap.id, snap.data() ?? {}) : null;
  if (!c) throw new ActionError('El cliente no existe.');
  return c;
}

export const createClient = defineAction({
  name: 'client.create',
  description: 'Crea un cliente nuevo.',
  input: CreateClientInput,
  critical: false,
  handler: async (ctx, input) => {
    const wanted = input.id ?? (slugify(input.name) || 'cliente');
    return ctx.db.runTransaction(async (tx) => {
      // Find a free id: city-hall, city-hall-2, …
      let id = wanted;
      for (let n = 2; (await tx.get(ctx.col('clients').doc(id))).exists; n++) id = `${wanted}-${n}`;
      const doc = ClientSchema.parse({
        ...baseFields(ctx, id),
        createdAt: ctx.now.toISOString(),
        updatedAt: ctx.now.toISOString(),
        ...clean(input),
        id,
        shortName: input.shortName || input.name.toUpperCase().slice(0, 24),
        modules: input.modules ?? [...DEFAULT_CLIENT_MODULES],
      });
      tx.set(ctx.col('clients').doc(id), clean({ ...doc, createdAt: ctx.now, updatedAt: ctx.now }));
      ctx.log(tx, { action: 'client.create', entity: { kind: 'client', id }, summary: `Cliente creado: ${input.name}` });
      return { id };
    });
  },
});

export const updateClient = defineAction({
  name: 'client.update',
  description: 'Edita los datos de un cliente (ficha, facturación, enlaces, módulos).',
  input: UpdateClientInput,
  critical: false,
  handler: async (ctx, { id, patch }) => {
    await ctx.db.runTransaction(async (tx) => {
      const cur = await loadClient(ctx, tx, id);
      const next: Record<string, unknown> = clean({ ...patch });
      if (patch.billing) next.billing = { ...cur.billing, ...clean(patch.billing) };
      tx.update(ctx.col('clients').doc(id), { ...next, updatedAt: ctx.now });
      const keys = Object.keys(next);
      const labels: Record<string, string> = { links: 'Enlaces', modules: 'Módulos', notes: 'Notas', billing: 'Facturación', name: 'Nombre' };
      ctx.log(tx, { action: 'client.update', entity: { kind: 'client', id }, summary: `${keys.map((k) => labels[k] ?? k).join(', ')} actualizado` });
    });
    return { id };
  },
});

const IdInput = z.object({ id: z.string() });

export const archiveClient = defineAction({
  name: 'client.archive',
  description: 'Archiva un cliente (deja de verse, se conserva todo).',
  input: IdInput,
  critical: false,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const c = await loadClient(ctx, tx, id);
      tx.update(ctx.col('clients').doc(id), { status: 'archived', updatedAt: ctx.now });
      ctx.log(tx, { action: 'client.archive', entity: { kind: 'client', id }, summary: `Cliente archivado: ${c.name}` });
    });
    return { id };
  },
});

export const unarchiveClient = defineAction({
  name: 'client.unarchive',
  description: 'Recupera un cliente archivado.',
  input: IdInput,
  critical: false,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const c = await loadClient(ctx, tx, id);
      tx.update(ctx.col('clients').doc(id), { status: 'active', updatedAt: ctx.now });
      ctx.log(tx, { action: 'client.unarchive', entity: { kind: 'client', id }, summary: `Cliente recuperado: ${c.name}` });
    });
    return { id };
  },
});

export const clientActions = [createClient, updateClient, archiveClient, unarchiveClient];
