import { Suspense } from 'react';
import { ClientsView } from '@/features/clients/ClientsView';

export default function Page() {
  return (
    <Suspense>
      <ClientsView />
    </Suspense>
  );
}
