import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/server/session';
import { bucket } from '@/server/storage';

export const runtime = 'nodejs';

/** GET /api/files?path=… → streams a stored file to its owner (inline). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const path = new URL(req.url).searchParams.get('path') ?? '';
    if (!path.startsWith(`workspaces/${user.workspaceId}/`) || path.includes('..')) {
      return NextResponse.json({ ok: false, error: 'Ruta no válida' }, { status: 400 });
    }
    const f = bucket().file(path);
    const [meta] = await f.getMetadata();
    const [buf] = await f.download();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type': String(meta.contentType ?? 'application/octet-stream'),
        'content-disposition': `inline; filename="${path.split('/').pop()}"`,
        'cache-control': 'private, max-age=300',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: 'Archivo no encontrado' }, { status: 404 });
  }
}
