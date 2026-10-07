import { Suspense } from 'react';
import { BillingView } from '@/features/billing/BillingView';

export default function Page() {
  return (
    <Suspense>
      <BillingView />
    </Suspense>
  );
}
