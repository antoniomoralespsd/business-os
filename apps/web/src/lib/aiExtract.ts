'use client';
import type { AiExtraction } from '@bos/schemas';
import { DATA_MODE } from './config';
import { extOf } from './fileTools';

/** Why the AI isn't available (shown once in the Inbox), or null when it works / hasn't been tried. */
let unavailable: string | null = null;
const listeners = new Set<() => void>();
export const aiUnavailable = () => unavailable;
export function onAiStatus(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function setUnavailable(why: string) {
  unavailable = why;
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
  if (DATA_MODE !== 'firestore' || unavailable) return null;
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
      return null;
    }
    return json?.ok && json.data ? json.data : null;
  } catch {
    return null;
  }
}
