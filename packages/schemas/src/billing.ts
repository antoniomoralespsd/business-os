import { z } from 'zod';
import { BaseDocSchema, CentsSchema, IdSchema, ISODateSchema, InstantSchema } from './common';

/* ===================== Jobs (trabajos realizados, facturables) ===================== */

export const JobSchema = BaseDocSchema.extend({
  clientId: IdSchema,
  date: ISODateSchema,
  concept: z.string().min(1).max(200),
  quantity: z.number().positive().max(10_000),
  unitPrice: CentsSchema,
  /** null = pendiente de facturar */
  invoiceId: IdSchema.nullable(),
  taskId: IdSchema.nullable().default(null),
  archived: z.boolean().default(false),
});
export type Job = z.infer<typeof JobSchema>;

export const JobInput = z.object({
  clientId: IdSchema,
  date: ISODateSchema,
  concept: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(10_000).default(1),
  unitPrice: CentsSchema,
  taskId: IdSchema.nullable().optional(),
});
export const UpdateJobInput = z.object({ id: IdSchema, patch: JobInput.omit({ clientId: true }).partial() });

/* ===================== Invoices (facturas emitidas) ===================== */

export const INVOICE_STATUSES = ['draft', 'issued', 'sent', 'paid', 'cancelled'] as const;
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const InvoiceLineSchema = z.object({
  jobId: IdSchema.nullable().default(null),
  date: ISODateSchema.nullable().default(null),
  concept: z.string().min(1).max(300),
  quantity: z.number().positive(),
  unitPrice: CentsSchema,
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const PartySnapshotSchema = z.object({
  name: z.string(),
  legalName: z.string().default(''),
  taxId: z.string().default(''),
  address: z.string().default(''),
  email: z.string().default(''),
});
export type PartySnapshot = z.infer<typeof PartySnapshotSchema>;

export const InvoiceSchema = BaseDocSchema.extend({
  series: z.string().default(''),
  /** Assigned when issued. */
  number: z.number().int().nullable(),
  invoiceNumber: z.string().nullable(),
  clientId: IdSchema,
  client: PartySnapshotSchema,
  issuer: PartySnapshotSchema.nullable().default(null),
  date: ISODateSchema,
  dueDate: ISODateSchema,
  lines: z.array(InvoiceLineSchema),
  vatRate: z.number(),
  irpfRate: z.number(),
  subtotal: CentsSchema,
  tax: CentsSchema,
  withholding: CentsSchema,
  total: CentsSchema,
  status: InvoiceStatusSchema,
  sentAt: InstantSchema.nullable().default(null),
  paidAt: ISODateSchema.nullable().default(null),
  notes: z.string().default(''),
  /** Created from an uploaded document instead of generated here. */
  external: z.boolean().default(false),
  fileId: IdSchema.nullable().default(null),
  archived: z.boolean().default(false),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const DraftInvoiceInput = z.object({
  clientId: IdSchema,
  date: ISODateSchema,
  jobIds: z.array(IdSchema).max(200).default([]),
  lines: z.array(InvoiceLineSchema).max(200).default([]),
  notes: z.string().max(2000).optional(),
});
export const UpdateInvoiceInput = z.object({
  id: IdSchema,
  patch: z
    .object({
      date: ISODateSchema,
      dueDate: ISODateSchema,
      lines: z.array(InvoiceLineSchema).min(1).max(200),
      vatRate: z.number().min(0).max(100),
      irpfRate: z.number().min(0).max(100),
      notes: z.string().max(2000),
    })
    .partial(),
});
export const ExternalInvoiceInput = z.object({
  clientId: IdSchema,
  invoiceNumber: z.string().trim().min(1).max(40),
  date: ISODateSchema,
  subtotal: CentsSchema,
  vatRate: z.number().min(0).max(100),
  irpfRate: z.number().min(0).max(100),
  concept: z.string().trim().min(1).max(300),
  paid: z.boolean().default(false),
  fileId: IdSchema.nullable().default(null),
});

/* ===================== Expenses (gastos) ===================== */

export const EXPENSE_CATEGORIES = ['software', 'hardware', 'material', 'impresion', 'transporte', 'formacion', 'telefono', 'gestoria', 'publicidad', 'comidas', 'otros'] as const;
export const ExpenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;

export const ExpenseSchema = BaseDocSchema.extend({
  date: ISODateSchema,
  vendor: z.string().min(1).max(120),
  vendorTaxId: z.string().default(''),
  concept: z.string().default(''),
  invoiceNumber: z.string().default(''),
  category: ExpenseCategorySchema,
  base: CentsSchema,
  vatRate: z.number(),
  vat: CentsSchema,
  total: CentsSchema,
  deductible: z.boolean(),
  /** pending = falta el documento / por revisar */
  status: z.enum(['pending', 'confirmed']),
  subscriptionId: IdSchema.nullable().default(null),
  clientId: IdSchema.nullable().default(null),
  fileId: IdSchema.nullable().default(null),
  notes: z.string().default(''),
  archived: z.boolean().default(false),
});
export type Expense = z.infer<typeof ExpenseSchema>;

export const ExpenseInput = z.object({
  date: ISODateSchema,
  vendor: z.string().trim().min(1).max(120),
  vendorTaxId: z.string().max(32).optional(),
  concept: z.string().max(300).optional(),
  invoiceNumber: z.string().max(60).optional(),
  category: ExpenseCategorySchema,
  total: CentsSchema,
  vatRate: z.number().min(0).max(100),
  deductible: z.boolean().default(true),
  status: z.enum(['pending', 'confirmed']).optional(),
  subscriptionId: IdSchema.nullable().optional(),
  clientId: IdSchema.nullable().optional(),
  fileId: IdSchema.nullable().optional(),
  notes: z.string().max(2000).optional(),
});
export const UpdateExpenseInput = z.object({ id: IdSchema, patch: ExpenseInput.partial() });

/* ===================== Subscriptions ===================== */

export const BILLING_CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'paused', 'cancelled'] as const;
export const SUBSCRIPTION_CATEGORIES = ['software', 'almacenamiento', 'dominio', 'hosting', 'musica', 'ia', 'streaming', 'telefono', 'otros'] as const;

export const SubscriptionSchema = BaseDocSchema.extend({
  name: z.string().min(1).max(120),
  vendor: z.string().max(120).default(''),
  category: z.enum(SUBSCRIPTION_CATEGORIES),
  plan: z.string().default(''),
  /** Per cycle, VAT included. */
  amount: CentsSchema,
  vatRate: z.number().default(21),
  currency: z.enum(['EUR', 'USD', 'GBP']).default('EUR'),
  cycle: z.enum(BILLING_CYCLES),
  startDate: ISODateSchema.nullable().default(null),
  nextRenewalDate: ISODateSchema.nullable(),
  endDate: ISODateSchema.nullable().default(null),
  autoRenew: z.boolean().default(true),
  status: z.enum(SUBSCRIPTION_STATUSES),
  remindDaysBefore: z.number().int().min(0).max(90).default(7),
  account: z.string().default(''),
  paymentLabel: z.string().default(''),
  manageUrl: z.string().default(''),
  deductible: z.boolean().default(true),
  notes: z.string().default(''),
  lastChargeDate: ISODateSchema.nullable().default(null),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type BillingCycle = Subscription['cycle'];

export const SubscriptionInput = z.object({
  name: z.string().trim().min(1).max(120),
  vendor: z.string().max(120).optional(),
  category: z.enum(SUBSCRIPTION_CATEGORIES),
  plan: z.string().max(120).optional(),
  amount: CentsSchema,
  vatRate: z.number().min(0).max(100).optional(),
  currency: z.enum(['EUR', 'USD', 'GBP']).optional(),
  cycle: z.enum(BILLING_CYCLES),
  startDate: ISODateSchema.nullable().optional(),
  nextRenewalDate: ISODateSchema.nullable(),
  endDate: ISODateSchema.nullable().optional(),
  autoRenew: z.boolean().optional(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  remindDaysBefore: z.number().int().min(0).max(90).optional(),
  account: z.string().max(160).optional(),
  paymentLabel: z.string().max(60).optional(),
  manageUrl: z.string().max(2000).optional(),
  deductible: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
});
export const UpdateSubscriptionInput = z.object({ id: IdSchema, patch: SubscriptionInput.partial() });

/* ===================== Issuer settings (tus datos fiscales) ===================== */

export const IssuerSettingsSchema = z.object({
  name: z.string().default(''),
  legalName: z.string().default(''),
  taxId: z.string().default(''),
  address: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  iban: z.string().default(''),
  series: z.string().default(''),
  /** Next invoice number per year, e.g. { "2026": 85 } */
  nextNumber: z.record(z.string(), z.number().int().min(1)).default({}),
  defaultVat: z.number().default(21),
  defaultIrpf: z.number().default(15),
  paymentNote: z.string().default(''),
});
export type IssuerSettings = z.infer<typeof IssuerSettingsSchema>;
export const IssuerSettingsInput = IssuerSettingsSchema.partial();
