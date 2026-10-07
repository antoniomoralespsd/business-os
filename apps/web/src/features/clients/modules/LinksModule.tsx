'use client';
import { Cloud, Copy, ExternalLink, Figma, Globe, HardDrive, Instagram, Link2, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { LINK_KINDS, type ClientLink } from '@bos/schemas';
import { Button, Card, EmptyState, Field, Input, Select, Sheet } from '@/components/ui/kit';
import { act } from '@/data/hooks';
import { randomId } from '@/lib/ids';
import type { ClientModuleProps } from './registry';

const KIND_LABEL: Record<ClientLink['kind'], string> = {
  drive: 'Google Drive',
  dropbox: 'Dropbox',
  wetransfer: 'WeTransfer',
  instagram: 'Instagram',
  web: 'Web',
  figma: 'Figma',
  other: 'Otro',
};

export function LinkIcon({ kind }: { kind: ClientLink['kind'] }) {
  const I = { drive: HardDrive, dropbox: Cloud, wetransfer: Send, instagram: Instagram, web: Globe, figma: Figma, other: Link2 }[kind];
  return <I size={15} className="shrink-0 text-ink-2" />;
}

export function guessKind(url: string): ClientLink['kind'] {
  const u = url.toLowerCase();
  if (u.includes('drive.google') || u.includes('docs.google')) return 'drive';
  if (u.includes('dropbox')) return 'dropbox';
  if (u.includes('wetransfer') || u.includes('we.tl')) return 'wetransfer';
  if (u.includes('instagram')) return 'instagram';
  if (u.includes('figma')) return 'figma';
  return u.startsWith('http') ? 'web' : 'other';
}

export function LinksModule({ client }: ClientModuleProps) {
  const [editing, setEditing] = useState<ClientLink | 'new' | null>(null);
  const save = (links: ClientLink[], msg: string) => act('client.update', { id: client.id, patch: { links } }, msg);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>
          Añadir enlace
        </Button>
      </div>
      {client.links.length === 0 ? (
        <EmptyState title="Sin enlaces todavía">Guarda aquí dónde está cada material de {client.name}: carpetas de Drive o Dropbox, WeTransfer, Instagram, web…</EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {client.links.map((l) => (
              <li key={l.id} className="group flex items-center gap-3 px-4 py-3">
                <LinkIcon kind={l.kind} />
                <div className="min-w-0 flex-1">
                  <a href={l.url} target="_blank" rel="noreferrer" className="block truncate text-[13.5px] font-medium hover:underline">
                    {l.label}
                  </a>
                  <p className="truncate text-[11.5px] text-ink-3">
                    {KIND_LABEL[l.kind]} · {l.url}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label="Copiar enlace"
                    className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-2 hover:bg-surface-3"
                    onClick={() => navigator.clipboard?.writeText(l.url).then(() => toast('Enlace copiado'), () => {})}
                  >
                    <Copy size={14} />
                  </button>
                  <a href={l.url} target="_blank" rel="noreferrer" aria-label="Abrir" className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-2 hover:bg-surface-3">
                    <ExternalLink size={14} />
                  </a>
                  <button type="button" aria-label="Editar" className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-2 hover:bg-surface-3" onClick={() => setEditing(l)}>
                    <Pencil size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <LinkSheet
        link={editing}
        onClose={() => setEditing(null)}
        onSave={async (link) => {
          const exists = client.links.some((x) => x.id === link.id);
          const r = await save(exists ? client.links.map((x) => (x.id === link.id ? link : x)) : [...client.links, link], exists ? 'Enlace guardado' : 'Enlace añadido');
          if (r) setEditing(null);
        }}
        onDelete={async (id) => {
          const r = await save(
            client.links.filter((x) => x.id !== id),
            'Enlace eliminado',
          );
          if (r) setEditing(null);
        }}
      />
    </div>
  );
}

function LinkSheet({ link, onClose, onSave, onDelete }: { link: ClientLink | 'new' | null; onClose: () => void; onSave: (l: ClientLink) => void; onDelete: (id: string) => void }) {
  const existing = link && link !== 'new' ? link : null;
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<ClientLink['kind']>('other');
  const [key, setKey] = useState<string | null>(null);
  const k = link === null ? null : existing?.id ?? 'new';
  if (k !== key) {
    setKey(k);
    setLabel(existing?.label ?? '');
    setUrl(existing?.url ?? '');
    setKind(existing?.kind ?? 'other');
  }
  const valid = label.trim() && /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <Sheet
      open={link !== null}
      onClose={onClose}
      eyebrow="Enlace"
      title={existing ? existing.label : 'Nuevo enlace'}
      footer={
        <>
          {existing && (
            <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 size={14} />} onClick={() => onDelete(existing.id)}>
              Eliminar
            </Button>
          )}
          <Button variant="primary" disabled={!valid} onClick={() => onSave({ id: existing?.id ?? randomId(), label: label.trim(), url: url.trim(), kind })}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Dirección (URL)" hint="Pega el enlace; el tipo se detecta solo.">
          <Input
            value={url}
            autoFocus
            placeholder="https://drive.google.com/…"
            onChange={(e) => {
              setUrl(e.target.value);
              setKind(guessKind(e.target.value));
            }}
          />
        </Field>
        <Field label="Nombre">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Carpeta de entregas, fotos de artistas…" />
        </Field>
        <Field label="Tipo">
          <Select value={kind} onChange={(e) => setKind(e.target.value as ClientLink['kind'])}>
            {LINK_KINDS.map((x) => (
              <option key={x} value={x}>
                {KIND_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}
