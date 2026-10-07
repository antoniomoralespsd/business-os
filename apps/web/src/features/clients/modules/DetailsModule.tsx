'use client';
import clsx from 'clsx';
import { Archive, ArrowDown, ArrowUp, Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Client } from '@bos/schemas';
import { Button, Card, Field, Input, MoneyInput, Textarea } from '@/components/ui/kit';
import { act } from '@/data/hooks';
import { CLIENT_COLORS, CLIENT_COLOR_KEYS } from '@/lib/clientColors';
import { CLIENT_MODULES, type ClientModuleProps } from './registry';

export function DetailsModule({ client }: ClientModuleProps) {
  const [f, setF] = useState(() => toForm(client));
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(toForm(client)), [client.id, client.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof ReturnType<typeof toForm>>(k: K, v: ReturnType<typeof toForm>[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    await act(
      'client.update',
      {
        id: client.id,
        patch: {
          name: f.name.trim() || client.name,
          shortName: f.shortName.trim(),
          aliases: f.aliases.split(',').map((s) => s.trim()).filter(Boolean),
          color: f.color,
          legalName: f.legalName,
          taxId: f.taxId.toUpperCase().replace(/\s/g, ''),
          address: f.address,
          email: f.email,
          billingEmail: f.billingEmail,
          phone: f.phone,
          contactName: f.contactName,
          billing: { defaultRate: f.defaultRate, vatRate: Number(f.vatRate) || 0, irpfRate: Number(f.irpfRate) || 0, paymentTermsDays: Number(f.terms) || 0, defaultConcept: f.defaultConcept },
        },
      },
      'Datos guardados',
    );
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <p className="eyebrow mb-4 text-ink-2">Identidad</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Nombre corto en tarjetas">
            <Input value={f.shortName} onChange={(e) => set('shortName', e.target.value.toUpperCase())} maxLength={24} />
          </Field>
          <Field label="Otras formas de escribirlo" hint="Separadas por comas. Sirven para reconocer el cliente al crear tareas y al clasificar facturas.">
            <Input value={f.aliases} onChange={(e) => set('aliases', e.target.value)} placeholder="city, ch" />
          </Field>
          <Field label="Color">
            <div className="flex flex-wrap gap-2 pt-1">
              {CLIENT_COLOR_KEYS.map((k) => (
                <button key={k} type="button" aria-label={k} onClick={() => set('color', k)} className={clsx('h-7 w-7 rounded-[6px] border-2', f.color === k ? 'border-ink' : 'border-transparent')} style={{ background: CLIENT_COLORS[k] }} />
              ))}
            </div>
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <p className="eyebrow mb-4 text-ink-2">Datos fiscales y contacto</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Razón social">
            <Input value={f.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Sociedad que paga las facturas" />
          </Field>
          <Field label="NIF / CIF">
            <Input value={f.taxId} onChange={(e) => set('taxId', e.target.value)} />
          </Field>
          <Field label="Dirección fiscal" className="md:col-span-2">
            <Textarea rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Persona de contacto">
            <Input value={f.contactName} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field label="Teléfono">
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Email de facturación">
            <Input value={f.billingEmail} onChange={(e) => set('billingEmail', e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <p className="eyebrow mb-4 text-ink-2">Facturación</p>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Precio habitual por pieza">
            <MoneyInput value={f.defaultRate} onChange={(v) => set('defaultRate', v)} />
          </Field>
          <Field label="IVA %">
            <Input value={f.vatRate} onChange={(e) => set('vatRate', e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Retención IRPF %" hint="15 % general, 7 % los primeros años de autónomo, 0 si es particular o extranjero.">
            <Input value={f.irpfRate} onChange={(e) => set('irpfRate', e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Días para pagar">
            <Input value={f.terms} onChange={(e) => set('terms', e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Concepto habitual" className="md:col-span-2">
            <Input value={f.defaultConcept} onChange={(e) => set('defaultConcept', e.target.value)} placeholder="Diseño de flyer" />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" loading={busy} onClick={save}>
          Guardar datos
        </Button>
      </div>

      <ModulesEditor client={client} />

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="font-semibold">{client.status === 'archived' ? 'Cliente archivado' : 'Archivar cliente'}</p>
          <p className="text-[12.5px] text-ink-3">Deja de aparecer en listas y filtros. No se borra nada; lo encuentras en Archivo.</p>
        </div>
        {client.status === 'archived' ? (
          <Button onClick={() => act('client.unarchive', { id: client.id }, 'Cliente recuperado')}>Recuperar</Button>
        ) : (
          <Button variant="danger" icon={<Archive size={14} />} onClick={() => act('client.archive', { id: client.id }, 'Cliente archivado')}>
            Archivar
          </Button>
        )}
      </Card>
    </div>
  );
}

function ModulesEditor({ client }: { client: Client }) {
  const enabled = client.modules;
  const save = (modules: string[]) => act('client.update', { id: client.id, patch: { modules } });
  const move = (i: number, d: -1 | 1) => {
    const m = [...enabled];
    const j = i + d;
    if (j < 0 || j >= m.length) return;
    [m[i], m[j]] = [m[j]!, m[i]!];
    void save(m);
  };
  const available = CLIENT_MODULES.filter((m) => !m.scope || m.scope.includes(client.id));
  return (
    <Card className="p-5">
      <p className="eyebrow text-ink-2">Módulos de esta carpeta</p>
      <p className="mb-4 mt-1 text-[12.5px] text-ink-3">Elige qué secciones tiene {client.name} y en qué orden. Cada cliente puede tener las suyas.</p>
      <ul className="divide-y divide-line rounded-[8px] border border-line">
        {available.map((m) => {
          const on = enabled.includes(m.id) || !!m.core;
          const idx = enabled.indexOf(m.id);
          const Icon = m.icon;
          return (
            <li key={m.id} className={clsx('flex items-center gap-3 px-3 py-2.5', !on && 'opacity-55')}>
              <Icon size={15} className="text-ink-2" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{m.label}</p>
                <p className="truncate text-[11.5px] text-ink-3">{m.description}</p>
              </div>
              {on && idx >= 0 && (
                <>
                  <button type="button" aria-label="Subir" className="text-ink-3 hover:text-ink disabled:opacity-30" disabled={idx === 0} onClick={() => move(idx, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" aria-label="Bajar" className="text-ink-3 hover:text-ink disabled:opacity-30" disabled={idx === enabled.length - 1} onClick={() => move(idx, 1)}>
                    <ArrowDown size={14} />
                  </button>
                </>
              )}
              {m.core ? (
                <span className="w-8 text-center text-[10px] text-ink-3">fijo</span>
              ) : (
                <button type="button" aria-label={on ? 'Ocultar módulo' : 'Mostrar módulo'} className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-2 hover:bg-surface-3" onClick={() => save(on ? enabled.filter((x) => x !== m.id) : [...enabled, m.id])}>
                  {on ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function toForm(c: Client) {
  return {
    name: c.name,
    shortName: c.shortName ?? '',
    aliases: c.aliases.join(', '),
    color: c.color,
    legalName: c.legalName,
    taxId: c.taxId,
    address: c.address,
    email: c.email,
    billingEmail: c.billingEmail,
    phone: c.phone,
    contactName: c.contactName,
    defaultRate: c.billing.defaultRate,
    vatRate: String(c.billing.vatRate),
    irpfRate: String(c.billing.irpfRate),
    terms: String(c.billing.paymentTermsDays),
    defaultConcept: c.billing.defaultConcept,
  };
}
