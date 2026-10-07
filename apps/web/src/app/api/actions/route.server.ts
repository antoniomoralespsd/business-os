import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ActionError, makeContext, runAction } from '@/actions/define';
import { ACTIONS } from '@/server/actions';
import { adminDbLike } from '@/server/adminDb';
import { AuthError, requireUser } from '@/server/session';

export const runtime = 'nodejs';

const Body = z.object({ action: z.string(), input: z.unknown() });

/** POST /api/actions { action, input } → { ok, data } | { ok: false, error } */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = Body.parse(await req.json());
    const ctx = makeContext(adminDbLike(), user.workspaceId, { type: 'user', id: user.uid });
    const data = await runAction(ACTIONS, ctx, body.action, body.input);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    if (err instanceof ActionError) return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    console.error('[actions]', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }, { status: 500 });
  }
}
