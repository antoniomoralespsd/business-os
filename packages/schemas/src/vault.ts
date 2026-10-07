import { z } from 'zod';
import { BaseDocSchema, IdSchema } from './common';

/**
 * Password vault. Secrets are encrypted IN THE BROWSER (AES-GCM, key derived from a master
 * password with PBKDF2). The server and the database only ever see ciphertext.
 */
export const CipherSchema = z.object({ iv: z.string().min(8).max(64), data: z.string().min(1).max(20_000) });
export type Cipher = z.infer<typeof CipherSchema>;

export const VaultMetaSchema = z.object({
  salt: z.string().min(8).max(128),
  iterations: z.number().int().min(100_000),
  /** Encryption of a known string; lets us check the master password. */
  verifier: CipherSchema,
});
export type VaultMeta = z.infer<typeof VaultMetaSchema>;

export const VaultEntrySchema = BaseDocSchema.extend({
  clientId: IdSchema.nullable(),
  label: z.string().min(1).max(120),
  username: z.string().max(200).default(''),
  url: z.string().max(2000).default(''),
  secret: CipherSchema,
  /** Optional encrypted notes (recovery codes, PINs). */
  notes: CipherSchema.nullable().default(null),
  archived: z.boolean().default(false),
});
export type VaultEntry = z.infer<typeof VaultEntrySchema>;

export const VaultEntryInput = z.object({
  clientId: IdSchema.nullable(),
  label: z.string().trim().min(1).max(120),
  username: z.string().max(200).default(''),
  url: z.string().max(2000).default(''),
  secret: CipherSchema,
  notes: CipherSchema.nullable().default(null),
});
export const UpdateVaultEntryInput = z.object({ id: IdSchema, patch: VaultEntryInput.omit({ clientId: true }).partial() });
