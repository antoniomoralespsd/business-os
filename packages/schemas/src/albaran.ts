import { z } from 'zod';
import { BaseDocSchema, CentsSchema, IdSchema, ISODateSchema } from './common';

/**
 * Albaranes: delivery notes kept as Google Sheets in 02 - ALBARANES. Tracked apart from invoices:
 * they never enter the quarterly figures (only invoices do).
 */
export const AlbaranSchema = BaseDocSchema.extend({
  number: z.number().int().min(1).nullable().default(null),
  date: ISODateSchema,
  title: z.string().max(300),
  recipients: z.array(z.string().max(120)).max(20).default([]),
  clientIds: z.array(IdSchema).max(20).default([]),
  lines: z.number().int().min(0).default(0),
  total: CentsSchema,
  status: z.enum(['pending', 'paid']).default('pending'),
  paidAt: ISODateSchema.nullable().default(null),
  driveFileId: z.string().max(200),
  driveName: z.string().max(300),
  notes: z.string().max(2000).default(''),
  archived: z.boolean().default(false),
});
export type Albaran = z.infer<typeof AlbaranSchema>;

export const SyncAlbaranesInput = z.object({
  items: z
    .array(
      z.object({
        driveFileId: z.string().min(1).max(200),
        driveName: z.string().max(300),
        title: z.string().max(300),
        date: ISODateSchema,
        recipients: z.array(z.string().max(120)).max(20).default([]),
        clientIds: z.array(IdSchema).max(20).default([]),
        lines: z.number().int().min(0).default(0),
        total: CentsSchema,
      }),
    )
    .max(500),
});
