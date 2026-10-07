'use client';
import clsx from 'clsx';
import { Copy, ExternalLink, FolderOpen, Hash, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Albaran } from '@bos/schemas';
import { albaranTitle, formatEUR, parseSheetDoc, parseSheetTitle, todayISO } from '@bos/domain';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge, Button, Card, EmptyState, Kpi, Loading, PageHeader, Segmented } from '@/components/ui/kit';
import { act, useAlbaranes, useClients, useIssuer } from '@/data/hooks';
import { callAction } from '@/lib/actionsClient';
import { driveUrl, listChildren, renameFile, sheetRows, SHEET_MIME } from '@/lib/drive';
import { shortDate } from '@/lib/format';
import { DuplicateSheet } from '@/features/billing/SheetsPanel';
import { norm } from '@/features/inbox/drafts';
import { ensureDrive, pool, useDrive } from '@/features/inbox/pipeline';
import type { SheetEntry } from '@/features/drive/sheetTools';

type Filter = 'pending' | 'paid' | 'all';

/** Label without number/owner/date: "LEVEL AGOSTO 2026". */
const labelOf = (a: Albaran, owner: string) => parseSheetTitle(a.driveName, owner).label || a.title;

/**
 * Albaranes: the sheets in 02 - ALBARANES, numbered by date and tracked as pending or collected.
 * Kept apart from invoices: they don't enter Facturación or the quarterly figures.
 */
export function AlbaranesView() {
  const drive = useDrive();
  const issuer = useIssuer();
  const { data: list } = useAlbaranes();
  const { data: clients } = useClients();
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ a: Albaran; to: string }[] | null>(null);
  const [dup, setDup] = useState<SheetEntry | null>(null);
  const owner = issuer?.legalName?.split(' ').slice(0, 2).join(' ') || 'Antonio Morales';
  const year = todayISO().slice(0, 4);

  const rows = useMemo(() => (list ?? []).filter((a) => !a.archived).sort((a, b) => b.date.localeCompare(a.date) || (b.number ?? 0) - (a.number ?? 0)), [list]);
  const shown = rows.filter((a) => filter === 'all' || a.status === filter);
  const pendingSum = rows.filter((a) => a.status === 'pending').reduce((s, a) => s + a.total, 0);
  const paidYear = rows.filter((a) => a.status === 'paid' && a.date.startsWith(year)).reduce((s, a) => s + a.total, 0);

  const sync = async () => {
    if (!drive.layout?.albaranesId || !(await ensureDrive(drive.account))) return;
    setBusy('sync');
    try {
      const files = (await listChildren(drive.account!, drive.layout.albaranesId)).filter((f) => f.mimeType === SHEET_MIME);
      const items: Parameters<typeof toItem>[0][] = [];
      await pool(files, 3, async (f) => {
        items.push({ f, doc: parseSheetDoc(await sheetRows(drive.account!, f.id)) });
      });
      const payload = items.map(toItem);
      const r = await callAction<{ created: number; updated: number }>('albaran.sync', { items: payload });
      toast(`Albaranes leídos: ${r.created} nuevos, ${r.updated} actualizados`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo leer Drive');
    }
    setBusy(null);

    function toItem({ f, doc }: { f: { id: string; name: string; modifiedTime?: string }; doc: ReturnType<typeof parseSheetDoc> }) {
      const t = parseSheetTitle(f.name, owner);
      const recipients = doc.recipients.filter((r) => r.length < 60).slice(0, 10);
      const clientIds = (clients ?? []).filter((c) => recipients.some((r) => [c.name, ...c.aliases].some((n) => n && norm(r).includes(norm(n))))).map((c) => c.id);
      return {
        driveFileId: f.id,
        driveName: f.name,
        title: t.label || f.name,
        date: doc.date ?? t.date ?? (f.modifiedTime ?? todayISO()).slice(0, 10),
        recipients,
        clientIds: [...new Set(clientIds)].slice(0, 20),
        lines: doc.lines.length,
        total: doc.total ?? doc.base ?? 0,
      };
    }
  };

  /** Numbers by date (oldest = 1) and shows the new Drive names before renaming. */
  const prepareNumbering = async () => {
    setBusy('number');
    const anyNumbered = rows.some((a) => a.number);
    const r = await callAction<{ numbered: { id: string; number: number }[] }>('albaran.number', { restart: !anyNumbered }).catch((e: unknown) => {
      toast.error(e instanceof Error ? e.message : 'Error');
      return null;
    });
    setBusy(null);
    if (!r) return;
    const byId = new Map((list ?? []).map((a) => [a.id, a]));
    const all = (list ?? []).map((a) => ({ ...a, number: r.numbered.find((n) => n.id === a.id)?.number ?? a.number }));
    const plan = all
      .filter((a) => a.number)
      .map((a) => ({ a: byId.get(a.id)!, to: albaranTitle(a.number!, labelOf(a, owner), a.date, owner) }))
      .filter((p) => p.to !== p.a.driveName)
      .sort((x, y) => x.a.date.localeCompare(y.a.date));
    if (!plan.length) toast('Ya están numerados y con su nombre');
    else setPreview(plan);
  };

  const rename = async () => {
    if (!preview || !(await ensureDrive(drive.account))) return;
    const plan = preview;
    setPreview(null);
    setBusy('rename');
    let ok = 0;
    await pool(plan, 3, async ({ a, to }) => {
      try {
        await renameFile(drive.account!, a.driveFileId, to);
        await callAction('albaran.update', { id: a.id, patch: { driveName: to } });
        ok++;
      } catch {
        /* reported below */
      }
    });
    setBusy(null);
    toast(`${ok} de ${plan.length} albaranes renombrados en Drive`);
  };

  const nextAlb = Math.max(0, ...rows.map((a) => a.number ?? 0)) + 1;

  return (
    <div className="pb-16">
      <PageHeader
        title="Albaranes"
        actions={
          drive.layout?.albaranesId ? (
            <div className="flex flex-wrap gap-2">
              <Button icon={<RefreshCw size={14} />} loading={busy === 'sync'} onClick={() => void sync()}>
                Leer de Drive
              </Button>
              {rows.length > 0 && (
                <Button icon={<Hash size={14} />} loading={busy === 'number' || busy === 'rename'} onClick={() => void prepareNumbering()}>
                  Numerar y renombrar
                </Button>
              )}
            </div>
          ) : undefined
        }
      />
      <p className="mt-2 max-w-2xl px-4 text-[13.5px] text-ink-2 md:px-8">
        Las hojas de <strong>02 - ALBARANES</strong>, numeradas por fecha, con lo que está pendiente de cobro. Van aparte de Facturación: no entran en los trimestres.
      </p>
      {!drive.enabled ? null : !drive.layout?.albaranesId ? (
        <div className="px-4 pt-6 md:px-8">
          <EmptyState title="Elige tu carpeta de la agencia">
            En{' '}
            <Link href="/settings" className="font-semibold underline">
              Ajustes → Cuentas de Google
            </Link>{' '}
            elige la carpeta AGENCIA: la app encontrará 02 - ALBARANES.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-4 pt-5 md:grid-cols-3 md:px-8">
            <Kpi label="Pendiente de cobro" value={formatEUR(pendingSum)} sub={`${rows.filter((a) => a.status === 'pending').length} albaranes`} />
            <Kpi label={`Cobrado ${year}`} value={formatEUR(paidYear)} />
            <Kpi label="Albaranes" value={String(rows.length)} muted />
          </div>
          <div className="flex flex-wrap items-center gap-3 px-4 pt-6 md:px-8">
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'pending', label: 'Pendientes' },
                { value: 'paid', label: 'Cobrados' },
              ]}
            />
            <a href={driveUrl(drive.account!, drive.layout.albaranesId)} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink">
              <FolderOpen size={13} /> Abrir carpeta
            </a>
          </div>
          <div className="px-4 pt-3 md:px-8">
            {!list ? (
              <Loading rows={4} />
            ) : shown.length === 0 ? (
              <EmptyState title={rows.length ? 'Nada en este filtro' : 'Aún no hay albaranes'}>{rows.length ? null : 'Pulsa «Leer de Drive» para traer los de 02 - ALBARANES.'}</EmptyState>
            ) : (
              <Card>
                <ul className="divide-y divide-line">
                  {shown.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                      <span className="tabular w-16 shrink-0 font-semibold">{a.number ? `ALB-${String(a.number).padStart(3, '0')}` : '—'}</span>
                      <span className="tabular w-14 shrink-0 text-[12px] text-ink-3">{shortDate(a.date)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{labelOf(a, owner)}</span>
                        <span className="block truncate text-[11.5px] text-ink-3">
                          {a.recipients.join(' · ')}
                          {a.lines ? ` · ${a.lines} trabajos` : ''}
                        </span>
                      </span>
                      <span className="tabular w-24 text-right font-semibold">{formatEUR(a.total)}</span>
                      <button
                        type="button"
                        onClick={() => void act('albaran.update', { id: a.id, patch: { status: a.status === 'paid' ? 'pending' : 'paid' } }, a.status === 'paid' ? 'Vuelve a pendiente' : 'Marcado como cobrado')}
                        className={clsx('rounded-[4px]')}
                        aria-label="Cambiar estado de cobro"
                      >
                        {a.status === 'paid' ? <Badge tone="ok">Cobrado{a.paidAt ? ` ${shortDate(a.paidAt)}` : ''}</Badge> : <Badge tone="warn">Pendiente</Badge>}
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Copy size={13} />}
                        onClick={() => setDup({ file: { id: a.driveFileId, name: a.driveName, mimeType: SHEET_MIME, parents: [drive.layout!.albaranesId!] }, t: parseSheetTitle(a.driveName, owner), source: 'albaranes' })}
                      >
                        Duplicar
                      </Button>
                      <a href={`https://docs.google.com/spreadsheets/d/${a.driveFileId}/edit`} target="_blank" rel="noreferrer" className="text-ink-3 hover:text-ink" aria-label="Abrir en Sheets">
                        <ExternalLink size={14} />
                      </a>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        open={!!preview}
        title={`¿Renombrar ${preview?.length ?? 0} albaranes en Drive?`}
        description={preview ? preview.slice(0, 8).map((p) => `${p.a.driveName} → ${p.to}`).join('\n') + (preview.length > 8 ? `\n… y ${preview.length - 8} más` : '') : ''}
        confirmLabel="Renombrar"
        onOpenChange={(o) => !o && setPreview(null)}
        onConfirm={() => void rename()}
      />
      {dup && <DuplicateSheet entry={dup} owner={owner} suggested={String(nextAlb).padStart(3, '0')} albaran onClose={() => setDup(null)} onDone={() => void sync()} />}
    </div>
  );
}
