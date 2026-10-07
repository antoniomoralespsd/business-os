import type { AiExtraction, Client, ID, InboxProposal } from '@bos/schemas';
import { normalizeTaxId } from './classify';

const g = <T>(value: T | null, confidence: number, reason: string) => ({ value, confidence: value === null ? 0 : confidence, reason: value === null ? '' : reason });
const cents = (euros: number | null) => (euros === null || !Number.isFinite(euros) ? null : Math.round(Math.abs(euros) * 100));
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();

/**
 * Combines the AI reading with the rule-based proposal. The AI wins on what it read off the page
 * (amounts, VAT, dates, names); folder hints and your NIF still decide income vs expense.
 */
export function mergeAiExtraction(
  rules: InboxProposal,
  ai: AiExtraction,
  ctx: { ownTaxId: string; clients: readonly Pick<Client, 'id' | 'name' | 'legalName' | 'taxId' | 'aliases' | 'status'>[]; folderKind: 'income' | 'expense' | null },
): InboxProposal {
  const AI = 'Leído con IA';
  const own = normalizeTaxId(ctx.ownTaxId || '');
  const issuerTax = ai.issuerTaxId ? normalizeTaxId(ai.issuerTaxId) : null;
  const customerTax = ai.customerTaxId ? normalizeTaxId(ai.customerTaxId) : null;

  let kind = rules.kind;
  if (!ctx.folderKind) {
    if (own && issuerTax === own) kind = g('income' as const, 0.95, 'Tú eres el emisor');
    else if (['social_security', 'tax_payment', 'receipt', 'simplified_invoice'].includes(ai.documentType)) kind = g('expense' as const, 0.9, 'Recibo o ticket de compra');
    else if (ai.documentType === 'invoice' && own && customerTax === own) kind = g('expense' as const, 0.95, 'Factura a tu nombre');
    else if (ai.documentType === 'other' && rules.kind.confidence < 0.6) kind = g('other' as const, 0.6, 'No parece una factura');
  }
  const isIncome = kind.value === 'income';

  // The other party: customer on your invoices, issuer on what you pay.
  const otherName = isIncome ? ai.customerName : ai.issuerName;
  const otherTax = isIncome ? customerTax : issuerTax;
  let clientId = rules.clientId;
  if (isIncome && (otherTax || otherName)) {
    const active = ctx.clients.filter((c) => c.status !== 'archived');
    const byTax = otherTax ? active.find((c) => c.taxId && normalizeTaxId(c.taxId) === otherTax) : undefined;
    const byName = !byTax && otherName ? active.find((c) => [c.name, c.legalName, ...c.aliases].some((n) => n && n.length >= 3 && norm(otherName).includes(norm(n)))) : undefined;
    const hit = byTax ?? byName;
    if (hit) clientId = g<ID>(hit.id, byTax ? 0.95 : 0.8, byTax ? `NIF de ${hit.name}` : `Aparece «${hit.name}»`);
  }

  const total = cents(ai.total);
  const base = cents(ai.base);
  let vatRate: number | null = ai.vatRate !== null && [0, 4, 5, 10, 21].includes(Math.round(ai.vatRate)) ? Math.round(ai.vatRate) : null;
  if (vatRate === null && base && ai.vatAmount !== null) {
    const r = Math.round((Math.abs(ai.vatAmount) * 100 * 100) / base);
    vatRate = [0, 4, 5, 10, 21].find((v) => Math.abs(v - r) <= 1) ?? null;
  }
  if (['social_security', 'tax_payment'].includes(ai.documentType)) vatRate = 0;

  return {
    ...rules,
    kind,
    date: ai.date ? g(ai.date, 0.92, AI) : rules.date,
    vendor: !isIncome && ai.issuerName ? g(ai.issuerName, 0.9, AI) : rules.vendor,
    taxId: otherTax ? g(otherTax, 0.9, AI) : rules.taxId,
    invoiceNumber: ai.invoiceNumber && !(rules.invoiceNumber.confidence >= 0.95) ? g(ai.invoiceNumber, 0.9, AI) : rules.invoiceNumber,
    total: total !== null ? g(total, 0.93, AI) : rules.total,
    base: base !== null ? g(base, 0.9, AI) : rules.base,
    vatRate: vatRate !== null ? g(vatRate, 0.92, AI) : rules.vatRate,
    irpfRate: isIncome && ai.irpfRate !== null ? g(Math.round(ai.irpfRate), 0.9, AI) : rules.irpfRate,
    clientId,
    category: !isIncome && kind.value === 'expense' ? g(ai.category, 0.85, AI) : rules.category,
    counterparty: otherName ? g(otherName, 0.9, AI) : rules.counterparty,
    rectificativa: rules.rectificativa || ai.isRectificativa,
  };
}
