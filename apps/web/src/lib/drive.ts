'use client';
import { getApps, initializeApp } from 'firebase/app';
import { browserPopupRedirectResolver, GoogleAuthProvider, initializeAuth, inMemoryPersistence, signInWithPopup, signOut, type Auth } from 'firebase/auth';
import { MONTHS } from '@bos/domain';
import type { DriveRef } from '@bos/schemas';
import { firebaseClientConfig } from './config';

/**
 * Google Drive from the browser, with the narrow `drive.file` permission: the app only sees the
 * files and folders it creates. The access token comes from a Google sign-in popup on a separate
 * Firebase Auth instance (it never touches your app session), lives ~1 h in this tab and is never
 * sent to our server or stored in the database.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT = 'Business OS';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TOKENS_KEY = 'bos.drive.tokens';

type Tok = { token: string; exp: number };
const tokens = new Map<string, Tok>();
const folderCache = new Map<string, string>();
const listeners = new Set<() => void>();

export class DriveAuthNeeded extends Error {
  constructor(public account: string) {
    super(`Hay que volver a conectar ${account} con Google Drive.`);
  }
}

function loadTokens() {
  if (tokens.size || typeof window === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(TOKENS_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Tok>)) if (v.exp > Date.now()) tokens.set(k, v);
  } catch {
    /* ignore */
  }
}
function saveTokens() {
  try {
    sessionStorage.setItem(TOKENS_KEY, JSON.stringify(Object.fromEntries(tokens)));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function onDriveTokens(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

let driveAuthInstance: Auth | null = null;
/** Separate Firebase Auth (in memory) so connecting a Drive account never changes who is logged in. */
function driveAuth(): Auth {
  if (!driveAuthInstance) {
    const app = getApps().find((a) => a.name === 'drive') ?? initializeApp(firebaseClientConfig, 'drive');
    driveAuthInstance = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  }
  return driveAuthInstance;
}

/** Call early (on mount) so the popup can open straight from a click. */
export function warmUpDrive(): void {
  loadTokens();
  if (typeof window !== 'undefined') driveAuth();
}

export function hasToken(account: string | null | undefined): boolean {
  loadTokens();
  if (!account) return false;
  const t = tokens.get(account);
  return !!t && t.exp > Date.now() + 60_000;
}

/**
 * Opens the Google popup (must be called from a click/drop). Returns the connected email.
 * With `account`, Google suggests that account; the user can still pick another one.
 */
export async function connectDrive(account?: string): Promise<string> {
  const provider = new GoogleAuthProvider();
  provider.addScope(SCOPE);
  provider.setCustomParameters(account ? { login_hint: account } : { prompt: 'select_account' });
  const auth = driveAuth();
  const result = await signInWithPopup(auth, provider);
  const cred = GoogleAuthProvider.credentialFromResult(result);
  const email = result.user.email;
  void signOut(auth);
  if (!cred?.accessToken || !email) throw new Error('Google no ha devuelto permiso para Drive.');
  tokens.set(email, { token: cred.accessToken, exp: Date.now() + 55 * 60_000 });
  saveTokens();
  return email;
}

export function forgetDrive(account: string): void {
  tokens.delete(account);
  saveTokens();
}

function tokenFor(account: string): string {
  loadTokens();
  const t = tokens.get(account);
  if (!t || t.exp < Date.now() + 30_000) throw new DriveAuthNeeded(account);
  return t.token;
}

async function api<T>(account: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${tokenFor(account)}` } });
  if (res.status === 401) {
    tokens.delete(account);
    saveTokens();
    throw new DriveAuthNeeded(account);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; errors?: { reason?: string }[] } } | null;
    const reason = body?.error?.errors?.[0]?.reason;
    if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(body?.error?.message ?? ''))
      throw new Error('La API de Google Drive no está activada en el proyecto. Actívala en Google Cloud (ver Ajustes → Cuentas de Google).');
    if (reason === 'storageQuotaExceeded') throw new Error(`El Drive de ${account} está lleno.`);
    throw new Error(body?.error?.message ?? `Google Drive respondió ${res.status}`);
  }
  return (await res.json()) as T;
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const inflight = new Map<string, Promise<string>>();

/** Finds or creates "Business OS/<...path>" and returns the last folder id. Parallel calls share the work. */
export function ensureFolder(account: string, path: string[]): Promise<string> {
  const key = `${account}|${path.join('/')}`;
  let p = inflight.get(key);
  if (!p) {
    p = findOrCreate(account, path).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

async function findOrCreate(account: string, path: string[]): Promise<string> {
  // Parents first, one at a time, so two uploads never create the same folder twice.
  if (path.length > 0) await ensureFolder(account, path.slice(0, -1));
  let parent = 'root';
  const full = [ROOT, ...path];
  for (let i = 0; i < full.length; i++) {
    const key = `${account}|${full.slice(0, i + 1).join('/')}`;
    const cached = folderCache.get(key);
    if (cached) {
      parent = cached;
      continue;
    }
    const name = full[i]!;
    const found = await api<{ files: { id: string }[] }>(
      account,
      `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q: `name='${q(name)}' and mimeType='${FOLDER_MIME}' and '${parent}' in parents and trashed=false`, fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`,
    );
    let id = found.files[0]?.id;
    if (!id) {
      const created = await api<{ id: string }>(account, 'https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
      });
      id = created.id;
    }
    folderCache.set(key, id);
    parent = id;
  }
  return parent;
}

type DriveFile = { id: string; name: string; webViewLink: string };
const FIELDS = 'id,name,webViewLink';

export async function uploadToDrive(account: string, file: Blob, name: string, path: string[]): Promise<DriveRef> {
  const parent = await ensureFolder(account, path);
  const meta = { name, parents: [parent] };
  const type = file.type || 'application/octet-stream';
  let out: DriveFile;
  if (file.size <= 5 * 1024 * 1024) {
    const boundary = `bos${Math.random().toString(36).slice(2)}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`,
    ]);
    out = await api<DriveFile>(account, `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  } else {
    const start = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${FIELDS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenFor(account)}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
      body: JSON.stringify(meta),
    });
    const loc = start.headers.get('Location');
    if (!start.ok || !loc) throw new Error('No se pudo iniciar la subida a Drive');
    const put = await fetch(loc, { method: 'PUT', body: file });
    if (!put.ok) throw new Error('No se pudo subir a Drive');
    out = (await put.json()) as DriveFile;
  }
  return { account, fileId: out.id, name: out.name, folder: [ROOT, ...path].join('/'), webViewLink: out.webViewLink };
}

/** Moves and renames a file the app created. */
export async function moveInDrive(ref: DriveRef, name: string, path: string[]): Promise<DriveRef> {
  const parent = await ensureFolder(ref.account, path);
  const cur = await api<{ parents?: string[] }>(ref.account, `https://www.googleapis.com/drive/v3/files/${ref.fileId}?fields=parents`);
  const params = new URLSearchParams({ addParents: parent, removeParents: (cur.parents ?? []).filter((p) => p !== parent).join(','), fields: FIELDS });
  const out = await api<DriveFile>(ref.account, `https://www.googleapis.com/drive/v3/files/${ref.fileId}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return { account: ref.account, fileId: out.id, name: out.name, folder: [ROOT, ...path].join('/'), webViewLink: out.webViewLink };
}

/* ---------- where things go ---------- */

const pad = (n: number) => String(n).padStart(2, '0');

/** Facturación/2026/03 MARZO/Ingresos — the same layout as your folders on the PC. */
export function billingFolder(date: string, kind: 'income' | 'expense' | 'other', rectificativa: boolean): string[] {
  const [y, m] = date.split('-');
  const month = Number(m);
  const monthName = `${pad(month)} ${(MONTHS[month - 1] ?? '').toUpperCase()}`;
  if (kind === 'other') return ['Documentos', y!];
  if (rectificativa) return ['Facturación', y!, 'Rectificativas'];
  return ['Facturación', y!, monthName, kind === 'income' ? 'Ingresos' : 'Gastos'];
}

export const INBOX_FOLDER = ['Inbox'];
export const DISCARDED_FOLDER = ['Descartados'];
