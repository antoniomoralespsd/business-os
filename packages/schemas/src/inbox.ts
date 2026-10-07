import { z } from 'zod';
import { BaseDocSchema, CentsSchema, IdSchema, ISODateSchema } from './common';

export const INBOX_KINDS = ['expense', 'income', 'other'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** A guessed value with how sure we are (0–1) and why. */
export const GuessSchema = <T extends z.ZodTypeAny>(t: T) =>
  z.object({ value: t.nullable(), confidence: z.number().min(0).max(1), reason: z.string().default('') });

export const InboxProposalSchema = z.object({
  kind: GuessSchema(z.enum(INBOX_KINDS)),
  date: GuessSchema(ISODateSchema),
  vendor: GuessSchema(z.string()),
  taxId: GuessSchema(z.string()),
  invoiceNumber: GuessSchema(z.string()),
  total: GuessSchema(z.number().int()),
  base: GuessSchema(z.number().int()),
  vatRate: GuessSchema(z.number()),
  irpfRate: GuessSchema(z.number()),
  clientId: GuessSchema(IdSchema),
  category: GuessSchema(z.string()),
  subscriptionId: GuessSchema(IdSchema),
});
export type InboxProposal = z.infer<typeof InboxProposalSchema>;

export const InboxItemSchema = BaseDocSchema.extend({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  /** Where the file lives (Firebase Storage path) or null if it could not be stored yet. */
  storagePath: z.string().nullable(),
  textExcerpt: z.string().default(''),
  status: z.enum(['needs_confirmation', 'completed', 'discarded']),
  proposal: InboxProposalSchema,
  result: z.object({ kind: z.enum(['expense', 'income', 'none']), id: z.string().nullable() }).nullable().default(null),
  duplicateOf: z.string().nullable().default(null),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const CreateInboxItemInput = z.object({
  filename: z.string().min(1).max(260),
  mimeType: z.string().max(120),
  size: z.number().int().min(0),
  sha256: z.string().length(64),
  storagePath: z.string().nullable(),
  textExcerpt: z.string().max(20_000).default(''),
  proposal: InboxProposalSchema,
});

export const ConfirmInboxInput = z.object({
  id: IdSchema,
  kind: z.enum(['expense', 'income', 'other']),
  date: ISODateSchema,
  vendor: z.string().trim().max(120).default(''),
  taxId: z.string().max(32).default(''),
  invoiceNumber: z.string().max(60).default(''),
  total: CentsSchema,
  vatRate: z.number().min(0).max(100),
  irpfRate: z.number().min(0).max(100).default(0),
  clientId: IdSchema.nullable().default(null),
  category: z.string().default('otros'),
  subscriptionId: IdSchema.nullable().default(null),
  concept: z.string().max(300).default(''),
});
