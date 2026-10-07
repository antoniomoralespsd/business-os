import { z } from 'zod';
import { BaseDocSchema, CentsSchema } from './common';

export const CLIENT_STATUSES = ['active', 'potential', 'paused', 'archived'] as const;
export const ClientStatusSchema = z.enum(CLIENT_STATUSES);
export type ClientStatus = z.infer<typeof ClientStatusSchema>;

export const LINK_KINDS = ['drive', 'dropbox', 'wetransfer', 'instagram', 'web', 'figma', 'other'] as const;
export const ClientLinkSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80),
  url: z.string().url().max(2000),
  kind: z.enum(LINK_KINDS).default('other'),
});
export type ClientLink = z.infer<typeof ClientLinkSchema>;

export const ClientBillingSchema = z.object({
  /** Usual price per piece, in cents. */
  defaultRate: CentsSchema.nullable().default(null),
  vatRate: z.number().min(0).max(100).default(21),
  irpfRate: z.number().min(0).max(100).default(15),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  defaultConcept: z.string().max(200).default(''),
});
export type ClientBilling = z.infer<typeof ClientBillingSchema>;

/**
 * Client modules: each client "folder" is a small system made of modules.
 * The registry of available modules lives in the web app; this list only says
 * which ones are enabled for this client and in which order.
 */
export const DEFAULT_CLIENT_MODULES = ['overview', 'tasks', 'jobs', 'invoices', 'links', 'vault', 'notes', 'details'] as const;

export const ClientSchema = BaseDocSchema.extend({
  name: z.string().min(1).max(80),
  /** Short label shown on task cards, e.g. "CITY HALL". */
  shortName: z.string().max(24).optional(),
  /** Other ways the client is written: "CH", "city". Used by quick-add parsing and classification. */
  aliases: z.array(z.string()).default([]),
  color: z.string().default('ink'),
  status: ClientStatusSchema.default('active'),
  legalName: z.string().max(160).default(''),
  taxId: z.string().max(32).default(''),
  address: z.string().max(400).default(''),
  email: z.string().max(160).default(''),
  billingEmail: z.string().max(160).default(''),
  phone: z.string().max(40).default(''),
  contactName: z.string().max(120).default(''),
  notes: z.string().max(20_000).default(''),
  billing: ClientBillingSchema.default({}),
  links: z.array(ClientLinkSchema).default([]),
  modules: z.array(z.string()).default([...DEFAULT_CLIENT_MODULES]),
});
export type Client = z.infer<typeof ClientSchema>;

/* ---------- inputs ---------- */

export const ClientInput = z.object({
  name: z.string().trim().min(1).max(80),
  shortName: z.string().trim().max(24).optional(),
  aliases: z.array(z.string().trim().min(1)).max(20).optional(),
  color: z.string().max(20).optional(),
  status: ClientStatusSchema.optional(),
  legalName: z.string().max(160).optional(),
  taxId: z.string().max(32).optional(),
  address: z.string().max(400).optional(),
  email: z.string().max(160).optional(),
  billingEmail: z.string().max(160).optional(),
  phone: z.string().max(40).optional(),
  contactName: z.string().max(120).optional(),
  notes: z.string().max(20_000).optional(),
  billing: ClientBillingSchema.partial().optional(),
  links: z.array(ClientLinkSchema).max(100).optional(),
  modules: z.array(z.string()).max(30).optional(),
});
export type ClientInput = z.infer<typeof ClientInput>;

export const CreateClientInput = ClientInput.extend({ id: z.string().regex(/^[a-z0-9-]{2,48}$/).optional() });
export const UpdateClientInput = z.object({ id: z.string(), patch: ClientInput.partial() });
