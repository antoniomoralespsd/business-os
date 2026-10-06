import { z } from 'zod';

/** Document id (Firestore auto-id or slug). */
export const IdSchema = z.string().min(1).max(128);
export type ID = z.infer<typeof IdSchema>;

/** Business date in Europe/Madrid, always 'YYYY-MM-DD'. Never a Timestamp. */
export const ISODateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
export type ISODate = z.infer<typeof ISODateSchema>;

/** Instant in time, serialized as ISO-8601 string at the API boundary (Firestore Timestamp in storage). */
export const InstantSchema = z.string().datetime({ offset: true });
export type Instant = z.infer<typeof InstantSchema>;

/** Money is always integer cents. 49,99 € = 4999. */
export const CentsSchema = z.number().int();
export type Cents = z.infer<typeof CentsSchema>;

export const SOURCES = ['web', 'mobile', 'gmail', 'asana', 'whatsapp', 'manual', 'api'] as const;
export const SourceSchema = z.enum(SOURCES);
export type Source = z.infer<typeof SourceSchema>;

export const ActorSchema = z.object({
  type: z.enum(['user', 'rule', 'ai', 'system']),
  id: z.string(),
});
export type Actor = z.infer<typeof ActorSchema>;

/** Fields every stored document carries. Timestamps serialized as ISO strings outside Firestore. */
export const BaseDocSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  createdBy: z.string(),
});
export type BaseDoc = z.infer<typeof BaseDocSchema>;
