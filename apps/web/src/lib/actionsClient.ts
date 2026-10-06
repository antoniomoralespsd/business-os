'use client';

export class ActionFailed extends Error {}

/** Calls a registered server action. Throws ActionFailed with a Spanish message on failure. */
export async function callAction<T = unknown>(action: string, input: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, input }),
      credentials: 'same-origin',
    });
  } catch {
    throw new ActionFailed('Sin conexión. Inténtalo de nuevo.');
  }
  const json = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: string } | null;
  if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/login';
  if (!res.ok || !json?.ok) throw new ActionFailed(json?.error ?? `Error ${res.status}`);
  return json.data as T;
}
