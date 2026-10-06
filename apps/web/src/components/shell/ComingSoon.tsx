import { NAV } from './nav';

/** Placeholder for modules not yet approved/built. Shows where it sits in the roadmap. */
export function ComingSoon({ href, children }: { href: string; children?: React.ReactNode }) {
  const item = NAV.find((n) => n.href === href);
  return (
    <div className="flex h-full flex-col px-4 pt-5 md:px-8 md:pt-7">
      <p className="eyebrow text-ink-3">Business OS</p>
      <h1 className="font-display text-[44px] leading-[0.95] md:text-[56px]">{item?.label}</h1>
      <div className="mt-10 flex max-w-xl items-stretch overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--shadow-card)]">
        <div className="flex-1 p-5">
          <p className="eyebrow text-ink-2">{item?.phase ?? 'Próximamente'}</p>
          <div className="mt-2 text-[14px] leading-relaxed text-ink-2">{children ?? 'Este módulo todavía no está construido. Llegará en su fase del roadmap.'}</div>
        </div>
        <span className="iris-bar w-[4px]" aria-hidden />
      </div>
    </div>
  );
}
