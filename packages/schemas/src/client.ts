import { z } from 'zod';
import { BaseDocSchema } from './common';

export const CLIENT_STATUSES = ['active', 'potential', 'paused', 'archived'] as const;
export const ClientStatusSchema = z.enum(CLIENT_STATUSES);
export type ClientStatus = z.infer<typeof ClientStatusSchema>;

/**
 * Minimal Client used by Tasks. The full billing/files/work configuration
 * from the architecture doc (section D) is added when the Clients module is built.
 */
export const ClientSchema = BaseDocSchema.extend({
  name: z.string().min(1).max(80),
  /** Short label shown on task cards, e.g. "CITY HALL". Defaults to name upper-cased. */
  shortName: z.string().max(24).optional(),
  /** Other ways the client is written: "CH", "cityhall". Used by quick-add parsing and future rules. */
  aliases: z.array(z.string()).default([]),
  /** Visual identifier: one of the palette keys in the design system. */
  color: z.string().default('ink'),
  status: ClientStatusSchema.default('active'),
});
export type Client = z.infer<typeof ClientSchema>;
