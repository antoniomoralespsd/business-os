'use client';
import clsx from 'clsx';
import { AlertTriangle, ChevronDown, CloudOff, FolderInput, FolderUp, HardDrive, RefreshCw, Sparkles, Trash2, UploadCloud, Wand2, X } from 'lucide-react';
import { aiUnavailable, onAiStatus } from '@/lib/aiExtract';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { Client, InboxItem } from '@bos/schemas';
import { classifyDocument, formatEUR, todayISO } from '@bos/domain';
import { Badge, Button, Card, EmptyState, Loading, PageHeader, Segmented, Select, Toggle } from '@/components/ui/kit';
import { act, useClientMap, useClients, useInbox, useIssuer, useSubscriptions } from '@/data/hooks';
import { callAction } from '@/lib/actionsClient';
import { driveUrl, FOLDER_MIME, hasToken, listChildren } from '@/lib/drive';
import { filesFromDrop, filesFromInput, type PickedFile } from '@/lib/folderFiles';
import { shortDate } from '@/lib/format';
import { confidenceOf, draftFrom, groupPending, looksPaid, type ConfirmInput, type Group, type Override } from './drafts';
import { classifyCtx, connectAndRegister, ensureDrive, useDrive, useInboxPipeline, type BatchState } from './pipeline';
import { Conf, FileIcon, FileLink, ProposalCard } from './ProposalCard';

type View = 'all' | 'income' | 'expense' | 'other';
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*';

export function InboxView() {
  const { data: items } = useInbox();
  const { data: clients } = useClients();
  const { data: subs } = useSubscriptions();
  const issuer = useIssuer();
  const byId = useClientMap(clients);
  const drive = useDrive();
  const pipe = useInboxPipeline({ items, clients, subs, issuer });
  const [drag, setDrag] = useState(false);
  const [view, setView] = useState<View>('all');
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const today = todayISO();
  const ctxRef = useRef({ items, clients, subs, issuer });
  ctxRef.current = { items, clients, subs, issuer };

  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
  }, []);

  const pending = useMemo(() => (items ?? []).filter((i) => i.status === 'needs_confirmation'), [items]);
  const groups = useMemo(() => groupPending(pending, byId), [pending, byId]);
  const done = useMemo(() => (items ?? []).filter((i) => i.status !== 'needs_confirmation').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 15), [items]);
  const notInDrive = useMemo(() => (items ?? []).filter((i) => i.status !== 'discarded' && !i.drive).length, [items]);

  /** Everything that can be confirmed without looking: no missing data, decent confidence, not a duplicate. */
  const ready = useMemo(
    () =>
      pending
        .filter((i) => i.proposal.kind.value !== 'other' && !i.duplicateOf && confidenceOf(i) >= 0.4)
        .map((i) => ({ item: i, d: draftFrom(i, byId, today) }))
        .filter((x): x is { item: InboxItem; d: { input: ConfirmInput; missing: string[] } } => !!x.d.input),
    [pending, byId, today],
  );

  const start = (picked: Promise<PickedFile[]> | PickedFile[]) => {
    // A drop/click is the only moment the browser lets us open the Google window.
    if (drive.enabled && drive.account && !hasToken(drive.account)) void connectAndRegister(drive.account);
    void Promise.resolve(picked).then((list) => (list.length ? pipe.process(list) : undefined));
  };

  /** Confirms a list in order; then re-reads the rest with what was learned (new clients, NIFs). */
  const confirmMany = async (list: ConfirmInput[]) => {
    if (!list.length) return;
    if (drive.enabled && drive.account && !hasToken(drive.account)) void connectAndRegister(drive.account);
    setBulk({ done: 0, total: list.length });
    let ok = 0;
    let learned = false;
    const failed: string[] = [];
    for (const input of list) {
      try {
        const r = await callAction<{ learned?: boolean }>('inbox.confirm', input);
        ok++;
        learned ||= !!r?.learned;
      } catch (e) {
        failed.push(e instanceof Error ? e.message : 'Error');
      }
      setBulk({ done: ok + failed.length, total: list.length });
    }
    setBulk(null);
    toast(`${ok} ${ok === 1 ? 'archivo confirmado' : 'archivos confirmados'}${failed.length ? ` · ${failed.length} con error: ${failed[0]}` : ''}`);
    if (learned) setTimeout(() => void reclassify(true), 1200);
  };

  /** Runs the classifier again on pending files with today's clients and settings. */
  const reclassify = async (quiet = false) => {
    const c = ctxRef.current;
    const list = (c.items ?? []).filter((i) => i.status === 'needs_confirmation');
    const changed = list
      .map((i) => ({ id: i.id, before: i.proposal, proposal: classifyDocument({ filename: i.filename, mimeType: i.mimeType, text: i.textExcerpt, path: i.sourcePath }, classifyCtx(c)) }))
      .filter((x) => JSON.stringify(x.before) !== JSON.stringify(x.proposal));
    for (let k = 0; k < changed.length; k += 200) await callAction('inbox.updateProposals', { items: changed.slice(k, k + 200).map(({ id, proposal }) => ({ id, proposal })) });
    if (!quiet || changed.length) toast(changed.length ? `${changed.length} archivos reclasificados` : 'Nada que cambiar');
  };

  const shown = (k: View) => view === 'all' || view === k;
  const incomeCount = groups.income.reduce((s, g) => s + g.items.length, 0);
  const expenseCount = groups.expense.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="pb-16">
      <PageHeader title="Inbox" />
      <p className="mt-2 max-w-2xl px-4 text-[13.5px] leading-relaxed text-ink-2 md:px-8">
        Suelta archivos o carpetas enteras (por ejemplo tu carpeta de facturas del año). La app lee cada documento, decide si es gasto o ingreso, lo asigna a su cliente y, al confirmar, lo guarda ordenado en Facturación y en tu Google Drive.
      </p>

      <div className="space-y-3 px-4 pt-5 md:px-8">
        <DriveBar notInDrive={notInDrive} waiting={pipe.waitingCount} pendingMoves={pipe.pendingMoves} onSync={() => void pipe.syncDrive(true)} />
        {issuer && !issuer.taxId && (
          <p className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-2">
            <AlertTriangle size={14} className="shrink-0 text-warn" />
            Pon tu NIF en{' '}
            <Link href="/settings" className="font-semibold underline">
              Ajustes → Datos fiscales
            </Link>{' '}
            para distinguir mejor tus facturas emitidas de las recibidas.
          </p>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            start(filesFromDrop(e.dataTransfer));
          }}
          className={clsx('relative flex flex-col items-center justify-center overflow-hidden rounded-[16px] border-2 border-dashed px-6 py-9 text-center transition-colors', drag ? 'border-transparent bg-surface' : 'border-line-strong')}
        >
          {drag && <span className="iris-bar-x absolute inset-0 -z-0 opacity-20" aria-hidden />}
          <UploadCloud size={28} className="relative text-ink-2" />
          <p className="font-display relative mt-3 text-[26px] leading-tight">Suelta archivos o carpetas</p>
          <p className="relative mt-1 text-[12.5px] text-ink-3">PDF, JPG, PNG o fotos del móvil · las subcarpetas «Gastos», «Ingresos», «Rectificativas» y el mes ayudan a clasificar · los ZIP se ignoran</p>
          <div className="relative mt-4 flex flex-wrap justify-center gap-2">
            <Button icon={<UploadCloud size={14} />} onClick={() => filesRef.current?.click()}>
              Elegir archivos
            </Button>
            <Button icon={<FolderUp size={14} />} onClick={() => folderRef.current?.click()}>
              Subir una carpeta
            </Button>
          </div>
          <input
            ref={filesRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) start(filesFromInput(e.target.files));
              e.target.value = '';
            }}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) start(filesFromInput(e.target.files));
              e.target.value = '';
            }}
          />
        </div>

        <DriveImport onImport={(f) => void pipe.importFromDrive(f)} busy={pipe.batch.running} />
        <BatchProgress b={pipe.batch} onClose={pipe.clearBatch} />
        <AiStatus />
      </div>

      <div className="px-4 pt-8 md:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <p className="eyebrow text-ink-2">Por confirmar · {pending.length}</p>
          {pending.length > 0 && (
            <Segmented<View>
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'all', label: 'Todo' },
                { value: 'income', label: `Ingresos ${incomeCount}` },
                { value: 'expense', label: `Gastos ${expenseCount}` },
                { value: 'other', label: `Otros ${groups.other.length}` },
              ]}
            />
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {pending.length > 0 && (
              <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void reclassify()}>
                Volver a clasificar
              </Button>
            )}
            {pending.some((i) => i.drive) && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Sparkles size={13} />}
                loading={pipe.batch.running && pipe.batch.label === 'Releyendo'}
                onClick={async () => {
                  if (!(await ensureDrive(drive.account))) return;
                  const skipped = await pipe.rereadPending(pending);
                  if (skipped) toast(`${skipped} sin copia en Drive: vuelve a soltarlos para releerlos`);
                }}
              >
                Releer pendientes
              </Button>
            )}
            {pending.length > 0 && (
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirmClear(true)}>
                Quitar todo lo pendiente
              </Button>
            )}
            {ready.length > 0 && (
              <Button size="sm" variant="primary" icon={<Wand2 size={13} />} loading={!!bulk} onClick={() => void confirmMany(ready.map((r) => r.d.input))}>
                Confirmar todo lo listo ({ready.length})
              </Button>
            )}
          </div>
        </div>
        {bulk && (
          <div className="mt-3">
            <Bar value={bulk.done} max={bulk.total} label={`Confirmando ${bulk.done} de ${bulk.total}…`} />
          </div>
        )}

        <div className="mt-4 space-y-6">
          {!items ? (
            <Loading />
          ) : pending.length === 0 ? (
            <EmptyState title="Bandeja vacía">Todo lo que subas aparecerá aquí, agrupado por cliente, para que lo confirmes de una vez.</EmptyState>
          ) : (
            <>
              {shown('income') && groups.income.length > 0 && (
                <section className="space-y-3">
                  <p className="eyebrow text-ink-3">Ingresos · por cliente</p>
                  {groups.income.map((g) => (
                    <GroupCard key={g.key} group={g} kind="income" clients={clients ?? []} byId={byId} today={today} onConfirm={confirmMany} onRemove={pipe.removeItems} busy={!!bulk} />
                  ))}
                </section>
              )}
              {shown('expense') && groups.expense.length > 0 && (
                <section className="space-y-3">
                  <p className="eyebrow text-ink-3">Gastos · por mes</p>
                  {groups.expense.map((g) => (
                    <GroupCard key={g.key} group={g} kind="expense" clients={clients ?? []} byId={byId} today={today} onConfirm={confirmMany} onRemove={pipe.removeItems} busy={!!bulk} />
                  ))}
                </section>
              )}
              {shown('other') && groups.other.length > 0 && (
                <section className="space-y-3">
                  <p className="eyebrow text-ink-3">Otros documentos</p>
                  {groups.other.map((i) => (
                    <ProposalCard key={i.id} item={i} onRemove={() => void pipe.removeItems([i])} />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title={`¿Quitar los ${pending.length} archivos pendientes?`}
        description="Se quitan del Inbox sin crear nada en Facturación. Tus archivos del ordenador no se tocan; las copias que la app subió a Drive van a «Descartados». Puedes volver a subirlos cuando quieras."
        confirmLabel="Quitar"
        danger
        onOpenChange={setConfirmClear}
        onConfirm={() => {
          setConfirmClear(false);
          void pipe.removeItems(pending).then((n) => toast(`${n} archivos quitados del Inbox`));
        }}
      />

      {done.length > 0 && (
        <div className="px-4 pt-10 md:px-8">
          <p className="eyebrow mb-2 text-ink-3">Procesados recientemente</p>
          <Card>
            <ul className="divide-y divide-line">
              {done.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <FileIcon mime={i.mimeType} />
                  <span className="min-w-0 flex-1 truncate">{i.filedAs?.name ?? i.filename}</span>
                  {i.drive && <span className="hidden truncate text-[11.5px] text-ink-3 md:inline">{i.drive.folder.replace(/^Business OS\//, '')}</span>}
                  {i.status === 'discarded' ? (
                    <Badge>Descartado</Badge>
                  ) : i.result?.kind === 'expense' ? (
                    <Link href="/billing?tab=expenses" className="text-[12px] font-semibold text-ink-2 hover:text-ink">
                      Gasto →
                    </Link>
                  ) : i.result?.kind === 'income' ? (
                    <Link href={`/billing?tab=invoices&invoice=${i.result.id}`} className="text-[12px] font-semibold text-ink-2 hover:text-ink">
                      Ingreso →
                    </Link>
                  ) : (
                    <Badge>Documento</Badge>
                  )}
                  <span className="tabular w-16 text-right text-[12px] text-ink-3">{shortDate(i.updatedAt.slice(0, 10))}</span>
                  <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => void act('inbox.undo', { id: i.id }, 'Deshecho: vuelve a estar por confirmar')}>
                    Deshacer
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ---------- pieces ---------- */

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="iris-bar-x h-full transition-[width] duration-300" style={{ width: `${max ? Math.round((value / max) * 100) : 0}%` }} />
      </div>
      <p className="tabular mt-1.5 text-[12px] text-ink-3">{label}</p>
    </div>
  );
}

function BatchProgress({ b, onClose }: { b: BatchState; onClose: () => void }) {
  if (!b.running && !b.total && !b.archives && !b.unsupported && !b.already) return null;
  const facts = [
    b.created && `${b.created} nuevos`,
    b.already && `${b.already} ya estaban`,
    b.reread && `${b.reread} releídos con OCR`,
    b.linked && `${b.linked} enlazados con lo que ya habías subido`,
    b.savedToDrive && `${b.savedToDrive} guardados en Drive`,
    b.archives && `${b.archives} ZIP ignorados`,
    b.unsupported && `${b.unsupported} de otro tipo ignorados`,
  ].filter(Boolean);
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {b.running ? <Bar value={b.done} max={b.total} label={b.total ? `${b.label} ${b.done} de ${b.total}… (las fotos tardan unos segundos cada una)` : `${b.label}…`} /> : <p className="text-[13px] font-semibold">{b.total ? `Listo: ${b.total} documentos leídos` : 'No había documentos que leer'}</p>}
          {facts.length > 0 && <p className="mt-1 text-[12px] text-ink-3">{facts.join(' · ')}</p>}
          {b.errors.length > 0 && (
            <details className="mt-2 text-[12px]">
              <summary className="cursor-pointer text-danger">{b.errors.length} con error</summary>
              <ul className="mt-1 space-y-0.5 text-ink-3">
                {b.errors.slice(0, 30).map((e, k) => (
                  <li key={k} className="truncate">
                    {e.name}: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        {!b.running && (
          <button type="button" aria-label="Cerrar" onClick={onClose} className="text-ink-3 hover:text-ink">
            <X size={14} />
          </button>
        )}
      </div>
    </Card>
  );
}

export function DriveBar({ notInDrive = 0, waiting = 0, pendingMoves = 0, onSync }: { notInDrive?: number; waiting?: number; pendingMoves?: number; onSync?: () => void }) {
  const drive = useDrive();
  if (!drive.enabled || !drive.settings) return null;
  if (!drive.account)
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2.5">
        <CloudOff size={15} className="shrink-0 text-ink-3" />
        <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">Conecta tu Google Drive para que cada archivo se guarde en su carpeta de año, mes e ingresos o gastos.</p>
        <Button size="sm" variant="primary" onClick={() => void connectAndRegister()}>
          Conectar Google Drive
        </Button>
      </div>
    );
  const extra = waiting + pendingMoves;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2.5">
      <HardDrive size={15} className="shrink-0 text-ink-2" />
      <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">
        Drive de <strong className="text-ink">{drive.account}</strong> · {drive.layout ? <>carpeta «{drive.layout.rootName}»</> : <Link href="/settings" className="font-semibold underline">elige la carpeta de la agencia en Ajustes</Link>}
        {!drive.ready && <span className="text-ink-3"> · hay que reconectar (Google pide permiso cada hora)</span>}
        {extra > 0 && <span className="text-ink-3"> · {[waiting && `${waiting} por subir`, pendingMoves && `${pendingMoves} por ordenar`].filter(Boolean).join(', ')}</span>}
        {!extra && notInDrive > 0 && <span className="text-ink-3"> · {notInDrive} sin copia en Drive (vuelve a soltarlos o impórtalos desde Drive)</span>}
      </p>
      {(!drive.ready || extra > 0) && onSync && (
        <Button size="sm" variant={drive.ready ? 'secondary' : 'primary'} onClick={onSync}>
          {drive.ready ? 'Guardar en Drive ahora' : 'Reconectar'}
        </Button>
      )}
      <a href={driveUrl(drive.account, drive.layout?.rootId)} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-ink-2 hover:text-ink">
        Abrir Drive →
      </a>
    </div>
  );
}

function AiStatus() {
  const why = useSyncExternalStore(onAiStatus, aiUnavailable, () => null);
  if (!why) return null;
  return (
    <p className="flex items-start gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-2">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
      <span>
        {why}. Se ha usado la lectura básica (menos precisa con fotos e IVA). Actívala en{' '}
        <Link href="/settings" className="font-semibold underline">
          Ajustes → Lectura con IA
        </Link>{' '}
        y pulsa «Releer pendientes».
      </span>
    </p>
  );
}

/** Registers what's already in 00 - AÑOS/<year>, without moving or renaming anything. */
function DriveImport({ onImport, busy }: { onImport: (f: { id: string; name: string }) => void; busy: boolean }) {
  const drive = useDrive();
  const [years, setYears] = useState<{ id: string; name: string }[] | null>(null);
  const [year, setYear] = useState('');
  if (!drive.enabled || !drive.account || !drive.layout?.yearsId) return null;
  const load = async () => {
    if (!(await ensureDrive(drive.account))) return;
    try {
      const kids = (await listChildren(drive.account!, drive.layout!.yearsId!, true)).filter((k) => k.mimeType === FOLDER_MIME).sort((a, b) => b.name.localeCompare(a.name));
      setYears(kids.map((k) => ({ id: k.id, name: k.name })));
      setYear(kids[0]?.id ?? '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo leer Drive');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed border-line-strong px-3 py-2.5">
      <FolderInput size={15} className="shrink-0 text-ink-2" />
      <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">¿Las facturas ya están en tu Drive? Impórtalas desde «00 - AÑOS» sin moverlas: se registran en Facturación y lo que subiste del PC se enlaza, no se duplica.</p>
      {years ? (
        <>
          <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-[120px]" aria-label="Año">
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="primary" loading={busy} disabled={!year} onClick={async () => {
            if (!(await ensureDrive(drive.account))) return;
            const y = years.find((x) => x.id === year);
            if (y) onImport(y);
          }}>
            Importar {years.find((y) => y.id === year)?.name}
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={() => void load()}>
          Importar desde Drive
        </Button>
      )}
    </div>
  );
}

const NEW = '__new';

function GroupCard({ group, kind, clients, byId, today, onConfirm, onRemove, busy }: { group: Group; kind: 'income' | 'expense'; clients: Client[]; byId: Map<string, Client>; today: string; onConfirm: (l: ConfirmInput[]) => Promise<void>; onRemove: (l: InboxItem[]) => Promise<number>; busy: boolean }) {
  const [open, setOpen] = useState(group.items.length <= 3);
  const [assign, setAssign] = useState<string>(group.clientId ?? (group.counterparty ? NEW : ''));
  const [paid, setPaid] = useState(group.items.every((i) => looksPaid(i.proposal.date.value, today)));
  const [editing, setEditing] = useState<string | null>(null);

  const ov: Override = kind === 'income' ? (assign === NEW ? { newClientName: group.counterparty, paid } : assign ? { clientId: assign, paid } : { paid }) : {};
  const drafts = group.items.map((i) => ({ item: i, d: draftFrom(i, byId, today, ov) }));
  const confirmable = drafts.filter((x) => x.d.input && !x.item.duplicateOf);
  const sum = group.items.reduce((s, i) => s + (i.proposal.total.value ?? 0) * (i.proposal.rectificativa ? -1 : 1), 0);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          <ChevronDown size={15} className={clsx('shrink-0 text-ink-3 transition-transform', !open && '-rotate-90')} />
          <div className="min-w-0">
            <p className="font-display truncate text-[20px] leading-tight">{group.label}</p>
            <p className="truncate text-[11.5px] text-ink-3">
              {group.items.length} {group.items.length === 1 ? 'archivo' : 'archivos'} · <span className="tabular">{formatEUR(sum)}</span>
              {group.sub ? ` · ${group.sub}` : ''}
            </p>
          </div>
        </button>
        {kind === 'income' && (
          <div className="flex flex-wrap items-center gap-3">
            <Select value={assign} onChange={(e) => setAssign(e.target.value)} className="w-[220px]" aria-label="Cliente para todo el grupo">
              <option value="">Cliente de cada factura</option>
              {group.counterparty && <option value={NEW}>+ Crear cliente «{group.counterparty}»</option>}
              {clients
                .filter((c) => c.status !== 'archived')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
            <Toggle on={paid} onChange={setPaid} label="Ya cobradas" />
          </div>
        )}
        <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => void onRemove(group.items).then((n) => toast(`${n} quitados del Inbox`))}>
          Quitar
        </Button>
        <Button size="sm" variant="primary" disabled={!confirmable.length || busy} onClick={() => void onConfirm(confirmable.map((x) => x.d.input!))}>
          Confirmar {confirmable.length}
          {confirmable.length < group.items.length ? ` de ${group.items.length}` : ''}
        </Button>
      </div>
      {open && (
        <ul className="divide-y divide-line border-t border-line">
          {drafts.map(({ item, d }) => (
            <li key={item.id}>
              {editing === item.id ? (
                <div className="bg-surface-2 p-3">
                  <ProposalCard item={item} onDone={() => setEditing(null)} onRemove={() => void onRemove([item])} />
                  <button type="button" className="mt-2 text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => setEditing(null)}>
                    Cerrar
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setEditing(item.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-surface-2">
                  <Conf c={confidenceOf(item)} reason={item.proposal.kind.reason} />
                  <span className="tabular w-14 shrink-0 text-[12px] text-ink-3">{shortDate(item.proposal.date.value)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {kind === 'expense' ? item.proposal.vendor.value ?? <em className="text-ink-3">sin proveedor</em> : item.proposal.invoiceNumber.value ?? <em className="text-ink-3">sin número</em>}
                    <span className="ml-2 text-[11.5px] text-ink-3">{item.filename}</span>
                  </span>
                  {item.proposal.rectificativa && <Badge tone="changes">Rectificativa</Badge>}
                  {item.duplicateOf && <Badge tone="warn">Duplicado</Badge>}
                  {d.missing.length > 0 && <Badge tone="danger">Falta {d.missing.join(', ')}</Badge>}
                  <span className="hidden sm:inline">
                    <FileLink item={item} />
                  </span>
                  <span className="tabular w-24 shrink-0 text-right font-semibold">{item.proposal.total.value !== null ? formatEUR(item.proposal.total.value * (item.proposal.rectificativa ? -1 : 1)) : '—'}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!open && group.items.some((i) => !draftFrom(i, byId, today, ov).input) && (
        <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">Algunos archivos necesitan un dato; ábrelo para revisarlos.</p>
      )}
    </Card>
  );
}
