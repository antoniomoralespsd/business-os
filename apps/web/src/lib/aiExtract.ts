'use client';
import type { AiExtraction } from '@bos/schemas';
import { DATA_MODE } from './config';
import { extOf } from './fileTools';

/**
 * Why the AI isn't available right now, or null. Never permanent: after a minute it's tried again
 * (e.g. once the permission in Google Cloud is in place), so an old error can't silently disable it.
 */
let unavailable: string | null = null;
let unavailableUntil = 0;
/** Last reason a single reading failed (shown in the batch summary). */
let lastError: string | null = null;
export const aiLastError = () => lastError;
const listeners = new Set<() => void>();
export const aiUnavailable = () => (unavailable && Date.now() < unavailableUntil ? unavailable : null);
export function onAiStatus(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function setUnavailable(why: string) {
  unavailable = why;
  unavailableUntil = Date.now() + 60_000;
  listeners.forEach((l) => l());
}
export function resetAiStatus() {
  unavailable = null;
  unavailableUntil = 0;
  lastError = null;
  listeners.forEach((l) => l());
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Phone photos are huge: send a 2000 px JPEG instead (plenty to read a ticket). */
async function shrinkImage(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo preparar la imagen'))), 'image/jpeg', 0.85));
}

/**
 * Reads a document with AI (Gemini on the project's Vertex AI). Returns null when unavailable;
 * the rule-based reading is used then.
 */
export async function aiExtract(file: File, ctx: { path: string; owner: { name: string; taxId: string }; clients: string[] }): Promise<AiExtraction | null> {
  if (DATA_MODE !== 'firestore' || aiUnavailable()) return null;
  try {
    const isPdf = file.type === 'application/pdf' || extOf(file.name) === 'pdf';
    const isImg = /^image\/(jpeg|png|webp|heic|heif)/.test(file.type) || /\.(jpe?g|png|webp|heic)$/i.test(file.name);
    if (!isPdf && !isImg) return null;
    if (isPdf && file.size > 10 * 1024 * 1024) return null;
    const blob = isPdf ? file : await shrinkImage(file);
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: isPdf ? 'application/pdf' : 'image/jpeg', data: await toBase64(blob), filename: file.name, path: ctx.path, owner: ctx.owner, clients: ctx.clients.slice(0, 200) }),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; data?: AiExtraction; error?: string; code?: string } | null;
    if (res.status === 501) {
      setUnavailable(json?.error ?? 'La lectura con IA no está activada');
      lastError = json?.error ?? 'IA no activada';
      return null;
    }
    if (!json?.ok || !json.data) {
      lastError = json?.error ?? `Error ${res.status}`;
      return null;
    }
    if (unavailable) resetAiStatus();
    return json.data;
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'Sin conexión';
    return null;
  }
}
