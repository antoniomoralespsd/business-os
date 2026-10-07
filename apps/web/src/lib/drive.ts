'use client';
import { getApps, initializeApp } from 'firebase/app';
import { browserPopupRedirectResolver, GoogleAuthProvider, initializeAuth, inMemoryPersistence, signInWithPopup, signOut, type Auth } from 'firebase/auth';
import { MONTHS, parseCsv } from '@bos/domain';
import type { DriveLayout, DriveRef } from '@bos/schemas';
import { firebaseClientConfig } from './config';

/**
 * Google Drive from the browser (ADR 0005, 0006). The access token comes from a Google popup on a
 * separate in-memory Firebase Auth instance (it never changes who is logged in), lasts ~1 h, lives
 * only in this tab and is never stored in the database. Full `drive` scope: the app works inside
 * your own folders (AGENCIA / 00 - AÑOS …), reads your invoice sheets and moves exported PDFs.
 * It never deletes anything: discarded files are moved, not trashed.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive';
const FALLBACK_ROOT = 'Business OS';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const TOKENS_KEY = 'bos.drive.tokens.v2';

type Tok = { token: string; exp: number };
const tokens = new Map<string, Tok>();
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

/** Opens the Google popup (must be called from a click/drop). Returns the connected email. */
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

export function tokenFor(account: string): string {
  loadTokens();
  const t = tokens.get(account);
  if (!t || t.exp < Date.now() + 30_000) throw new DriveAuthNeeded(account);
  return t.token;
}

async function raw(account: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${tokenFor(account)}` } });
  if (res.status === 401) {
    tokens.delete(account);
    saveTokens();
    throw new DriveAuthNeeded(account);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; errors?: { reason?: string }[] } } | null;
    const reason = body?.error?.errors?.[0]?.reason;
    const msg = body?.error?.message ?? '';
    if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(msg)) {
      const api = /sheets/i.test(msg) ? 'Google Sheets' : 'Google Drive';
      throw new Error(`La API de ${api} no está activada en el proyecto. Actívala en Google Cloud (Ajustes → Cuentas de Google).`);
    }
    if (reason === 'storageQuotaExceeded') throw new Error(`El Drive de ${account} está lleno.`);
    if (reason === 'insufficientPermissions' || res.status === 403) throw new DriveAuthNeeded(account);
    throw new Error(msg || `Google respondió ${res.status}`);
  }
  return res;
}

export async function api<T>(account: string, url: string, init: RequestInit = {}): Promise<T> {
  return (await (await raw(account, url, init)).json()) as T;
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export type DriveItem = { id: string; name: string; mimeType: string; parents?: string[]; modifiedTime?: string; webViewLink?: string; md5Checksum?: string; size?: string };
const ITEM_FIELDS = 'id,name,mimeType,parents,modifiedTime,webViewLink,md5Checksum,size';

/** Every child (all pages) of a folder. */
export async function listChildren(account: string, folderId: string, onlyFolders = false): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false${onlyFolders ? ` and mimeType='${FOLDER_MIME}'` : ''}`,
      fields: `nextPageToken,files(${ITEM_FIELDS})`,
      pageSize: '1000',
      orderBy: 'name',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const r = await api<{ files: DriveItem[]; nextPageToken?: string }>(account, `${DRIVE}?${params}`);
    out.push(...r.files);
    pageToken = r.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Files under a folder, walking subfolders. `path` is relative to the start folder ("03 MARZO/INGRESOS/x.pdf"). */
export async function walk(account: string, folderId: string, prefix = ''): Promise<(DriveItem & { path: string })[]> {
  const kids = await listChildren(account, folderId);
  const out: (DriveItem & { path: string })[] = [];
  for (const k of kids) {
    const path = prefix ? `${prefix}/${k.name}` : k.name;
    if (k.mimeType === FOLDER_MIME) out.push(...(await walk(account, k.id, path)));
    else out.push({ ...k, path });
  }
  return out;
}

export async function getItem(account: string, id: string): Promise<DriveItem> {
  return api<DriveItem>(account, `${DRIVE}/${id}?fields=${ITEM_FIELDS}`);
}

export async function download(account: string, id: string): Promise<Blob> {
  return (await raw(account, `${DRIVE}/${id}?alt=media`)).blob();
}

/** Plain values of the first sheet of a spreadsheet, as rows of cells. */
export async function sheetRows(account: string, id: string): Promise<string[][]> {
  const csv = await (await raw(account, `${DRIVE}/${id}/export?mimeType=text/csv`)).text();
  return parseCsv(csv);
}

/* ---------- folders ---------- */

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
const folderCache = new Map<string, Promise<string>>();

/** Finds a child folder by a test on its name, or creates it with `name`. Parallel calls share the work. */
export function ensureChild(account: string, parentId: string, name: string, test: (normName: string) => boolean = (n) => n === norm(name)): Promise<string> {
  const key = `${account}|${parentId}|${norm(name)}`;
  let p = folderCache.get(key);
  if (!p) {
    p = (async () => {
      const kids = await listChildren(account, parentId, true);
      const hit = kids.find((k) => test(norm(k.name)));
      if (hit) return hit.id;
      const created = await api<{ id: string }>(account, `${DRIVE}?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      });
      return created.id;
    })();
    p.catch(() => folderCache.delete(key));
    folderCache.set(key, p);
  }
  return p;
}

async function fallbackRoot(account: string): Promise<string> {
  return ensureChild(account, 'root', FALLBACK_ROOT);
}

const pad = (n: number) => String(n).padStart(2, '0');
export const monthFolderName = (m: number) => `${pad(m)} ${(MONTHS[m - 1] ?? '').toUpperCase()}`;

/** Where a confirmed document lives: 00 - AÑOS/2026/03 MARZO/INGRESOS (or GASTOS), 00 - AÑOS/2026/Rectificativas. */
export async function billingFolderId(account: string, layout: DriveLayout | null, date: string, kind: 'income' | 'expense' | 'other', rectificativa: boolean): Promise<{ id: string; label: string }> {
  const [y, m] = date.split('-');
  const month = Number(m);
  const years = layout?.yearsId ?? (await ensureChild(account, await fallbackRoot(account), 'Facturación'));
  const yearsLabel = layout ? `${layout.rootName}/00 - AÑOS` : `${FALLBACK_ROOT}/Facturación`;
  const yearId = await ensureChild(account, years, y!, (n) => n === y);
  if (rectificativa && kind !== 'other') {
    const id = await ensureChild(account, yearId, 'Rectificativas', (n) => n.includes('rectificativ'));
    return { id, label: `${yearsLabel}/${y}/Rectificativas` };
  }
  const monthName = monthFolderName(month);
  const word = norm(MONTHS[month - 1] ?? '');
  const monthId = await ensureChild(account, yearId, monthName, (n) => n.split(' ').includes(word) || n.startsWith(`${pad(month)} `) || n === pad(month));
  if (kind === 'other') return { id: monthId, label: `${yearsLabel}/${y}/${monthName}` };
  const sub = kind === 'income' ? 'INGRESOS' : 'GASTOS';
  const id = await ensureChild(account, monthId, sub, (n) => n.includes(kind === 'income' ? 'ingreso' : 'gasto'));
  return { id, label: `${yearsLabel}/${y}/${monthName}/${sub}` };
}

/** Staging folder for uploads not yet confirmed, and the place for discarded files. */
export async function inboxFolderId(account: string, layout: DriveLayout | null, discarded = false): Promise<{ id: string; label: string }> {
  const root = layout?.rootId ?? (await fallbackRoot(account));
  const rootLabel = layout?.rootName ?? FALLBACK_ROOT;
  const inbox = await ensureChild(account, root, '05 - PENDIENTE DE CLASIFICAR', (n) => n.includes('pendiente de clasificar'));
  if (!discarded) return { id: inbox, label: `${rootLabel}/05 - PENDIENTE DE CLASIFICAR` };
  const d = await ensureChild(account, inbox, 'Descartados', (n) => n.includes('descartad'));
  return { id: d, label: `${rootLabel}/05 - PENDIENTE DE CLASIFICAR/Descartados` };
}

/** Reads AGENCIA's subfolders by their prefix: 00 años, 01 facturas, 02 albaranes, 03 rectificativas. */
export async function detectLayout(account: string, root: { id: string; name: string }): Promise<DriveLayout> {
  const kids = await listChildren(account, root.id, true);
  const find = (test: (n: string) => boolean) => kids.find((k) => test(norm(k.name)))?.id ?? null;
  return {
    rootId: root.id,
    rootName: root.name,
    yearsId: find((n) => n.startsWith('00') || n.includes('anos')),
    editablesId: find((n) => n.startsWith('01') || (n.includes('factura') && !n.includes('rectific'))),
    albaranesId: find((n) => n.startsWith('02') || n.includes('albaran')),
    rectificativasId: find((n) => n.startsWith('03') || n.includes('rectificativ')),
  };
}

/* ---------- files ---------- */

const FIELDS = 'id,name,webViewLink,parents';
type DriveFile = { id: string; name: string; webViewLink: string; parents?: string[] };

export async function uploadTo(account: string, file: Blob, name: string, folder: { id: string; label: string }): Promise<DriveRef> {
  const meta = { name, parents: [folder.id] };
  const type = file.type || 'application/octet-stream';
  let out: DriveFile;
  if (file.size <= 5 * 1024 * 1024) {
    const boundary = `bos${Math.random().toString(36).slice(2)}`;
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`, file, `\r\n--${boundary}--`]);
    out = await api<DriveFile>(account, `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  } else {
    const start = await raw(account, `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
      body: JSON.stringify(meta),
    });
    const loc = start.headers.get('Location');
    if (!loc) throw new Error('No se pudo iniciar la subida a Drive');
    const put = await fetch(loc, { method: 'PUT', body: file });
    if (!put.ok) throw new Error('No se pudo subir a Drive');
    out = (await put.json()) as DriveFile;
  }
  return { account, fileId: out.id, name: out.name, folder: folder.label, folderId: folder.id, webViewLink: out.webViewLink, filed: false, keepName: false };
}

/** Moves (and optionally renames) a file into a folder. Already there → only renames if needed. */
export async function moveTo(ref: DriveRef, folder: { id: string; label: string }, name?: string): Promise<DriveRef> {
  const cur = await api<{ parents?: string[]; name: string }>(ref.account, `${DRIVE}/${ref.fileId}?fields=parents,name`);
  const parents = cur.parents ?? [];
  const params = new URLSearchParams({ fields: FIELDS });
  if (!parents.includes(folder.id)) {
    params.set('addParents', folder.id);
    if (parents.length) params.set('removeParents', parents.join(','));
  }
  const rename = name && name !== cur.name;
  const out =
    !params.has('addParents') && !rename
      ? await api<DriveFile>(ref.account, `${DRIVE}/${ref.fileId}?fields=${FIELDS}`)
      : await api<DriveFile>(ref.account, `${DRIVE}/${ref.fileId}?${params}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rename ? { name } : {}),
        });
  return { ...ref, fileId: out.id, name: out.name, folder: folder.label, folderId: folder.id, webViewLink: out.webViewLink };
}

export async function renameFile(account: string, fileId: string, name: string): Promise<void> {
  await api(account, `${DRIVE}/${fileId}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}

/** Copies a file (e.g. last month's invoice sheet) into a folder with a new name. */
export async function copyFile(account: string, fileId: string, name: string, parentId: string): Promise<DriveItem> {
  return api<DriveItem>(account, `${DRIVE}/${fileId}/copy?fields=${ITEM_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [parentId] }),
  });
}

/* ---------- Google Sheets ---------- */

/** The sheet's tabs (to export the "Factura" tab only). */
export async function sheetTabs(account: string, id: string): Promise<{ gid: number; title: string }[]> {
  const r = await api<{ sheets: { properties: { sheetId: number; title: string } }[] }>(account, `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(sheetId,title)`);
  return r.sheets.map((s) => ({ gid: s.properties.sheetId, title: s.properties.title }));
}

/** Writes single cells, e.g. { 'Factura!F12': '529', 'Factura!F16': '01/08/2026' }. Values are typed like in Sheets. */
export async function writeCells(account: string, id: string, cells: Record<string, string>): Promise<void> {
  await api(account, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: Object.entries(cells).map(([range, v]) => ({ range, values: [[v]] })) }),
  });
}

/**
 * PDF of one tab, A4, fit to width, no gridlines — like "Descargar → PDF" in Sheets.
 * Google's export URL has no CORS, so our server fetches it with this tab's token and streams it back
 * (the token is used for that single request and never stored or logged).
 */
export async function sheetPdf(account: string, id: string, gid: number): Promise<Blob> {
  const res = await fetch('/api/drive/sheet-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Google-Token': tokenFor(account) }, body: JSON.stringify({ id, gid }) });
  if (res.status === 401) {
    tokens.delete(account);
    saveTokens();
    throw new DriveAuthNeeded(account);
  }
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'No se pudo exportar el PDF');
  return res.blob();
}

/** "0528 Otto JUNIO Antonio Morales (01/07/26)" → the name Sheets gives the PDF download. */
export const pdfNameForSheet = (title: string, tab = 'Factura') => `${title.replace(/\//g, '_')} - ${tab}.pdf`;

export const driveUrl = (account: string, folderId?: string | null) =>
  folderId ? `https://drive.google.com/drive/folders/${folderId}?authuser=${encodeURIComponent(account)}` : `https://drive.google.com/drive/my-drive?authuser=${encodeURIComponent(account)}`;
