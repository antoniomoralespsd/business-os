'use client';
import clsx from 'clsx';
import { ArrowLeft, Folder, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { Client } from '@bos/schemas';
import { bucketOf, formatEUR, unbilledByClient } from '@bos/domain';
import { Button, Card, EmptyState, Field, Input, Loading, PageHeader, Sheet } from '@/components/ui/kit';
import { act, useClients, useJobs, useTasksAll } from '@/data/hooks';
import { clientColor, CLIENT_COLORS, CLIENT_COLOR_KEYS } from '@/lib/clientColors';
import { STATIC_EXPORT } from '@/lib/config';
import { modulesFor } from './modules/registry';

const clientHref = (id: string, mod?: string) => `${STATIC_EXPORT ? 'clients.html' : '/clients'}?c=${encodeURIComponent(id)}${mod ? `&m=${mod}` : ''}`;

export function ClientsView() {
  const params = useSearchParams();
  const id = params.get('c');
  return id ? <ClientSpace id={id} moduleId={params.get('m')} /> : <ClientList />;
}

/* ---------------- list ---------------- */

function ClientList() {
  const { data: clients } = useClients();
  const { data: tasks } = useTasksAll();
  const { data: jobs } = useJobs();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const stats = useMemo(() => {
    const m = new Map<string, { action: number; waiting: number }>();
    for (const t of tasks ?? []) {
      if (!t.clientId || t.archived) continue;
      const s = m.get(t.clientId) ?? { action: 0, waiting: 0 };
      const b = bucketOf(t.status);
      if (b === 'action') s.action++;
      if (b === 'waiting') s.waiting++;
      m.set(t.clientId, s);
    }
    return m;
  }, [tasks]);
  const unbilled = useMemo(() => unbilledByClient(jobs ?? []), [jobs]);
  const list = (clients ?? [])
    .filter((c) => c.status !== 'archived')
    .filter((c) => !q || `${c.name} ${c.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return (
    <div className="pb-16">
      <PageHeader
        title="Clientes"
        actions={
          <>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" className="w-[200px] pl-8" />
            </div>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              Nuevo cliente
            </Button>
          </>
        }
      />
      <div className="px-4 pt-6 md:px-8">
        {!clients ? (
          <Loading rows={4} />
        ) : list.length === 0 ? (
          <EmptyState title={q ? 'Ningún cliente coincide' : 'Aún no hay clientes'} action={<Button variant="primary" onClick={() => setCreating(true)}>Crear cliente</Button>} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {list.map((c) => {
              const s = stats.get(c.id);
              const u = unbilled.get(c.id);
              return (
                <Link key={c.id} href={clientHref(c.id)} className="group">
                  <Card className="h-full p-4 transition-colors group-hover:border-ink">
                    <div className="flex items-start gap-3">
                      <span className="relative mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[8px]" style={{ background: `${clientColor(c.color)}22` }}>
                        <Folder size={18} style={{ color: clientColor(c.color) }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-display truncate text-[24px] leading-tight">{c.name}</p>
                        <p className="mt-0.5 truncate text-[11.5px] text-ink-3">{c.legalName || (c.taxId ? c.taxId : 'Sin datos fiscales')}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                      <span className={clsx(s?.action ? 'text-ink' : 'text-ink-3')}>
                        <strong className="tabular">{s?.action ?? 0}</strong> por hacer
                      </span>
                      <span className="text-ink-3">
                        <strong className="tabular">{s?.waiting ?? 0}</strong> en revisión
                      </span>
                      {u && (
                        <span className="text-warn">
                          <strong className="tabular">{formatEUR(u.amount)}</strong> sin facturar
                        </span>
                      )}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <NewClientSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          router.push(clientHref(id, 'details'));
        }}
      />
    </div>
  );
}

function NewClientSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await act<{ id: string }>('client.create', { name: name.trim(), color }, 'Cliente creado');
    setBusy(false);
    if (r) {
      setName('');
      onCreated(r.id);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow="Cliente"
      title="Nuevo cliente"
      footer={
        <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={create}>
          Crear y completar datos
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Bellaka, Sugar, Caprixo…" />
        </Field>
        <Field label="Color">
          <div className="flex flex-wrap gap-2 pt-1">
            {CLIENT_COLOR_KEYS.map((k) => (
              <button key={k} type="button" aria-label={k} onClick={() => setColor(k)} className={clsx('h-7 w-7 rounded-[6px] border-2', color === k ? 'border-ink' : 'border-transparent')} style={{ background: CLIENT_COLORS[k] }} />
            ))}
          </div>
        </Field>
      </form>
    </Sheet>
  );
}

/* ---------------- one client's folder ---------------- */

function ClientSpace({ id, moduleId }: { id: string; moduleId: string | null }) {
  const { data: clients } = useClients();
  const router = useRouter();
  const client = clients?.find((c) => c.id === id);
  if (!clients) return <div className="p-8"><Loading rows={4} /></div>;
  if (!client) {
    return (
      <EmptyState title="Este cliente no existe" action={<Link href={STATIC_EXPORT ? 'clients.html' : '/clients'} className="font-semibold underline">Volver a clientes</Link>} />
    );
  }
  const mods = modulesFor(client);
  const active = mods.find((m) => m.id === moduleId) ?? mods[0]!;
  const Active = active.Component;
  const goTo = (m: string) => router.replace(clientHref(client.id, m), { scroll: false });

  return (
    <div className="pb-16">
      <div className="px-4 pt-5 md:px-8 md:pt-7">
        <Link href={STATIC_EXPORT ? 'clients.html' : '/clients'} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-3 hover:text-ink">
          <ArrowLeft size={13} /> Clientes
        </Link>
        <div className="mt-2 flex items-center gap-4">
          <span className="h-12 w-[5px] rounded-full" style={{ background: clientColor(client.color) }} />
          <div className="min-w-0">
            <h1 className="font-display truncate text-[44px] leading-[0.95] md:text-[56px]">{client.name}</h1>
            <p className="mt-1 text-[12.5px] text-ink-3">
              {[client.legalName, client.taxId, client.contactName].filter(Boolean).join(' · ') || 'Completa sus datos en "Datos y tarifas"'}
              {client.status === 'archived' && ' · ARCHIVADO'}
            </p>
          </div>
        </div>
      </div>
      <ClientModuleTabs client={client} active={active.id} onSelect={goTo} />
      <div className="px-4 pt-6 md:px-8">
        <Active client={client} goTo={goTo} />
      </div>
    </div>
  );
}

function ClientModuleTabs({ client, active, onSelect }: { client: Client; active: string; onSelect: (id: string) => void }) {
  const mods = modulesFor(client);
  return (
    <div className="scroll-thin mt-5 flex gap-1 overflow-x-auto border-b border-line px-4 md:px-8" role="tablist">
      {mods.map((m) => {
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active === m.id}
            onClick={() => onSelect(m.id)}
            className={clsx('relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold', active === m.id ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
          >
            <Icon size={14} />
            {m.label}
            {active === m.id && <span className="iris-bar-x absolute inset-x-2 -bottom-px h-[2px]" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
