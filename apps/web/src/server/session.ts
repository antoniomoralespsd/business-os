import 'server-only';
import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { SESSION_COOKIE, WORKSPACE_ID } from '@/lib/config';
import { adminAuth, adminDb } from './firebaseAdmin';

const SESSION_DAYS = 14;

export interface SessionUser {
  uid: string;
  email: string;
  workspaceId: string;
}

export class AuthError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
  }
}

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Exchange a fresh Firebase ID token for an httpOnly session cookie. Bootstraps the workspace on first login. */
export async function createSession(idToken: string): Promise<SessionUser> {
  const decoded = await adminAuth().verifyIdToken(idToken, true);
  const email = (decoded.email ?? '').toLowerCase();
  if (!decoded.email_verified || !allowedEmails().has(email)) {
    throw new AuthError(403, 'Este email no tiene acceso a Business OS.');
  }
  // Only accept recently signed-in tokens (Firebase recommendation for session cookies).
  if (Date.now() / 1000 - decoded.auth_time > 5 * 60) throw new AuthError(401, 'Vuelve a iniciar sesión.');

  const db = adminDb();
  const ws = db.doc(`workspaces/${WORKSPACE_ID}`);
  const member = ws.collection('members').doc(decoded.uid);
  await db.runTransaction(async (tx) => {
    const [wsSnap, memberSnap] = await Promise.all([tx.get(ws), tx.get(member)]);
    if (!wsSnap.exists) {
      tx.set(ws, { name: 'Iris Design', ownerUid: decoded.uid, timezone: 'Europe/Madrid', currency: 'EUR', createdAt: FieldValue.serverTimestamp() });
    }
    if (!memberSnap.exists) {
      tx.set(member, { email, role: wsSnap.exists ? 'editor' : 'owner', createdAt: FieldValue.serverTimestamp() });
    }
    tx.set(db.doc(`users/${decoded.uid}`), { email, workspaceIds: [WORKSPACE_ID], lastLoginAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn: SESSION_DAYS * 86_400_000 });
  (await cookies()).set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
  return { uid: decoded.uid, email, workspaceId: WORKSPACE_ID };
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Verify the session cookie and workspace membership. Throws AuthError. */
export async function requireUser(): Promise<SessionUser> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) throw new AuthError(401, 'Sesión no iniciada.');
  let decoded;
  try {
    decoded = await adminAuth().verifySessionCookie(cookie, true);
  } catch {
    throw new AuthError(401, 'Sesión caducada.');
  }
  const member = await adminDb().doc(`workspaces/${WORKSPACE_ID}/members/${decoded.uid}`).get();
  if (!member.exists) throw new AuthError(403, 'Sin acceso a este espacio de trabajo.');
  return { uid: decoded.uid, email: decoded.email ?? '', workspaceId: WORKSPACE_ID };
}
