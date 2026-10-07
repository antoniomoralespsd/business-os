import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, requireUser } from '@/server/session';

export const runtime = 'nodejs';

const Body = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/), gid: z.number().int().min(0) });

/**
 * POST /api/drive/sheet-pdf → PDF of one Google Sheets tab (A4, fit to width, no gridlines).
 * Google's export URL doesn't allow browser (CORS) requests, so we fetch it here with the user's
 * Google token from the X-Google-Token header. The token is used for this one request only:
 * never stored, never logged (ADR 0006).
 */
export async function POST(req: Request) {
  try {
    await requireUser();
    const token = req.headers.get('x-google-token') ?? '';
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!token || !parsed.success) return NextResponse.json({ ok: false, error: 'Petición no válida' }, { status: 400 });
    const { id, gid } = parsed.data;
    const params = new URLSearchParams({
      format: 'pdf',
      gid: String(gid),
      size: 'A4',
      portrait: 'true',
      fitw: 'true',
      gridlines: 'false',
      printtitle: 'false',
      sheetnames: 'false',
      pagenum: 'UNDEFINED',
      fzr: 'false',
      top_margin: '0.4',
      bottom_margin: '0.4',
      left_margin: '0.4',
      right_margin: '0.4',
    });
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?${params}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' });
    if (res.status === 401 || res.status === 403) return NextResponse.json({ ok: false, error: 'Google no ha dado permiso: vuelve a conectar Drive' }, { status: 401 });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('pdf')) return NextResponse.json({ ok: false, error: `Google no pudo exportar la hoja (${res.status})` }, { status: 502 });
    return new NextResponse(new Uint8Array(await res.arrayBuffer()), { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: 'No se pudo exportar el PDF' }, { status: 500 });
  }
}
