'use client';
import * as Dialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { AlertTriangle, ChevronRight, Info, Loader2, OctagonAlert, X } from 'lucide-react';
import Link from 'next/link';
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { formatAmount, parseEuro, type Alert } from '@bos/domain';

/* ---------------- buttons ---------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    const pad = size === 'sm' ? 'px-2.5 py-1.5 text-[12px]' : 'px-3.5 py-2 text-[13px]';
    const styles: Record<Variant, string> = {
      primary: 'btn-primary',
      secondary: 'inline-flex items-center gap-2 rounded-[4px] border border-line bg-surface font-semibold text-ink hover:border-ink disabled:opacity-50',
      ghost: 'inline-flex items-center gap-2 rounded-[4px] font-semibold text-ink-2 hover:bg-surface-3 hover:text-ink disabled:opacity-50',
      danger: 'inline-flex items-center gap-2 rounded-[4px] border border-danger/40 font-semibold text-danger hover:bg-danger/5 disabled:opacity-50',
    };
    return (
      <button ref={ref} type="button" disabled={disabled || loading} className={clsx(styles[variant], pad, 'whitespace-nowrap transition-colors', className)} {...rest}>
        {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-ink-2 hover:bg-surface-3 hover:text-ink', className)} {...rest}>
      {children}
    </button>
  );
}

/* ---------------- form controls ---------------- */

const control = 'w-full rounded-[6px] border border-line bg-surface-2 px-2.5 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(control, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(control, 'resize-y leading-relaxed', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(control, 'pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="eyebrow mb-1.5 block text-ink-3">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-ink-3">{hint}</span>}
    </label>
  );
}

/** Euro amount input: shows "1.234,56", stores cents. */
export function MoneyInput({ value, onChange, placeholder = '0,00', className, autoFocus, id }: { value: number | null; onChange: (cents: number | null) => void; placeholder?: string; className?: string; autoFocus?: boolean; id?: string }) {
  const [text, setText] = useState(value === null ? '' : formatAmount(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === null ? '' : formatAmount(value));
  }, [value, focused]);
  return (
    <div className={clsx('relative', className)}>
      <input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.trim() ? parseEuro(e.target.value) : null);
        }}
        onBlur={() => {
          setFocused(false);
          const c = text.trim() ? parseEuro(text) : null;
          setText(c === null ? '' : formatAmount(c));
        }}
        className={clsx(control, 'tabular pr-7 text-right')}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">€</span>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-[6px] border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx('rounded-[4px] font-medium transition-colors', size === 'sm' ? 'px-2 py-0.5 text-[11.5px]' : 'px-3 py-1 text-[12.5px]', value === o.value ? 'bg-ink text-on-ink' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="inline-flex items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink">
      <span className={clsx('relative h-[16px] w-[28px] shrink-0 rounded-full transition-colors', on ? 'bg-ink' : 'bg-line-strong')}>
        <span className={clsx('absolute top-[2px] h-[12px] w-[12px] rounded-full bg-surface transition-[left] duration-150', on ? 'left-[14px]' : 'left-[2px]')} />
      </span>
      {label}
    </button>
  );
}

/* ---------------- display ---------------- */

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'changes' | 'ink';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-ink-2',
  ok: 'bg-ok/12 text-ok',
  warn: 'bg-warn/14 text-warn',
  danger: 'bg-danger/12 text-danger',
  info: 'bg-info/12 text-info',
  changes: 'bg-changes/12 text-changes',
  ink: 'bg-ink text-on-ink',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] px-1.5 py-[3px] text-[10px] font-bold uppercase leading-none tracking-[0.08em]', toneCls[tone], className)}>{children}</span>;
}

export function Card({ children, className, accent }: { children: ReactNode; className?: string; accent?: boolean }) {
  return (
    <div className={clsx('relative overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--shadow-card)]', className)}>
      {accent && <span className="iris-bar absolute inset-y-0 right-0 w-[4px]" aria-hidden />}
      {children}
    </div>
  );
}

export function Kpi({ label, value, sub, accent, muted }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean; muted?: boolean }) {
  return (
    <Card accent={accent} className="min-w-[150px] flex-1 px-4 py-3">
      <p className={clsx('eyebrow text-[9.5px]', muted ? 'text-ink-3' : 'text-ink-2')}>{label}</p>
      <p className={clsx('font-display tabular mt-1 text-[30px] leading-none', muted ? 'text-ink-3' : 'text-ink')}>{value}</p>
      {sub && <p className="mt-1.5 text-[11.5px] text-ink-3">{sub}</p>}
    </Card>
  );
}

export function PageHeader({ title, eyebrow = 'Business OS', actions, children }: { title: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 px-4 pt-5 md:px-8 md:pt-7">
      <div className="min-w-0">
        <p className="eyebrow text-ink-3">{eyebrow}</p>
        <h1 className="font-display truncate text-[44px] leading-[0.95] md:text-[56px]">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children}
    </header>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-4 md:px-8" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx('relative whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold transition-colors', value === t.value ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="tabular ml-1.5 text-[11px] font-normal text-ink-3">{t.count}</span>}
          {value === t.value && <span className="iris-bar-x absolute inset-x-2 -bottom-px h-[2px]" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="zebra h-16 w-28 rounded-[6px] opacity-80" aria-hidden />
      <p className="font-display mt-5 text-[26px] leading-tight">{title}</p>
      {children && <div className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-[8px] bg-surface-3/70" />
      ))}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-[8px] border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{children}</p>;
}

/* ---------------- side panel ---------------- */

export function Sheet({ open, onClose, title, eyebrow, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; eyebrow?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => e.preventDefault()}
          style={{ maxWidth: width }}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-[slideIn_180ms_var(--ease)]"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {eyebrow && <p className="eyebrow text-ink-3">{eyebrow}</p>}
              <Dialog.Title className="font-display mt-0.5 text-[28px] leading-[1.05]">{title}</Dialog.Title>
            </div>
            <Dialog.Close className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-ink-2 hover:bg-surface-3" aria-label="Cerrar">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ---------------- alerts ("Revisar") ---------------- */

const sevIcon = { info: Info, warning: AlertTriangle, critical: OctagonAlert };
const sevCls = { info: 'text-info', warning: 'text-warn', critical: 'text-danger' };

export function AlertRow({ alert }: { alert: Alert }) {
  const Icon = sevIcon[alert.severity];
  return (
    <Link href={alert.href} className="group flex items-start gap-3 rounded-[8px] px-3 py-2.5 hover:bg-surface-3">
      <Icon size={15} className={clsx('mt-[1px] shrink-0', sevCls[alert.severity])} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-ink">{alert.title}</p>
        {alert.detail && <p className="mt-0.5 text-[11.5px] text-ink-3">{alert.detail}</p>}
      </div>
      <ChevronRight size={14} className="mt-0.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
