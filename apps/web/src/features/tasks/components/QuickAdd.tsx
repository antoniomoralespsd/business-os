'use client';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** "+ Añadir tarea" that turns into an inline input. Enter creates and keeps the input open for the next one. */
export function QuickAdd({ onCreate, compact }: { onCreate: (text: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-[12.5px] text-ink-3 transition-colors hover:bg-surface/70 hover:text-ink ${compact ? '' : 'mt-0.5'}`}
      >
        <Plus size={13} /> Añadir tarea
      </button>
    );
  }
  return (
    <div className="rounded-[8px] border border-ink bg-surface px-2 py-1.5 shadow-[var(--shadow-card)]">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onCreate(value.trim());
            setValue('');
          }
          if (e.key === 'Escape') {
            setValue('');
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (value.trim()) onCreate(value.trim());
          setValue('');
          setOpen(false);
        }}
        placeholder="Flyer Halloween City Hall"
        className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-ink-3"
        aria-label="Título de la nueva tarea"
      />
      <p className="mt-1 text-[10.5px] text-ink-3">Enter para crear · el cliente se detecta solo</p>
    </div>
  );
}
