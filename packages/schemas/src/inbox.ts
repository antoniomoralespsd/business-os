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
  /** Name of the other party as written in the document (client on income, vendor on expenses). */
  counterparty: GuessSchema(z.string()).default({ value: null, confidence: 0, reason: '' }),
  /** Corrective invoice: amounts are subtracted. */
  rectificativa: z.boolean().default(false),
});
export type InboxProposal = z.infer<typeof InboxProposalSchema>;

/** Where the file lives in Google Drive. */
export const DriveRefSchema = z.object({
  account: z.string().email(),
  fileId: z.string().min(1).max(200),
  name: z.string().max(300),
  folder: z.string().max(400).default(''),
  folderId: z.string().max(200).default(''),
  webViewLink: z.string().url().max(600),
  /** Already in its final folder. */
  filed: z.boolean().default(false),
  /** Keep the original name when filing (files that were already in your Drive, your own invoices). */
  keepName: z.boolean().default(false),
});
export type DriveRef = z.infer<typeof DriveRefSchema>;

export const InboxItemSchema = BaseDocSchema.extend({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  /** Where the file lives (Firebase Storage path) or null if it could not be stored yet. */
  storagePath: z.string().nullable(),
  textExcerpt: z.string().default(''),
  /** Folder path it came in (e.g. "2026/03 MARZO/Ingresos/f.pdf"). */
  sourcePath: z.string().default(''),
  drive: DriveRefSchema.nullable().default(null),
  /** What it was confirmed as (used to file it in the right Drive folder). */
  filedAs: z.object({ date: ISODateSchema, kind: z.enum(INBOX_KINDS), rectificativa: z.boolean(), name: z.string() }).nullable().default(null),
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
  storagePath: z.string().nullable().default(null),
  sourcePath: z.string().max(500).default(''),
  textExcerpt: z.string().max(20_000).default(''),
  proposal: InboxProposalSchema,
});

export const AttachDriveInput = z.object({ id: IdSchema, drive: DriveRefSchema });
export const UpdateProposalsInput = z.object({ items: z.array(z.object({ id: IdSchema, proposal: InboxProposalSchema, textExcerpt: z.string().max(4000).optional() })).min(1).max(300) });

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
  /** The user typed the name by hand: remember the label for this vendor. Never learned otherwise. */
  nameEdited: z.boolean().default(false),
  rectificativa: z.boolean().default(false),
  /** Income already collected (old invoices). */
  paid: z.boolean().default(false),
  /** Create the client from the invoice data (reused if a client with that NIF already exists). */
  newClient: z.object({ name: z.string().trim().min(1).max(120), taxId: z.string().max(32).default(''), legalName: z.string().max(160).default('') }).nullable().default(null),
});

/** Your agency folder in Drive and its numbered subfolders. */
export const DriveLayoutSchema = z.object({
  rootId: z.string().min(1).max(200),
  rootName: z.string().max(200),
  yearsId: z.string().max(200).nullable().default(null),
  editablesId: z.string().max(200).nullable().default(null),
  albaranesId: z.string().max(200).nullable().default(null),
  rectificativasId: z.string().max(200).nullable().default(null),
});
export type DriveLayout = z.infer<typeof DriveLayoutSchema>;

/** Google accounts connected for Drive (no tokens: those stay in the browser). */
export const GoogleSettingsSchema = z.object({
  layout: DriveLayoutSchema.nullable().default(null),
  accounts: z.array(z.object({ email: z.string().email(), addedAt: z.string().default('') })).default([]),
  /** Account whose Drive keeps invoices and receipts. */
  billingAccount: z.string().email().nullable().default(null),
});
export type GoogleSettings = z.infer<typeof GoogleSettingsSchema>;

/** What the AI reads from a document (all optional: null when not printed). */
export const AiExtractionSchema = z.object({
  documentType: z.enum(['invoice', 'simplified_invoice', 'receipt', 'social_security', 'tax_payment', 'bank', 'other']).catch('other'),
  issuerName: z.string().nullable().catch(null),
  issuerTaxId: z.string().nullable().catch(null),
  customerName: z.string().nullable().catch(null),
  customerTaxId: z.string().nullable().catch(null),
  invoiceNumber: z.string().nullable().catch(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  total: z.number().nullable().catch(null),
  base: z.number().nullable().catch(null),
  vatRate: z.number().nullable().catch(null),
  vatAmount: z.number().nullable().catch(null),
  irpfRate: z.number().nullable().catch(null),
  isRectificativa: z.boolean().catch(false),
  category: z.enum(['software', 'hardware', 'material', 'impresion', 'transporte', 'formacion', 'telefono', 'gestoria', 'publicidad', 'comidas', 'otros']).catch('otros'),
  currency: z.string().nullable().catch('EUR'),
});
export type AiExtraction = z.infer<typeof AiExtractionSchema>;

/** Names learned from you: vendor key → label used in file names ("cosa rara" → "imprenta"). */
/** Labels you typed yourself (vendor key → word). The old auto-learned `labels` field is ignored on purpose. */
export const NamingSettingsSchema = z.object({ userLabels: z.record(z.string(), z.string()).default({}) });
export type NamingSettings = z.infer<typeof NamingSettingsSchema>;
