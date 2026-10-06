'use client';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { clientAuth } from '@/lib/firebaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(clientAuth(), provider);
      const idToken = await cred.user.getIdToken(true);
      const res = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        await signOut(clientAuth());
        throw new Error(json.error ?? 'No se pudo iniciar sesión');
      }
      router.replace('/tasks');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al iniciar sesión');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative z-[1] grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-[380px]">
        <div className="flex gap-4">
          <span className="iris-bar w-[5px] rounded-[2px]" aria-hidden />
          <div>
            <p className="eyebrow text-ink-3">Iris Design · Business app</p>
            <h1 className="font-display mt-2 text-[64px] leading-[0.9]">
              Business
              <br />
              OS
            </h1>
          </div>
        </div>
        <p className="mt-6 text-[14px] leading-relaxed text-ink-2">Organiza, conecta y gestiona tu estudio desde un solo sitio.</p>
        <button type="button" onClick={login} disabled={busy} className="btn-primary mt-8 w-full py-3 text-[13px] font-semibold tracking-[0.06em] disabled:opacity-60">
          {busy ? 'ENTRANDO…' : 'ENTRAR CON GOOGLE'}
        </button>
        {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}
      </div>
    </main>
  );
}
