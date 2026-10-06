import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, createSession, destroySession } from '@/server/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { idToken } = z.object({ idToken: z.string().min(10) }).parse(await req.json());
    const user = await createSession(idToken);
    return NextResponse.json({ ok: true, email: user.email });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 400;
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status });
  }
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
