import { z } from 'zod';
import { CipherSchema, IssuerSettingsInput, UpdateVaultEntryInput, VaultEntryInput, VaultMetaSchema } from '@bos/schemas';
import { ActionError, baseFields, clean, defineAction } from './define';

export const updateIssuer = defineAction({
  name: 'settings.issuer',
  description: 'Guarda tus datos fiscales y la numeración de facturas.',
  input: IssuerSettingsInput,
  critical: false,
  handler: async (ctx, input) => {
    await ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('settings').doc('issuer');
      const cur = await tx.get(ref);
      tx.set(ref, { ...(cur.data() ?? {}), ...clean(input), updatedAt: ctx.now });
      ctx.log(tx, { action: 'settings.issuer', entity: { kind: 'settings', id: 'issuer' }, summary: 'Datos fiscales actualizados' });
    });
    return { ok: true };
  },
});

/* ---------- vault (only ciphertext ever reaches here) ---------- */

export const setupVault = defineAction({
  name: 'vault.setup',
  description: 'Crea la caja fuerte de contraseñas (la clave maestra nunca sale del navegador).',
  input: VaultMetaSchema,
  critical: false,
  handler: async (ctx, meta) => {
    await ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('settings').doc('vault');
      if ((await tx.get(ref)).exists) throw new ActionError('La caja fuerte ya está creada.');
      tx.set(ref, { ...meta, createdAt: ctx.now });
      ctx.log(tx, { action: 'vault.setup', entity: { kind: 'settings', id: 'vault' }, summary: 'Caja fuerte de contraseñas creada' });
    });
    return { ok: true };
  },
});

export const rekeyVault = defineAction({
  name: 'vault.rekey',
  description: 'Cambia la clave maestra: guarda el nuevo verificador y todos los accesos recifrados en el navegador.',
  input: z.object({ meta: VaultMetaSchema, entries: z.array(z.object({ id: z.string(), secret: CipherSchema, notes: CipherSchema.nullable() })).max(2000) }),
  critical: true,
  handler: async (ctx, { meta, entries }) => {
    await ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('settings').doc('vault');
      if (!(await tx.get(ref)).exists) throw new ActionError('La caja fuerte no existe.');
      const existing = await tx.getQuery(ctx.col('vault'));
      const ids = new Set(existing.docs.map((d) => d.id));
      if (entries.length !== ids.size || entries.some((e) => !ids.has(e.id))) throw new ActionError('Faltan accesos por recifrar. Vuelve a intentarlo.');
      tx.set(ref, { ...meta, updatedAt: ctx.now });
      for (const e of entries) tx.update(ctx.col('vault').doc(e.id), { secret: e.secret, notes: e.notes, updatedAt: ctx.now });
      ctx.log(tx, { action: 'vault.rekey', entity: { kind: 'settings', id: 'vault' }, summary: `Clave maestra cambiada (${entries.length} accesos recifrados)` });
    });
    return { ok: true };
  },
});

export const resetVault = defineAction({
  name: 'vault.reset',
  description: 'Borra la caja fuerte y TODAS las contraseñas guardadas (para cuando se olvida la clave maestra).',
  input: z.object({ confirm: z.literal('BORRAR') }),
  critical: true,
  handler: async (ctx) => {
    await ctx.db.runTransaction(async (tx) => {
      const entries = await tx.getQuery(ctx.col('vault'));
      tx.delete(ctx.col('settings').doc('vault'));
      for (const d of entries.docs) tx.delete(ctx.col('vault').doc(d.id));
      ctx.log(tx, { action: 'vault.reset', entity: { kind: 'settings', id: 'vault' }, summary: `Caja fuerte reiniciada (${entries.size} accesos borrados)` });
    });
    return { ok: true };
  },
});

export const createVaultEntry = defineAction({
  name: 'vault.create',
  description: 'Guarda un acceso cifrado.',
  input: VaultEntryInput,
  critical: false,
  handler: async (ctx, input) => {
    const ref = ctx.col('vault').doc();
    await ctx.db.runTransaction(async (tx) => {
      tx.set(ref, { ...baseFields(ctx, ref.id), ...input, archived: false });
      ctx.log(tx, { action: 'vault.create', entity: { kind: 'vault', id: ref.id }, summary: `Acceso guardado: ${input.label}` });
    });
    return { id: ref.id };
  },
});

export const updateVaultEntry = defineAction({
  name: 'vault.update',
  description: 'Edita un acceso cifrado.',
  input: UpdateVaultEntryInput,
  critical: false,
  handler: async (ctx, { id, patch }) => {
    await ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('vault').doc(id);
      if (!(await tx.get(ref)).exists) throw new ActionError('El acceso no existe.');
      tx.update(ref, { ...clean(patch), updatedAt: ctx.now });
      ctx.log(tx, { action: 'vault.update', entity: { kind: 'vault', id }, summary: 'Acceso editado' });
    });
    return { id };
  },
});

export const deleteVaultEntry = defineAction({
  name: 'vault.delete',
  description: 'Elimina un acceso guardado.',
  input: z.object({ id: z.string() }),
  critical: true,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      const ref = ctx.col('vault').doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ActionError('El acceso no existe.');
      tx.delete(ref);
      ctx.log(tx, { action: 'vault.delete', entity: { kind: 'vault', id }, summary: `Acceso eliminado: ${String((snap.data() ?? {}).label ?? '')}` });
    });
    return { id };
  },
});

/** Records that the vault was opened (who/when), without any secret. */
export const logVaultReveal = defineAction({
  name: 'vault.reveal',
  description: 'Registra que se ha mostrado una contraseña.',
  input: z.object({ id: z.string() }),
  critical: false,
  handler: async (ctx, { id }) => {
    await ctx.db.runTransaction(async (tx) => {
      ctx.log(tx, { action: 'vault.reveal', entity: { kind: 'vault', id }, summary: 'Contraseña mostrada' });
    });
    return { id };
  },
});

export const settingsActions = [updateIssuer, setupVault, rekeyVault, resetVault, createVaultEntry, updateVaultEntry, deleteVaultEntry, logVaultReveal];
