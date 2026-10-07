import { z } from 'zod';
import { AlbaranSchema, ISODateSchema, SyncAlbaranesInput } from '@bos/schemas';
import { formatEUR } from '@bos/domain';
import { parseDoc } from '@/lib/convert';
import { ActionError, baseFields, clean, defineAction } from './define';

/** Upserts albaranes read from Drive (by file id). Never overwrites status, number or notes. */
export const syncAlbaranes = defineAction({
  name: 'albaran.sync',
  description: 'Registra o actualiza los albaranes leídos de la carpeta 02 - ALBARANES.',
  input: SyncAlbaranesInput,
  critical: false,
  handler: async (ctx, { items }) => {
    let created = 0;
    let updated = 0;
    await ctx.db.runTransaction(async (tx) => {
      const existing = await tx.getQuery(ctx.col('albaranes'));
      const byFile = new Map(existing.docs.map((d) => [String((d.data() ?? {}).driveFileId), d.id]));
      for (const it of items) {
        const id = byFile.get(it.driveFileId);
        if (id) {
          tx.update(ctx.col('albaranes').doc(id), { ...clean(it), updatedAt: ctx.now });
          updated++;
        } else {
          const ref = ctx.col('albaranes').doc();
          tx.set(ref, { ...baseFields(ctx, ref.id), ...clean(it), number: null, status: 'pending', paidAt: null, notes: '', archived: false });
          created++;
        }
      }
      ctx.log(tx, { action: 'albaran.sync', entity: { kind: 'albaran', id: 'all' }, summary: `Albaranes desde Drive: ${created} nuevos, ${updated} actualizados` });
    });
    return { created, updated };
  },
});

/** Numbers albaranes by date (oldest = 1). Already numbered ones keep their number; new ones continue the series. */
export const numberAlbaranes = defineAction({
  name: 'albaran.number',
  description: 'Numera los albaranes por fecha.',
  input: z.object({ restart: z.boolean().default(false) }),
  critical: false,
  handler: async (ctx, { restart }) => {
    return ctx.db.runTransaction(async (tx) => {
      const all = (await tx.getQuery(ctx.col('albaranes'))).docs.map((d) => parseDoc(AlbaranSchema, d.id, d.data() ?? {})).filter((a): a is NonNullable<typeof a> => !!a);
      const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
      let next = restart ? 1 : Math.max(0, ...all.map((a) => a.number ?? 0)) + 1;
      const changes: { id: string; number: number }[] = [];
      for (const a of sorted) {
        if (!restart && a.number) continue;
        changes.push({ id: a.id, number: next++ });
      }
      for (const c of changes) tx.update(ctx.col('albaranes').doc(c.id), { number: c.number, updatedAt: ctx.now });
      ctx.log(tx, { action: 'albaran.number', entity: { kind: 'albaran', id: 'all' }, summary: `${changes.length} albaranes numerados por fecha` });
      return { numbered: changes };
    });
  },
});

export const updateAlbaran = defineAction({
  name: 'albaran.update',
  description: 'Marca un albarán como cobrado o pendiente, o cambia su nombre o notas.',
  input: z.object({
    id: z.string(),
    patch: z.object({
      status: z.enum(['pending', 'paid']).optional(),
      paidAt: ISODateSchema.nullable().optional(),
      notes: z.string().max(2000).optional(),
      driveName: z.string().max(300).optional(),
      archived: z.boolean().optional(),
    }),
  }),
  critical: false,
  handler: async (ctx, { id, patch }) => {
    await ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('albaranes').doc(id);
      const snap = await tx.get(ref);
      const a = snap.exists ? parseDoc(AlbaranSchema, id, snap.data() ?? {}) : null;
      if (!a) throw new ActionError('El albarán no existe.');
      const next = clean({ ...patch, ...(patch.status === 'paid' && patch.paidAt === undefined ? { paidAt: ctx.now.toISOString().slice(0, 10) } : {}), ...(patch.status === 'pending' ? { paidAt: null } : {}) });
      tx.update(ref, { ...next, updatedAt: ctx.now });
      const label = patch.status === 'paid' ? `cobrado (${formatEUR(a.total)})` : patch.status === 'pending' ? 'pendiente' : 'editado';
      ctx.log(tx, { action: 'albaran.update', entity: { kind: 'albaran', id }, summary: `Albarán ${a.number ?? ''} ${a.title}: ${label}` });
    });
    return { id };
  },
});

export const albaranActions = [syncAlbaranes, numberAlbaranes, updateAlbaran];
