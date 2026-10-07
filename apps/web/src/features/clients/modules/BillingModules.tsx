'use client';
import { useState } from 'react';
import { InvoiceSheet } from '@/features/billing/InvoiceSheet';
import { InvoicesPanel } from '@/features/billing/InvoicesPanel';
import { JobsPanel } from '@/features/billing/JobsPanel';
import type { ClientModuleProps } from './registry';

export function JobsModule({ client }: ClientModuleProps) {
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  return (
    <>
      <JobsPanel clientId={client.id} onInvoiceCreated={setInvoiceId} />
      <InvoiceSheet invoiceId={invoiceId} onClose={() => setInvoiceId(null)} />
    </>
  );
}

export function InvoicesModule({ client }: ClientModuleProps) {
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  return (
    <>
      <InvoicesPanel clientId={client.id} onOpen={setInvoiceId} />
      <InvoiceSheet invoiceId={invoiceId} onClose={() => setInvoiceId(null)} />
    </>
  );
}
