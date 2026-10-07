'use client';
import { Copy, ExternalLink, FileOutput, FolderOpen, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MONTHS, nextSheetTitle, todayISO } from '@bos/domain';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Select, Sheet } from '@/components/ui/kit';
import { useClients, useInvoices, useIssuer, useSubscriptions } from '@/data/hooks';
import { DriveAuthNeeded, driveUrl } from '@/lib/drive';
import { shortDate } from '@/lib/format';
import { digitsOf, duplicateSheet, exportAndRegister, firstOfMonth, listInvoiceSheets, nextNumber, prevMonth, type SheetEntry } from '@/features/drive/sheetTools';
import { ensureDrive, pool, useDrive } from '@/features/inbox/pipeline';

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const n = MONTHS[m - 1] ?? '';
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${y}`;
};

/**
 * Your invoice sheets in Drive (01 - FACTURAS, 03 - RECTIFICATIVAS): export to PDF into
 * 00 - AÑOS/<year>/<month>/INGRESOS and register them, or duplicate last month's for a client.
 */
export function SheetsPanel() {
  const drive = useDrive();
  const issuer = useIssuer();
  const { data: invoices } = useInvoices();
  const { data: clients } = useClients();
  const { data: subs } = useSubscriptions();
  const [sheets, setSheets] = useState<SheetEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [dup, setDup] = useState<SheetEntry | null>(null);
  const owner = issuer?.legalName?.split(' ').slice(0, 2).join(' ') || 'Antonio Morales';

  const registered = useMemo(() => {
    const s = new Set<string>();
    for (const i of invoices ?? []) {
      const d = digitsOf(i.invoiceNumber);
      if (d) s.add(`${i.total < 0 ? 'R' : 'F'}${d}`);
    }
    return s;
  }, [invoices]);
  const isRegistered = (e: SheetEntry) => registered.has(`${e.t.rectificativa ? 'R' : 'F'}${digitsOf(e.t.number)}`);

  const months = useMemo(() => [...new Set((sheets ?? []).map((s) => s.t.date?.slice(0, 7)).filter((x): x is string => !!x))].sort().reverse(), [sheets]);
  const shown = (sheets ?? []).filter((s) => !month || s.t.date?.startsWith(month));
  const pendingInMonth = shown.filter((s) => !isRegistered(s));

  if (!drive.enabled) return <EmptyState title="Solo con Drive">En la demo no hay conexión con Google Drive.</EmptyState>;
  if (!drive.account || !drive.layout)
    return (
      <EmptyState title="Conecta tu carpeta de la agencia">
        En{' '}
        <Link href="/settings" className="font-semibold underline">
          Ajustes → Cuentas de Google
        </Link>{' '}
        conecta tonimc99 y elige la carpeta AGENCIA. Aquí verás tus hojas de 01 - FACTURAS.
      </EmptyState>
    );

  const load = async () => {
    if (!(await ensureDrive(drive.account))) return;
    setLoading(true);
    try {
      const list = await listInvoiceSheets(drive.account!, drive.layout!, owner);
      setSheets(list);
      if (!month) setMonth(list.find((s) => s.t.date)?.t.date?.slice(0, 7) ?? '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo leer Drive');
    }
    setLoading(false);
  };

  const exportMany = async (list: SheetEntry[]) => {
    if (!list.length || !(await ensureDrive(drive.account))) return;
    setBusy({ done: 0, total: list.length });
    let ok = 0;
    const errors: string[] = [];
    // One at a time keeps the invoice numbering and the folders tidy.
    await pool(list, 1, async (e) => {
      try {
        await exportAndRegister(e, { account: drive.account!, layout: drive.layout!, clients: clients ?? [], subs: subs ?? [], issuer });
        ok++;
      } catch (err) {
        if (err instanceof DriveAuthNeeded) throw err;
        errors.push(`${e.file.name}: ${err instanceof Error ? err.message : 'error'}`);
      }
      setBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
    }).catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Error'));
    setBusy(null);
    toast(`${ok} ${ok === 1 ? 'factura exportada y registrada' : 'facturas exportadas y registradas'}${errors.length ? ` · ${errors.length} con error: ${errors[0]}` : ''}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px] text-ink-2">
          Tus hojas de <strong>01 - FACTURAS</strong> y <strong>03 - RECTIFICATIVAS</strong>. «Exportar» guarda el PDF en 00 - AÑOS / año / mes / INGRESOS con el nombre de siempre y la registra aquí.
        </p>
        <a href={driveUrl(drive.account, drive.layout.editablesId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink">
          <FolderOpen size={13} /> Abrir carpeta
        </a>
        <Button size="sm" icon={<RefreshCw size={13} />} loading={loading} onClick={() => void load()}>
          {sheets ? 'Actualizar' : 'Cargar hojas de Drive'}
        </Button>
      </div>

      {!sheets ? (
        loading ? <Loading rows={4} /> : <EmptyState title="Pulsa «Cargar hojas de Drive»">Google pedirá permiso la primera vez y luego cada hora.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-[180px]" aria-label="Mes">
              <option value="">Todos los meses</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </Select>
            <span className="text-[12.5px] text-ink-3">
              {shown.length} hojas · {pendingInMonth.length} sin exportar
            </span>
            {pendingInMonth.length > 0 && (
              <Button size="sm" variant="primary" icon={<FileOutput size={13} />} loading={!!busy} onClick={() => void exportMany(pendingInMonth)}>
                Exportar y registrar {pendingInMonth.length}
                {month ? ` de ${monthLabel(month).toLowerCase()}` : ''}
              </Button>
            )}
          </div>
          {busy && <p className="tabular text-[12.5px] text-ink-3">Exportando {busy.done} de {busy.total}…</p>}
          <Card>
            <ul className="divide-y divide-line">
              {shown.map((e) => {
                const done = isRegistered(e);
                return (
                  <li key={e.file.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                    <span className="tabular w-16 shrink-0 font-semibold">{e.t.number ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {e.t.label}
                      {e.t.rectificativa && (
                        <Badge tone="changes" className="ml-2">
                          Rectificativa
                        </Badge>
                      )}
                    </span>
                    <span className="tabular w-16 text-[12px] text-ink-3">{shortDate(e.t.date)}</span>
                    {done ? <Badge tone="ok">Registrada</Badge> : <Badge tone="warn">Sin exportar</Badge>}
                    <Button size="sm" variant="ghost" icon={<FileOutput size={13} />} disabled={!!busy} onClick={() => void exportMany([e])}>
                      {done ? 'Reexportar' : 'Exportar'}
                    </Button>
                    {!e.t.rectificativa && (
                      <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => setDup(e)}>
                        Duplicar
                      </Button>
                    )}
                    <a href={`https://docs.google.com/spreadsheets/d/${e.file.id}/edit`} target="_blank" rel="noreferrer" className="text-ink-3 hover:text-ink" aria-label="Abrir en Sheets">
                      <ExternalLink size={14} />
                    </a>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
      {dup && sheets && (
        <DuplicateSheet
          entry={dup}
          owner={owner}
          suggested={nextNumber(sheets, invoices ?? [], issuer?.nextNumber?.[todayISO().slice(0, 4)])}
          onClose={() => setDup(null)}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}

/** "Duplicate for next month": copy with the next number and date; you edit lines in Sheets. */
export function DuplicateSheet({ entry, owner, suggested, onClose, onDone, albaran }: { entry: SheetEntry; owner: string; suggested: string; onClose: () => void; onDone: () => void; albaran?: boolean }) {
  const drive = useDrive();
  const [number, setNumber] = useState(suggested);
  const [date, setDate] = useState(albaran ? todayISO() : firstOfMonth());
  // Invoices: issued on the 1st for last month's work. Albaranes: dated within the month they cover.
  const [work, setWork] = useState(String(albaran ? Number(todayISO().slice(5, 7)) : prevMonth(firstOfMonth())));
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ name: string; url: string } | null>(null);
  const title = nextSheetTitle(entry.t, { number, date, workMonth: Number(work), ownerName: owner, albaran });

  const go = async () => {
    if (!(await ensureDrive(drive.account))) return;
    setBusy(true);
    try {
      const r = await duplicateSheet(drive.account!, entry, { number, date, workMonth: Number(work), ownerName: owner, albaran });
      setMade(r);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo duplicar');
    }
    setBusy(false);
  };

  return (
    <Sheet open onClose={onClose} title={albaran ? 'Nuevo albarán desde este' : 'Nueva factura desde esta'}>
      <div className="space-y-4 p-5">
        <p className="text-[12.5px] text-ink-2">
          Se copia <strong>{entry.file.name}</strong> en la misma carpeta con el número y la fecha nuevos. Luego cambias líneas e importes en Sheets y, cuando esté lista, la exportas desde aquí.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {!albaran && (
            <Field label="Número">
              <Input value={number} onChange={(e) => setNumber(e.target.value)} />
            </Field>
          )}
          <Field label="Fecha">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Mes del trabajo">
            <Select value={work} onChange={(e) => setWork(e.target.value)}>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Nombre">
          <p className="rounded-[6px] bg-surface-2 px-3 py-2 text-[13px]">{title}</p>
        </Field>
        {made ? (
          <a href={made.url} target="_blank" rel="noreferrer" className="btn-primary inline-flex items-center gap-2 rounded-[6px] px-4 py-2 text-[13px] font-semibold">
            Abrir «{made.name}» en Sheets <ExternalLink size={13} />
          </a>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void go()}>
              Crear copia
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
