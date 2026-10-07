import { Suspense } from 'react';
import { SubscriptionsView } from '@/features/subscriptions/SubscriptionsView';

export default function Page() {
  return (
    <Suspense>
      <SubscriptionsView />
    </Suspense>
  );
}
