import type { Cipher, VaultMeta } from '@bos/schemas';

/**
 * Zero-knowledge vault crypto (Web Crypto): PBKDF2-SHA256 → AES-256-GCM.
 * The master password and the derived key live only in this browser tab's memory.
 */
const ITERATIONS = 310_000;
const VERIFIER = 'business-os-vault-v1';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKey(password: string, saltB64: string, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(key: CryptoKey, text: string): Promise<Cipher> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { iv: b64(iv), data: b64(data) };
}

export async function decryptText(key: CryptoKey, c: Cipher): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(c.iv) }, key, unb64(c.data));
  return dec.decode(plain);
}

/** New vault: random salt + encrypted verifier. */
export async function createVault(password: string): Promise<{ meta: VaultMeta; key: CryptoKey }> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(password, salt, ITERATIONS);
  return { meta: { salt, iterations: ITERATIONS, verifier: await encryptText(key, VERIFIER) }, key };
}

/** Returns the key if the password is right, null otherwise. */
export async function unlockVault(meta: VaultMeta, password: string): Promise<CryptoKey | null> {
  const key = await deriveKey(password, meta.salt, meta.iterations);
  try {
    return (await decryptText(key, meta.verifier)) === VERIFIER ? key : null;
  } catch {
    return null;
  }
}

/* ---------- in-memory session (auto-locks) ---------- */

let sessionKey: CryptoKey | null = null;
let lockTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const AUTO_LOCK_MS = 15 * 60 * 1000;

export function setVaultKey(key: CryptoKey | null) {
  sessionKey = key;
  if (lockTimer) clearTimeout(lockTimer);
  if (key) lockTimer = setTimeout(() => setVaultKey(null), AUTO_LOCK_MS);
  listeners.forEach((l) => l());
}
export const getVaultKey = () => sessionKey;
export function subscribeVaultKey(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Password generator: 18 chars, no ambiguous characters. */
export function generatePassword(length = 18): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*?';
  const r = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(r, (n) => chars[n % chars.length]).join('');
}
