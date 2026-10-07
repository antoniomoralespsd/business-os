'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { Client, DriveLayout, DriveRef, InboxItem, IssuerSettings, Subscription } from '@bos/schemas';
import { classifyDocument, mergeAiExtraction, pathHints, todayISO } from '@bos/domain';
import { useGoogleSettings } from '@/data/hooks';
import { callAction } from '@/lib/actionsClient';
import { DATA_MODE } from '@/lib/config';
import { billingFolderId, connectDrive, download, DriveAuthNeeded, hasToken, inboxFolderId, moveTo, onDriveTokens, uploadTo, walk, warmUpDrive } from '@/lib/drive';
import { aiExtract } from '@/lib/aiExtract';
import { documentText, extOf, sha256 } from '@/lib/fileTools';
import { verdictFor, type PickedFile } from '@/lib/folderFiles';

/* ---------- Drive state ---------- */

/** The account where invoices are stored, your agency folder, and whether this tab has a valid token. */
export function useDrive() {
  const google = useGoogleSettings();
  const account = google?.billingAccount ?? null;
  useEffect(() => warmUpDrive(), []);
  const ready = useSyncExternalStore(onDriveTokens, () => (account ? hasToken(account) : false), () => false);
  return { enabled: DATA_MODE === 'firestore', settings: google, account, layout: google?.layout ?? null, ready };
}

/** Connects (popup) and registers the account. Must run from a click. */
export async function connectAndRegister(hint?: string): Promise<string | null> {
  try {
    const email = await connectDrive(hint);
    await callAction('settings.google', { add: email });
    return email;
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/popup-closed|cancelled-popup/.test(msg)) return null;
    if (/popup-blocked/.test(msg)) toast.error('El navegador ha bloqueado la ventana de Google. Permite ventanas emergentes para esta web.');
    else toast.error(msg || 'No se pudo conectar con Google');
    return null;
  }
}

/** Makes sure there's a token for the account; opens the popup if not (call from a click). */
export async function ensureDrive(account: string | null): Promise<boolean> {
  if (!account) return false;
  if (hasToken(account)) return true;
  return !!(await connectAndRegister(account));
}

/* ---------- batch processing ---------- */

export type BatchState = {
  label: string;
  total: number;
  done: number;
  created: number;
  already: number;
  archives: number;
  unsupported: number;
  savedToDrive: number;
  reread: number;
  linked: number;
  errors: { name: string; message: string }[];
  running: boolean;
};
const EMPTY: BatchState = { label: '', total: 0, done: 0, created: 0, already: 0, archives: 0, unsupported: 0, savedToDrive: 0, reread: 0, linked: 0, errors: [], running: false };

type Ctx = { items: InboxItem[] | null; clients: Client[] | null; subs: Subscription[] | null; issuer: IssuerSettings | null };

export async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) await fn(list[i++]!);
    }),
  );
}

export function classifyCtx(c: Ctx) {
  return {
    issuer: { name: c.issuer?.name ?? '', legalName: c.issuer?.legalName ?? '', taxId: c.issuer?.taxId ?? '' },
    clients: c.clients ?? [],
    subscriptions: c.subs ?? [],
    today: todayISO(),
  };
}

/** Where a confirmed file goes and with which name. Income and files already in your Drive keep their name. */
async function targetFor(account: string, layout: DriveLayout | null, it: InboxItem) {
  if (it.status === 'discarded') return { folder: await inboxFolderId(account, layout, true), name: undefined };
  const f = it.filedAs!;
  const folder = await billingFolderId(account, layout, f.date, f.kind, f.rectificativa);
  const keep = it.drive?.keepName || f.kind === 'income';
  return { folder, name: keep ? undefined : f.name };
}

/** Rules first (instant, offline), then AI on top when it's available. */
export async function readDocument(file: File, path: string, c: Ctx) {
  const { text } = await documentText(file);
  const cctx = classifyCtx(c);
  const rules = classifyDocument({ filename: file.name, mimeType: file.type, text, path }, cctx);
  const ai = await aiExtract(file, {
    path,
    owner: { name: c.issuer?.legalName || c.issuer?.name || '', taxId: c.issuer?.taxId ?? '' },
    clients: (c.clients ?? []).filter((x) => x.status !== 'archived').map((x) => x.name),
  });
  const proposal = ai ? mergeAiExtraction(rules, ai, { ownTaxId: cctx.issuer.taxId, clients: cctx.clients, folderKind: pathHints(path).kind }) : rules;
  return { text, proposal, ai: !!ai };
}

export function useInboxPipeline(ctx: Ctx) {
  const { enabled, account, layout } = useDrive();
  const [batch, setBatch] = useState<BatchState>(EMPTY);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const accRef = useRef({ account, layout });
  accRef.current = { account, layout };
  /** Files read in this tab that still need to reach Drive (lost on reload; re-dropping them fixes it). */
  const waiting = useRef(new Map<string, File>());
  const [waitingCount, setWaitingCount] = useState(0);
  const syncing = useRef(new Set<string>());

  const bump = (p: Partial<BatchState> | ((b: BatchState) => Partial<BatchState>)) => setBatch((b) => ({ ...b, ...(typeof p === 'function' ? p(b) : p) }));
  const setWaiting = () => setWaitingCount(waiting.current.size);

  /** Uploads a file to the "pending" folder (or straight to its final folder if already confirmed). */
  const saveOne = useCallback(
    async (id: string, file: File, item?: InboxItem) => {
      const { account: acc, layout: lay } = accRef.current;
      if (!enabled || !acc || !hasToken(acc)) {
        waiting.current.set(id, file);
        setWaiting();
        return false;
      }
      try {
        let ref: DriveRef;
        if (item?.status === 'completed' && item.filedAs) {
          const t = await targetFor(acc, lay, item);
          ref = { ...(await uploadTo(acc, file, t.name ?? file.name, t.folder)), filed: true };
        } else ref = await uploadTo(acc, file, file.name, await inboxFolderId(acc, lay));
        await callAction('inbox.attachDrive', { id, drive: ref });
        waiting.current.delete(id);
        setWaiting();
        return true;
      } catch (e) {
        waiting.current.set(id, file);
        setWaiting();
        if (!(e instanceof DriveAuthNeeded)) throw e;
        return false;
      }
    },
    [enabled],
  );

  /** Reads a file, proposes a classification and creates the Inbox item. */
  const ingest = useCallback(async (file: File, path: string, hash: string): Promise<string> => {
    const isPdf = file.type === 'application/pdf' || extOf(file.name) === 'pdf';
    const { text, proposal } = await readDocument(file, path, ctxRef.current);
    const r = await callAction<{ id: string }>('inbox.create', {
      filename: file.name.slice(0, 250),
      mimeType: file.type || (isPdf ? 'application/pdf' : 'application/octet-stream'),
      size: file.size,
      sha256: hash,
      storagePath: null,
      sourcePath: path.slice(0, 500),
      textExcerpt: text.slice(0, 20000),
      proposal,
    });
    return r.id;
  }, []);

  /** Re-reads a pending item that never got text (photos uploaded before OCR existed). */
  const reread = useCallback(async (existing: InboxItem, file: File, path: string, force = false) => {
    if (existing.status !== 'needs_confirmation') return false;
    if (!force && existing.textExcerpt.replace(/\s/g, '').length >= 30 && existing.proposal.total.value !== null) return false;
    const { text, proposal } = await readDocument(new File([file], existing.filename, { type: existing.mimeType || file.type }), existing.sourcePath || path, ctxRef.current);
    await callAction('inbox.updateProposals', { items: [{ id: existing.id, proposal, textExcerpt: text.slice(0, 4000) }] });
    return true;
  }, []);

  /** Reads pending files again (from Drive) with the best method available — AI when active. */
  const rereadPending = useCallback(
    async (list: InboxItem[]) => {
      const { account: acc } = accRef.current;
      const withFile = list.filter((i) => i.drive && i.drive.account === acc);
      setBatch({ ...EMPTY, label: 'Releyendo', total: withFile.length, running: true });
      await pool(withFile, 3, async (it) => {
        try {
          const blob = await download(acc!, it.drive!.fileId);
          if (await reread(it, new File([blob], it.filename, { type: it.mimeType }), it.sourcePath, true)) bump((b) => ({ reread: b.reread + 1 }));
        } catch (e) {
          bump((b) => ({ errors: [...b.errors, { name: it.filename, message: e instanceof Error ? e.message : 'Error' }] }));
        } finally {
          bump((b) => ({ done: b.done + 1 }));
        }
      });
      bump({ running: false });
      return list.length - withFile.length;
    },
    [reread],
  );

  /** Files dropped or picked from the computer. */
  const process = useCallback(
    async (picked: PickedFile[]) => {
      const docs = picked.filter((p) => verdictFor(p.file.name) === 'document');
      const archives = picked.filter((p) => verdictFor(p.file.name) === 'archive').length;
      setBatch({ ...EMPTY, label: 'Leyendo', total: docs.length, archives, unsupported: picked.length - docs.length - archives, running: true });
      const bySha = new Map((ctxRef.current.items ?? []).map((i) => [i.sha256, i]));
      const seen = new Set<string>();
      await pool(docs, 3, async ({ file, path }) => {
        try {
          const hash = await sha256(file);
          if (seen.has(hash)) return bump((b) => ({ already: b.already + 1 }));
          seen.add(hash);
          const existing = bySha.get(hash);
          if (existing) {
            if (!existing.drive && (await saveOne(existing.id, file, existing))) bump((b) => ({ savedToDrive: b.savedToDrive + 1 }));
            if (await reread(existing, file, path)) bump((b) => ({ reread: b.reread + 1 }));
            return bump((b) => ({ already: b.already + 1 }));
          }
          const id = await ingest(file, path, hash);
          bump((b) => ({ created: b.created + 1 }));
          if (enabled && (await saveOne(id, file))) bump((b) => ({ savedToDrive: b.savedToDrive + 1 }));
        } catch (e) {
          bump((b) => ({ errors: [...b.errors, { name: path, message: e instanceof Error ? e.message : 'Error' }] }));
        } finally {
          bump((b) => ({ done: b.done + 1 }));
        }
      });
      bump({ running: false });
    },
    [enabled, saveOne, ingest, reread],
  );

  /**
   * Reads what's already in your Drive (00 - AÑOS/<year>) and registers it, without moving or renaming.
   * Files also uploaded from the PC are matched by content and linked, not duplicated.
   */
  const importFromDrive = useCallback(
    async (folder: { id: string; name: string }) => {
      const { account: acc } = accRef.current;
      if (!acc) return;
      setBatch({ ...EMPTY, label: `Leyendo ${folder.name} en Drive`, running: true });
      try {
        const files = (await walk(acc, folder.id, folder.name)).filter((f) => verdictFor(f.name) === 'document');
        const items = ctxRef.current.items ?? [];
        const known = new Set(items.map((i) => i.drive?.fileId).filter(Boolean));
        const todo = files.filter((f) => !known.has(f.id));
        bump({ total: todo.length, already: files.length - todo.length });
        const bySha = new Map(items.map((i) => [i.sha256, i]));
        await pool(todo, 3, async (f) => {
          try {
            const blob = await download(acc, f.id);
            const file = new File([blob], f.name, { type: f.mimeType });
            const hash = await sha256(file);
            const ref: DriveRef = { account: acc, fileId: f.id, name: f.name, folder: f.path.split('/').slice(0, -1).join('/'), folderId: f.parents?.[0] ?? '', webViewLink: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`, filed: false, keepName: true };
            const existing = bySha.get(hash);
            if (existing) {
              await callAction('inbox.attachDrive', { id: existing.id, drive: { ...ref, filed: existing.status !== 'needs_confirmation' ? false : ref.filed } });
              if (await reread(existing, file, f.path)) bump((b) => ({ reread: b.reread + 1 }));
              bump((b) => ({ linked: b.linked + 1 }));
              return;
            }
            const id = await ingest(file, f.path, hash);
            bySha.set(hash, { id } as InboxItem);
            await callAction('inbox.attachDrive', { id, drive: ref });
            bump((b) => ({ created: b.created + 1 }));
          } catch (e) {
            if (e instanceof DriveAuthNeeded) throw e;
            bump((b) => ({ errors: [...b.errors, { name: f.path, message: e instanceof Error ? e.message : 'Error' }] }));
          } finally {
            bump((b) => ({ done: b.done + 1 }));
          }
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Error leyendo Drive');
      }
      bump({ running: false });
    },
    [ingest, reread],
  );

  /** Uploads what's waiting and files confirmed/discarded items into their folders. */
  const syncDrive = useCallback(
    async (interactive: boolean) => {
      const { account: acc, layout: lay } = accRef.current;
      if (!enabled || !acc) return;
      if (!hasToken(acc)) {
        if (!interactive || !(await connectAndRegister(acc))) return;
      }
      const items = ctxRef.current.items ?? [];
      let moved = 0;
      let uploaded = 0;
      try {
        for (const [id, file] of [...waiting.current]) if (await saveOne(id, file, items.find((i) => i.id === id))) uploaded++;
        const todo = items.filter((it) => it.drive && !it.drive.filed && it.drive.account === acc && !syncing.current.has(it.id) && ((it.status === 'completed' && it.filedAs) || it.status === 'discarded'));
        await pool(todo, 3, async (it) => {
          syncing.current.add(it.id);
          try {
            const t = await targetFor(acc, lay, it);
            const ref = await moveTo(it.drive!, t.folder, t.name);
            await callAction('inbox.attachDrive', { id: it.id, drive: { ...ref, filed: true } });
            moved++;
          } finally {
            syncing.current.delete(it.id);
          }
        });
      } catch (e) {
        if (!(e instanceof DriveAuthNeeded)) toast.error(e instanceof Error ? e.message : 'Error con Google Drive');
      }
      if (interactive && (moved || uploaded)) toast(`Drive al día: ${[uploaded && `${uploaded} subidos`, moved && `${moved} ordenados`].filter(Boolean).join(' · ')}`);
    },
    [enabled, saveOne],
  );

  // Whenever something gets confirmed or discarded and we have a token, file it quietly.
  const pendingMoves = (ctx.items ?? []).filter((i) => i.drive && !i.drive.filed && i.drive.account === account && (i.status === 'discarded' || (i.status === 'completed' && i.filedAs))).length;
  useEffect(() => {
    if (pendingMoves && account && hasToken(account)) void syncDrive(false);
  }, [pendingMoves, account, syncDrive]);

  /** Removes pending/discarded items; their Drive copies (if any) go to "Descartados", never to the bin. */
  const removeItems = useCallback(async (list: InboxItem[]) => {
    const { account: acc, layout: lay } = accRef.current;
    const withDrive = list.filter((i) => i.drive && !i.drive.keepName);
    if (withDrive.length && acc && hasToken(acc)) {
      const folder = await inboxFolderId(acc, lay, true);
      await pool(withDrive, 3, async (i) => {
        await moveTo(i.drive!, folder).catch(() => undefined);
      });
    }
    for (const i of list) waiting.current.delete(i.id);
    setWaiting();
    let removed = 0;
    for (let k = 0; k < list.length; k += 400) removed += (await callAction<{ removed: number }>('inbox.remove', { ids: list.slice(k, k + 400).map((i) => i.id) })).removed;
    return removed;
  }, []);

  return { batch, process, importFromDrive, rereadPending, syncDrive, removeItems, waitingCount, pendingMoves, clearBatch: () => setBatch(EMPTY) };
}
