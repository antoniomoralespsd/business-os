import { Check, Clock3 } from 'lucide-react';
import type { TaskStatus } from '@bos/schemas';

/** 14px status glyph used on cards, menus and the drawer. */
export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const s = { width: size, height: size };
  switch (status) {
    case 'pending':
      return <span style={s} className="block rounded-full border-[1.5px] border-ink-3" />;
    case 'in_progress':
      return (
        <span style={s} className="relative block rounded-full border-[1.5px] border-ink">
          <span className="iris-bar absolute inset-[2px] rounded-full" />
        </span>
      );
    case 'changes_requested':
      return (
        <span style={s} className="grid place-items-center rounded-full border-[1.5px] border-changes text-[9px] font-bold leading-none text-changes">
          !
        </span>
      );
    case 'review':
      return <Clock3 style={s} className="text-ink-2" strokeWidth={2} />;
    case 'completed':
      return (
        <span style={s} className="grid place-items-center rounded-full bg-ink text-on-ink">
          <Check width={size - 5} height={size - 5} strokeWidth={3} />
        </span>
      );
  }
}
