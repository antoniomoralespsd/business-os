'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { Client, InboxItem, IssuerSettings, Subscription } from '@bos/schemas';
import { classifyDocument, todayISO } from '@bos/domain';
import { useGoogleSettings } from '@/data/hooks';
import { callAction } from '@/lib/actionsClient';
import { DATA_MODE } from '@/lib/config';
import { billingFolder, connectDrive, DISCARDED_FOLDER, DriveAuthNeeded, hasToken, INBOX_FOLDER, moveInDrive, onDriveTokens, uploadToDrive, warmUpDrive } from '@/lib/drive';
import { extOf, pdfText, sha256 } from '@/lib/fileTools';
import { verdictFor, type PickedFile } from '@/lib/folderFiles';

/* ---------- Drive state ---------- */

/** The account where invoices are stored, and whether this tab has a valid token for it. */
export function useDrive() {
  const google = useGoogleSettings();
  const account = google?.billingAccount ?? null;
  useEffect(() => warmUpDrive(), []);
  const tick = useSyncExternalStore(onDriveTokens, () => (account ? hasToken(account) : false), () => false);
  return { enabled: DATA_MODE === 'firestore', settings: google, account, ready: tick };
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

/* ---------- batch processing ---------- */

export type BatchState = {
  total: number;
  done: number;
  created: number;
  already: number;
  archives: number;
  unsupported: number;
  savedToDrive: number;
  waitingDrive: number;
  errors: { name: string; message: string }[];
  running: boolean;
};
const EMPTY: BatchState = { total: 0, done: 0, created: 0, already: 0, archives: 0, unsupported: 0, savedToDrive: 0, waitingDrive: 0, errors: [], running: false };

type Ctx = { items: InboxItem[] | null; clients: Client[] | null; subs: Subscription[] | null; issuer: IssuerSettings | null };

async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) await fn(list[i++]!);
  }));
}

export function classifyCtx(c: Ctx) {
  return {
    issuer: { name: c.issuer?.name ?? '', legalName: c.issuer?.legalName ?? '', taxId: c.issuer?.taxId ?? '' },
    clients: c.clients ?? [],
    subscriptions: c.subs ?? [],
    today: todayISO(),
  };
}

export function useInboxPipeline(ctx: Ctx) {
  const { enabled, account } = useDrive();
  const [batch, setBatch] = useState<BatchState>(EMPTY);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const accountRef = useRef(account);
  accountRef.current = account;
  /** Files read in this tab that still need to reach Drive (lost on reload; re-dropping them fixes it). */
  const waiting = useRef(new Map<string, File>());
  const [waitingCount, setWaitingCount] = useState(0);
  const syncing = useRef(new Set<string>());
  const [syncTick, setSyncTick] = useState(0);

  const bump = (p: Partial<BatchState> | ((b: BatchState) => Partial<BatchState>)) => setBatch((b) => ({ ...b, ...(typeof p === 'function' ? p(b) : p) }));

  const saveOne = useCallback(async (id: string, file: File, target: { name: string; path: string[] } | null) => {
    const acc = accountRef.current;
    if (!enabled || !acc || !hasToken(acc)) {
      waiting.current.set(id, file);
      setWaitingCount(waiting.current.size);
      return false;
    }
    try {
      const ref = await uploadToDrive(acc, file, target?.name ?? file.name, target?.path ?? INBOX_FOLDER);
      await callAction('inbox.attachDrive', { id, drive: ref });
      waiting.current.delete(id);
      setWaitingCount(waiting.current.size);
      return true;
    } catch (e) {
      waiting.current.set(id, file);
      setWaitingCount(waiting.current.size);
      if (!(e instanceof DriveAuthNeeded)) throw e;
      return false;
    }
  }, [enabled]);

  const process = useCallback(
    async (picked: PickedFile[]) => {
      const docs = picked.filter((p) => verdictFor(p.file.name) === 'document');
      const archives = picked.filter((p) => verdictFor(p.file.name) === 'archive').length;
      const unsupported = picked.length - docs.length - archives;
      setBatch({ ...EMPTY, total: docs.length, archives, unsupported, running: true });
      const bySha = new Map((ctxRef.current.items ?? []).map((i) => [i.sha256, i]));
      const seen = new Set<string>();

      await pool(docs, 3, async ({ file, path }) => {
        try {
          const hash = await sha256(file);
          if (seen.has(hash)) {
            bump((b) => ({ already: b.already + 1 }));
            return;
          }
          seen.add(hash);
          const existing = bySha.get(hash);
          if (existing) {
            // Already in the app: only make sure the file is in Drive.
            if (!existing.drive) {
              const target = existing.filedAs ? { name: existing.filedAs.name, path: billingFolder(existing.filedAs.date, existing.filedAs.kind, existing.filedAs.rectificativa) } : null;
              if (await saveOne(existing.id, file, target)) bump((b) => ({ savedToDrive: b.savedToDrive + 1 }));
            }
            bump((b) => ({ already: b.already + 1 }));
            return;
          }
          const isPdf = file.type === 'application/pdf' || extOf(file.name) === 'pdf';
          const text = isPdf ? await pdfText(file).catch(() => '') : '';
          const proposal = classifyDocument({ filename: file.name, mimeType: file.type, text, path }, classifyCtx(ctxRef.current));
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
          bump((b) => ({ created: b.created + 1 }));
          if (enabled) {
            if (await saveOne(r.id, file, null)) bump((b) => ({ savedToDrive: b.savedToDrive + 1 }));
          }
        } catch (e) {
          bump((b) => ({ errors: [...b.errors, { name: path, message: e instanceof Error ? e.message : 'Error' }] }));
        } finally {
          bump((b) => ({ done: b.done + 1 }));
        }
      });
      bump({ running: false, waitingDrive: waiting.current.size });
    },
    [enabled, saveOne],
  );

  /** Uploads what's waiting and files confirmed/discarded items into their folders. Call from a click if no token. */
  const syncDrive = useCallback(
    async (interactive: boolean) => {
      const acc = accountRef.current;
      if (!enabled || !acc) return;
      if (!hasToken(acc)) {
        if (!interactive) return;
        if (!(await connectAndRegister(acc))) return;
      }
      const items = ctxRef.current.items ?? [];
      let moved = 0;
      let uploaded = 0;
      try {
        for (const [id, file] of [...waiting.current]) {
          const it = items.find((i) => i.id === id);
          const target = it?.filedAs ? { name: it.filedAs.name, path: billingFolder(it.filedAs.date, it.filedAs.kind, it.filedAs.rectificativa) } : null;
          if (await saveOne(id, file, target)) uploaded++;
        }
        for (const it of items) {
          if (!it.drive || syncing.current.has(it.id) || it.drive.account !== acc) continue;
          const inInbox = it.drive.folder.endsWith('/Inbox');
          let target: { name: string; path: string[] } | null = null;
          if (it.status === 'completed' && it.filedAs && inInbox) target = { name: it.filedAs.name, path: billingFolder(it.filedAs.date, it.filedAs.kind, it.filedAs.rectificativa) };
          if (it.status === 'discarded' && inInbox) target = { name: it.filename, path: DISCARDED_FOLDER };
          if (!target) continue;
          syncing.current.add(it.id);
          try {
            const ref = await moveInDrive(it.drive, target.name, target.path);
            await callAction('inbox.attachDrive', { id: it.id, drive: ref });
            moved++;
          } finally {
            syncing.current.delete(it.id);
          }
        }
      } catch (e) {
        if (!(e instanceof DriveAuthNeeded)) toast.error(e instanceof Error ? e.message : 'Error con Google Drive');
      }
      if (interactive && (moved || uploaded)) toast(`Drive al día: ${uploaded ? `${uploaded} subidos` : ''}${uploaded && moved ? ' · ' : ''}${moved ? `${moved} ordenados` : ''}`);
      setSyncTick((t) => t + 1);
    },
    [enabled, saveOne],
  );

  // Whenever items change (a confirm, a discard) and we have a token, file things quietly.
  const pendingMoves = (ctx.items ?? []).filter((i) => i.drive && i.drive.account === account && i.drive.folder.endsWith('/Inbox') && i.status !== 'needs_confirmation').length;
  useEffect(() => {
    if (pendingMoves && account && hasToken(account)) void syncDrive(false);
  }, [pendingMoves, account, syncDrive]);

  return { batch, process, syncDrive, waitingCount, pendingMoves, syncTick, clearBatch: () => setBatch(EMPTY) };
}
