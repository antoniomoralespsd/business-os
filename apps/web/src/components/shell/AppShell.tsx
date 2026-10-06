'use client';
import clsx from 'clsx';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';
import { DATA_MODE, STATIC_EXPORT } from '@/lib/config';
import { usePersistentState } from '@/lib/usePersistentState';
import { NAV } from './nav';

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="font-display select-none leading-[0.82] text-ink">
      {collapsed ? (
        <span className="text-[26px]">B</span>
      ) : (
        <>
          <span className="block text-[25px]">Business</span>
          <span className="flex items-center gap-1.5 text-[25px]">
            OS <span className="iris-bar-x inline-block h-[10px] w-9 rounded-[1px]" aria-hidden />
          </span>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const routerPath = usePathname() || '/';
  // After hydration use the real URL (the static demo is served as /…/tasks.html, /…/index.html).
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const path = (hydrated && STATIC_EXPORT ? window.location.pathname : routerPath).replace(/\.html$/, '').replace(/\/index$/, '/');
  const [collapsed, setCollapsed] = usePersistentState('bos.sidebar.collapsed', false);
  const isActive = (href: string) => path === href || path.endsWith(href) || (href === '/tasks' && path.endsWith('/'));
  // The static demo has no server routing: link to sibling .html files.
  const hrefFor = (href: string) => (STATIC_EXPORT ? (href === '/tasks' ? 'index.html' : `${href.slice(1)}.html`) : href);

  return (
    <div className="relative z-[1] flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <aside className={clsx('hidden shrink-0 flex-col border-r border-line bg-surface/60 backdrop-blur-sm transition-[width] duration-200 md:flex', collapsed ? 'w-[64px]' : 'w-[220px]')}>
        <div className={clsx('flex items-start justify-between pb-6 pt-6', collapsed ? 'px-4' : 'px-5')}>
          <Logo collapsed={collapsed} />
        </div>
        <nav className="flex-1 space-y-0.5 px-2.5" aria-label="Módulos">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={hrefFor(item.href)}
                prefetch={!STATIC_EXPORT}
                title={collapsed ? item.label : undefined}
                className={clsx(
                  'group relative flex items-center gap-2.5 rounded-[6px] px-2.5 py-[7px] text-[13px] transition-colors',
                  active ? 'bg-ink text-white' : 'text-ink-2 hover:bg-surface hover:text-ink',
                )}
              >
                {active && <span className="iris-bar absolute inset-y-0 right-0 w-[4px] rounded-r-[6px]" aria-hidden />}
                <Icon size={15} strokeWidth={1.8} className="shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && item.phase && !active && <span className="ml-auto text-[9.5px] tracking-[0.06em] text-ink-3 opacity-0 group-hover:opacity-100">{item.phase}</span>}
              </Link>
            );
          })}
        </nav>
        <div className={clsx('border-t border-line py-3', collapsed ? 'px-2.5' : 'px-4')}>
          {!collapsed && (
            <div className="mb-2 flex items-center gap-2.5">
              <span className="iris-bar h-7 w-7 shrink-0 rounded-full" aria-hidden />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[12.5px] font-semibold">Iris Design</p>
                <p className="truncate text-[11px] text-ink-3">{DATA_MODE === 'memory' ? 'Modo demo' : 'Admin'}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="grid h-7 w-7 place-items-center rounded-[4px] text-ink-3 hover:bg-surface hover:text-ink"
            aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden pb-[60px] md:pb-0">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Módulos">
        {NAV.filter((n) => n.mobile).map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={hrefFor(item.href)} prefetch={!STATIC_EXPORT} className={clsx('relative flex flex-col items-center gap-0.5 py-2 text-[10.5px]', active ? 'text-ink' : 'text-ink-3')}>
              {active && <span className="iris-bar-x absolute inset-x-6 top-0 h-[2px]" aria-hidden />}
              <Icon size={18} strokeWidth={1.8} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
