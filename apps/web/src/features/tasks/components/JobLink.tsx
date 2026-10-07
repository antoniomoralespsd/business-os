'use client';
import { Receipt } from 'lucide-react';
import { useState } from 'react';
import type { Client, Task } from '@bos/schemas';
import { formatEUR, todayISO } from '@bos/domain';
import { MoneyInput } from '@/components/ui/kit';
import { act } from '@/data/hooks';

/** Links a task to billing: "this piece is billable work for the client". */
export function JobLink({ task, client }: { task: Task; client: Client | undefined }) {
  const [price, setPrice] = useState<number | null>(client?.billing.defaultRate ?? null);
  const [busy, setBusy] = useState(false);
  if (!client) return null;
  if (task.jobId) {
    return (
      <p className="mt-4 flex items-center gap-2 rounded-[8px] bg-ok/10 px-3 py-2 text-[12.5px] text-ok">
        <Receipt size={14} /> Registrado como trabajo facturable de {client.name}
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-line-strong px-3 py-2.5">
      <Receipt size={14} className="text-ink-3" />
      <span className="text-[12.5px] text-ink-2">¿Es trabajo facturable?</span>
      <MoneyInput value={price} onChange={setPrice} className="w-28" />
      <button
        type="button"
        disabled={busy || price === null}
        onClick={async () => {
          setBusy(true);
          await act('job.create', { clientId: client.id, date: task.dueDate ?? todayISO(), concept: task.title, quantity: 1, unitPrice: price, taskId: task.id }, `Trabajo registrado · ${formatEUR(price ?? 0)}`);
          setBusy(false);
        }}
        className="ml-auto rounded-[4px] bg-ink px-3 py-1.5 text-[12px] font-semibold text-on-ink disabled:opacity-50"
      >
        Registrar trabajo
      </button>
    </div>
  );
}
