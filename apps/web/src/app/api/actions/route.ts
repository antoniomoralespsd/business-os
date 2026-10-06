import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACTIONS } from '@/server/actions';
import { makeContext } from '@/server/actions/registry';
import { adminDb } from '@/server/firebaseAdmin';
import { AuthError, requireUser } from '@/server/session';

export const runtime = 'nodejs';

const Body = z.object({ action: z.string(), input: z.unknown() });

/** POST /api/actions { action, input } → { ok, data } | { ok: false, error } */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = Body.parse(await req.json());
    const def = ACTIONS.get(body.action);
    if (!def) return NextResponse.json({ ok: false, error: `Acción desconocida: ${body.action}` }, { status: 404 });

    const parsed = def.input.safeParse(body.input);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'Datos no válidos', issues: parsed.error.issues }, { status: 400 });
    }
    const ctx = makeContext(adminDb(), user.workspaceId, { type: 'user', id: user.uid });
    const data = await def.handler(ctx, parsed.data as never);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Error inesperado';
    console.error('[actions]', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
