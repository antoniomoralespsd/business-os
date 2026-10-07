import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/server/session';
import { bucket, safeName } from '@/server/storage';

export const runtime = 'nodejs';
const MAX = 30 * 1024 * 1024;

/**
 * POST multipart { file, sha256 } → stores the file in Firebase Storage under the workspace.
 * Returns { ok, storagePath } or { ok: true, storagePath: null, warning } when Storage is not available,
 * so the document can still be classified and registered.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    const sha = String(form.get('sha256') ?? '');
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Falta el archivo' }, { status: 400 });
    if (file.size > MAX) return NextResponse.json({ ok: false, error: 'El archivo supera 30 MB' }, { status: 413 });
    const path = `workspaces/${user.workspaceId}/inbox/${new Date().toISOString().slice(0, 7)}/${sha.slice(0, 12)}_${safeName(file.name)}`;
    try {
      await bucket()
        .file(path)
        .save(Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', resumable: false, metadata: { metadata: { sha256: sha, uploadedBy: user.uid } } });
      return NextResponse.json({ ok: true, storagePath: path });
    } catch (e) {
      console.error('[upload] storage unavailable', e);
      return NextResponse.json({ ok: true, storagePath: null, warning: 'No se pudo guardar el archivo: activa Storage en la consola de Firebase. El documento se registra igualmente.' });
    }
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
