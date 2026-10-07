'use client';
import { Download, HardDrive, KeyRound, LogOut, Mail, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { IssuerSettings } from '@bos/schemas';
import { formatInvoiceNumber, todayISO } from '@bos/domain';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge, Button, Card, Field, Input, Loading, PageHeader, Textarea } from '@/components/ui/kit';
import { act, useIssuer, useVaultEntries, useVaultMeta } from '@/data/hooks';
import { readPort } from '@/data/read';
import { useVaultKey } from '@/features/clients/modules/VaultModule';
import { DATA_MODE } from '@/lib/config';
import { downloadText } from '@/lib/format';
import { setThemePref, useThemePref, type ThemePref } from '@/lib/theme';
import { createVault, decryptText, encryptText, setVaultKey, unlockVault } from '@/lib/vault';

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-8 last:border-b-0 lg:grid-cols-[260px_1fr]">
      <div>
        <h2 className="font-display text-[26px] leading-tight">{title}</h2>
        {description && <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function SettingsView() {
  return (
    <div className="pb-16">
      <PageHeader title="Ajustes" />
      <div className="px-4 md:px-8">
        <AppearanceSection />
        <IssuerSection />
        <VaultSection />
        <AccountsSection />
        <BackupSection />
        <SessionSection />
      </div>
    </div>
  );
}

/* ---------- appearance ---------- */

function AppearanceSection() {
  const pref = useThemePref();
  return (
    <Section title="Apariencia" description="El modo oscuro mantiene el mismo sistema: papel, tinta y acentos iridiscentes.">
      <div className="grid max-w-xl grid-cols-3 gap-3">
        {(
          [
            { v: 'light', label: 'Claro', icon: Sun, swatch: 'bg-[#f4f3f1] text-[#0a0a0a]' },
            { v: 'dark', label: 'Oscuro', icon: Moon, swatch: 'bg-[#0d0d0e] text-[#f2f0ec]' },
            { v: 'system', label: 'Automático', icon: Monitor, swatch: 'bg-[linear-gradient(90deg,#f4f3f1_50%,#0d0d0e_50%)] text-[#8a8a8a]' },
          ] as { v: ThemePref; label: string; icon: typeof Sun; swatch: string }[]
        ).map((o) => (
          <button key={o.v} type="button" onClick={() => setThemePref(o.v)} className={`overflow-hidden rounded-[10px] border-2 text-left transition-colors ${pref === o.v ? 'border-ink' : 'border-line hover:border-line-strong'}`}>
            <div className={`relative flex h-20 items-end p-2.5 ${o.swatch}`}>
              <span className="font-display text-[22px] leading-none">Aa</span>
              <span className="iris-bar absolute inset-y-0 right-0 w-[4px]" />
            </div>
            <div className="flex items-center gap-1.5 bg-surface px-3 py-2 text-[12.5px] font-semibold">
              <o.icon size={13} /> {o.label}
            </div>
          </button>
        ))}
      </div>
    </Section>
  );
}

/* ---------- issuer ---------- */

function IssuerSection() {
  const issuer = useIssuer();
  const year = todayISO().slice(0, 4);
  const [f, setF] = useState<IssuerSettings | null>(null);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (issuer && !f) {
      setF(issuer);
      setNext(String(issuer.nextNumber[year] ?? ''));
    }
  }, [issuer, f, year]);
  if (!f) return <Section title="Datos fiscales"><Loading rows={2} /></Section>;
  const set = <K extends keyof IssuerSettings>(k: K, v: IssuerSettings[K]) => setF({ ...f, [k]: v });
  const nextN = Number(next) || 1;

  const save = async () => {
    setBusy(true);
    await act('settings.issuer', { ...f, taxId: f.taxId.toUpperCase().replace(/\s/g, ''), nextNumber: next ? { ...f.nextNumber, [year]: nextN } : f.nextNumber, defaultVat: Number(f.defaultVat) || 0, defaultIrpf: Number(f.defaultIrpf) || 0 }, 'Datos fiscales guardados');
    setBusy(false);
  };

  return (
    <Section title="Datos fiscales" description="Salen en tus facturas. Se necesitan nombre y NIF para emitir.">
      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre comercial">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Iris Design" />
          </Field>
          <Field label="Nombre y apellidos (titular)">
            <Input value={f.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Antonio Morales …" />
          </Field>
          <Field label="NIF">
            <Input value={f.taxId} onChange={(e) => set('taxId', e.target.value)} />
          </Field>
          <Field label="Email de facturación">
            <Input value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="antoniomorales.psd@gmail.com" />
          </Field>
          <Field label="Dirección fiscal" className="md:col-span-2">
            <Textarea rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Teléfono">
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="IBAN (sale en la factura)">
            <Input value={f.iban} onChange={(e) => set('iban', e.target.value.toUpperCase())} placeholder="ES00 …" />
          </Field>
        </div>
        <div className="mt-6 grid gap-4 border-t border-line pt-5 md:grid-cols-4">
          <Field label="Serie (opcional)" hint="Prefijo, p. ej. F">
            <Input value={f.series} onChange={(e) => set('series', e.target.value.toUpperCase().slice(0, 4))} />
          </Field>
          <Field label={`Próximo número ${year}`} hint={`La siguiente será ${formatInvoiceNumber(f.series, Number(year), nextN)}`}>
            <Input value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="1" />
          </Field>
          <Field label="IVA por defecto %">
            <Input value={String(f.defaultVat)} onChange={(e) => set('defaultVat', Number(e.target.value) || 0)} inputMode="decimal" />
          </Field>
          <Field label="IRPF por defecto %">
            <Input value={String(f.defaultIrpf)} onChange={(e) => set('defaultIrpf', Number(e.target.value) || 0)} inputMode="decimal" />
          </Field>
          <Field label="Nota al pie de las facturas" className="md:col-span-4">
            <Textarea rows={2} value={f.paymentNote} onChange={(e) => set('paymentNote', e.target.value)} placeholder="Pago por transferencia en 30 días." />
          </Field>
        </div>
        <p className="mt-3 text-[11.5px] text-ink-3">Si ya has emitido facturas este año fuera de la app, pon aquí el siguiente número para continuar la serie sin huecos ni duplicados.</p>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" loading={busy} onClick={save}>
            Guardar
          </Button>
        </div>
      </Card>
    </Section>
  );
}

/* ---------- vault ---------- */

function VaultSection() {
  const meta = useVaultMeta();
  const key = useVaultKey();
  const { data: entries } = useVaultEntries();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const change = async () => {
    if (!meta || newPw.length < 10 || !entries) return;
    setBusy(true);
    try {
      const oldKey = await unlockVault(meta, oldPw);
      if (!oldKey) throw new Error('La clave actual no es correcta.');
      const { meta: m, key: k } = await createVault(newPw);
      const re = await Promise.all(
        entries.map(async (e) => ({
          id: e.id,
          secret: await encryptText(k, await decryptText(oldKey, e.secret)),
          notes: e.notes ? await encryptText(k, await decryptText(oldKey, e.notes)) : null,
        })),
      );
      if (await act('vault.rekey', { meta: m, entries: re }, 'Clave maestra cambiada')) {
        setVaultKey(k);
        setOldPw('');
        setNewPw('');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo cambiar');
    }
    setBusy(false);
  };

  return (
    <Section title="Caja fuerte" description="Contraseñas de clientes cifradas en tu navegador. Ni el servidor ni la base de datos pueden leerlas.">
      <Card className="p-5">
        {meta === undefined ? (
          <Loading rows={1} />
        ) : meta === null ? (
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <KeyRound size={15} /> Aún no está creada. Se crea la primera vez que abres "Accesos" dentro de un cliente.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <Badge tone="ok">Activa</Badge>
              <span className="text-ink-2">{entries?.length ?? 0} accesos guardados</span>
              <span className="text-ink-3">· {key ? 'Desbloqueada ahora' : 'Bloqueada'}</span>
              {key && (
                <Button size="sm" variant="ghost" onClick={() => setVaultKey(null)}>
                  Bloquear
                </Button>
              )}
            </div>
            <div className="grid max-w-xl gap-3 md:grid-cols-2">
              <Field label="Clave actual">
                <Input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" />
              </Field>
              <Field label="Clave nueva (mín. 10)">
                <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button loading={busy} disabled={!oldPw || newPw.length < 10} onClick={change}>
                Cambiar clave maestra
              </Button>
              <Button variant="danger" onClick={() => setConfirmReset(true)}>
                He olvidado la clave
              </Button>
            </div>
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="¿Reiniciar la caja fuerte?"
        description="Sin la clave maestra no se pueden recuperar. Se borrarán TODOS los accesos guardados y podrás crear una clave nueva."
        confirmLabel="Borrar y reiniciar"
        danger
        onConfirm={async () => {
          if (await act('vault.reset', { confirm: 'BORRAR' }, 'Caja fuerte reiniciada')) setVaultKey(null);
        }}
      />
    </Section>
  );
}

/* ---------- google accounts ---------- */

function AccountsSection() {
  const accounts = [
    { email: 'antoniomorales.psd@gmail.com', role: 'Negocio · inicio de sesión, facturas, Gmail de facturas' },
    { email: 'a9214@esdi.edu.es', role: 'Almacén pesado · vídeos y entregas grandes' },
    { email: 'tonimc99@gmail.com', role: 'Personal · solo para entrar (opcional)' },
  ];
  return (
    <Section title="Cuentas de Google" description="Conexión con Drive y Gmail para guardar entregas y detectar facturas en el correo.">
      <Card>
        <ul className="divide-y divide-line">
          {accounts.map((a) => (
            <li key={a.email} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {a.email.includes('esdi') ? <HardDrive size={15} className="text-ink-3" /> : <Mail size={15} className="text-ink-3" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{a.email}</p>
                <p className="truncate text-[11.5px] text-ink-3">{a.role}</p>
              </div>
              <Badge>Próximamente</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-2 text-[11.5px] text-ink-3">Mientras tanto, los archivos que subes al Inbox se guardan en el almacenamiento de Firebase del proyecto.</p>
    </Section>
  );
}

/* ---------- backup ---------- */

const COLLECTIONS = ['clients', 'tasks', 'jobs', 'invoices', 'expenses', 'subscriptions', 'inbox', 'vault', 'settings', 'activity_logs'];

function BackupSection() {
  const [busy, setBusy] = useState(false);
  const backup = async () => {
    setBusy(true);
    try {
      const out: Record<string, unknown> = { exportedAt: new Date().toISOString() };
      for (const c of COLLECTIONS) {
        const rows = await readPort().getOnce(c, []);
        out[c] = rows.map((r) => ({ id: r.id, ...JSON.parse(JSON.stringify(r.data, (_k, v) => (v && typeof v === 'object' && 'toDate' in v ? (v as { toDate: () => Date }).toDate().toISOString() : v))) }));
      }
      downloadText(`business-os-copia-${todayISO()}.json`, JSON.stringify(out, null, 2), 'application/json');
      toast('Copia descargada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo exportar');
    }
    setBusy(false);
  };
  return (
    <Section title="Copia de seguridad" description="Descarga todos tus datos en un archivo. Las contraseñas van cifradas.">
      <Button icon={<Download size={14} />} loading={busy} onClick={backup}>
        Descargar copia (JSON)
      </Button>
    </Section>
  );
}

/* ---------- session ---------- */

function SessionSection() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (DATA_MODE !== 'firestore') return;
    void import('@/lib/firebaseClient').then(({ clientAuth }) => clientAuth().onAuthStateChanged((u) => setEmail(u?.email ?? null)));
  }, []);
  const logout = async () => {
    if (DATA_MODE === 'firestore') {
      const [{ clientAuth }, { signOut }] = await Promise.all([import('@/lib/firebaseClient'), import('firebase/auth')]);
      await signOut(clientAuth()).catch(() => {});
      await fetch('/api/session', { method: 'DELETE' }).catch(() => {});
    }
    window.location.assign('/login');
  };
  return (
    <Section title="Sesión">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] text-ink-2">{DATA_MODE === 'memory' ? 'Modo demo (datos de ejemplo en este navegador)' : email ? `Conectado como ${email}` : 'Conectado'}</span>
        <Button icon={<LogOut size={14} />} onClick={logout}>
          Cerrar sesión
        </Button>
      </div>
    </Section>
  );
}

