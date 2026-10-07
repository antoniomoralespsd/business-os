'use client';
import { Copy, Eye, EyeOff, KeyRound, Lock, Pencil, Plus, ShieldCheck, Trash2, Wand2 } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { VaultEntry } from '@bos/schemas';
import { Button, Card, EmptyState, Field, Input, Loading, Sheet, Textarea } from '@/components/ui/kit';
import { act, useVaultEntries, useVaultMeta } from '@/data/hooks';
import { createVault, decryptText, encryptText, generatePassword, getVaultKey, setVaultKey, subscribeVaultKey, unlockVault } from '@/lib/vault';
import type { ClientModuleProps } from './registry';

export const useVaultKey = () => useSyncExternalStore(subscribeVaultKey, getVaultKey, () => null);

/** Unlock / create the vault. Shared by the client module and Ajustes. */
export function VaultGate({ children }: { children: React.ReactNode }) {
  const meta = useVaultMeta();
  const key = useVaultKey();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (meta === undefined) return <Loading rows={2} />;
  if (key) return <>{children}</>;

  if (meta === null) {
    const ok = pw.length >= 10 && pw === pw2;
    return (
      <Card className="mx-auto max-w-md p-6">
        <ShieldCheck size={22} className="text-ink-2" />
        <p className="font-display mt-3 text-[28px] leading-tight">Crea tu clave maestra</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Las contraseñas se cifran en tu navegador con esta clave. Ni el servidor ni la base de datos pueden leerlas. <strong>Si la olvidas no se puede recuperar</strong>: apúntala en un sitio seguro.
        </p>
        <form
          className="mt-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ok) return;
            setBusy(true);
            const { meta: m, key: k } = await createVault(pw);
            const r = await act('vault.setup', m, 'Caja fuerte creada');
            setBusy(false);
            if (r) setVaultKey(k);
          }}
        >
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Clave maestra (mín. 10 caracteres)" autoComplete="new-password" />
          <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repite la clave" autoComplete="new-password" />
          {pw2 && pw !== pw2 && <p className="text-[12px] text-danger">No coinciden.</p>}
          <Button type="submit" variant="primary" loading={busy} disabled={!ok} className="w-full justify-center">
            Crear caja fuerte
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md p-6">
      <Lock size={22} className="text-ink-2" />
      <p className="font-display mt-3 text-[28px] leading-tight">Accesos bloqueados</p>
      <p className="mt-2 text-[13px] text-ink-2">Introduce tu clave maestra. Se vuelven a bloquear solos a los 15 minutos.</p>
      <form
        className="mt-5 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          const k = await unlockVault(meta, pw);
          setBusy(false);
          if (k) {
            setVaultKey(k);
            setPw('');
          } else setErr('Clave incorrecta.');
        }}
      >
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Clave maestra" autoComplete="current-password" autoFocus />
        {err && <p className="text-[12px] text-danger">{err}</p>}
        <Button type="submit" variant="primary" loading={busy} disabled={!pw} className="w-full justify-center">
          Desbloquear
        </Button>
      </form>
    </Card>
  );
}

export function VaultModule({ client }: ClientModuleProps) {
  return (
    <VaultGate>
      <VaultList clientId={client.id} clientName={client.name} />
    </VaultGate>
  );
}

function VaultList({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { data } = useVaultEntries([{ field: 'clientId', op: '==', value: clientId }]);
  const [editing, setEditing] = useState<VaultEntry | 'new' | null>(null);
  const entries = (data ?? []).filter((e) => !e.archived).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setVaultKey(null)} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-3 hover:text-ink">
          <Lock size={13} /> Bloquear
        </button>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>
          Nuevo acceso
        </Button>
      </div>
      {!data ? (
        <Loading />
      ) : entries.length === 0 ? (
        <EmptyState title="Sin accesos guardados">Guarda los usuarios y contraseñas de {clientName}: Instagram, web, paneles de entradas, Meta Business…</EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <VaultRow key={e.id} entry={e} onEdit={() => setEditing(e)} />
            ))}
          </ul>
        </Card>
      )}
      <VaultSheet clientId={clientId} entry={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function VaultRow({ entry, onEdit }: { entry: VaultEntry; onEdit: () => void }) {
  const key = useVaultKey();
  const [shown, setShown] = useState<string | null>(null);
  const reveal = async () => {
    if (shown) return setShown(null);
    if (!key) return;
    try {
      setShown(await decryptText(key, entry.secret));
      void act('vault.reveal', { id: entry.id });
    } catch {
      toast.error('No se pudo descifrar');
    }
  };
  const copy = async () => {
    if (!key) return;
    const s = await decryptText(key, entry.secret);
    navigator.clipboard?.writeText(s).then(() => toast('Contraseña copiada'), () => toast.error('No se pudo copiar'));
    void act('vault.reveal', { id: entry.id });
  };
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <KeyRound size={15} className="shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{entry.label}</p>
        <p className="truncate text-[12px] text-ink-3">
          {entry.username || '—'}
          {entry.url && (
            <>
              {' · '}
              <a href={entry.url} target="_blank" rel="noreferrer" className="hover:underline">
                {entry.url.replace(/^https?:\/\//, '')}
              </a>
            </>
          )}
        </p>
      </div>
      <code className="tabular hidden min-w-[120px] text-right text-[12.5px] sm:block">{shown ?? '••••••••••'}</code>
      <button type="button" aria-label={shown ? 'Ocultar' : 'Mostrar'} className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-2 hover:bg-surface-3" onClick={reveal}>
        {shown ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button type="button" aria-label="Copiar contraseña" className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-2 hover:bg-surface-3" onClick={copy}>
        <Copy size={14} />
      </button>
      <button type="button" aria-label="Editar" className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-2 hover:bg-surface-3" onClick={onEdit}>
        <Pencil size={14} />
      </button>
    </li>
  );
}

function VaultSheet({ clientId, entry, onClose }: { clientId: string; entry: VaultEntry | 'new' | null; onClose: () => void }) {
  const key = useVaultKey();
  const existing = entry && entry !== 'new' ? entry : null;
  const [label, setLabel] = useState('');
  const [username, setUsername] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [notes, setNotes] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [k, setK] = useState<string | null>(null);
  const cur = entry === null ? null : existing?.id ?? 'new';
  if (cur !== k) {
    setK(cur);
    setLabel(existing?.label ?? '');
    setUsername(existing?.username ?? '');
    setUrl(existing?.url ?? '');
    setSecret('');
    setNotes('');
    setShow(false);
    if (existing && key) {
      void decryptText(key, existing.secret).then(setSecret).catch(() => {});
      if (existing.notes) void decryptText(key, existing.notes).then(setNotes).catch(() => {});
    }
  }

  const save = async () => {
    if (!key || !label.trim() || !secret) return;
    setBusy(true);
    const payload = { label: label.trim(), username, url, secret: await encryptText(key, secret), notes: notes ? await encryptText(key, notes) : null };
    const r = existing ? await act('vault.update', { id: existing.id, patch: payload }, 'Acceso guardado') : await act('vault.create', { clientId, ...payload }, 'Acceso guardado');
    setBusy(false);
    if (r) onClose();
  };

  return (
    <Sheet
      open={entry !== null}
      onClose={onClose}
      eyebrow="Acceso cifrado"
      title={existing ? existing.label : 'Nuevo acceso'}
      footer={
        <>
          {existing && (
            <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 size={14} />} onClick={async () => (await act('vault.delete', { id: existing.id }, 'Acceso eliminado')) && onClose()}>
              Eliminar
            </Button>
          )}
          <Button variant="primary" loading={busy} disabled={!label.trim() || !secret} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Servicio">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Instagram, Meta Business, web…" autoFocus={!existing} />
        </Field>
        <Field label="Usuario o email">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Contraseña">
          <div className="flex gap-2">
            <Input type={show ? 'text' : 'password'} value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" className="tabular" />
            <Button variant="ghost" aria-label={show ? 'Ocultar' : 'Mostrar'} onClick={() => setShow(!show)}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
            <Button
              variant="ghost"
              aria-label="Generar contraseña"
              title="Generar contraseña segura"
              onClick={() => {
                setSecret(generatePassword());
                setShow(true);
              }}
            >
              <Wand2 size={14} />
            </Button>
          </div>
        </Field>
        <Field label="Web de acceso">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Notas cifradas" hint="Códigos de recuperación, PIN, 2FA…">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
