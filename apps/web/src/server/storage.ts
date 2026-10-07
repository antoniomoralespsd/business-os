import 'server-only';
import { getStorage } from 'firebase-admin/storage';
import { adminDb } from './firebaseAdmin';

/** Firebase Storage bucket (created when Storage is activated in the console). */
export function bucket() {
  adminDb(); // ensures the app is initialised
  const name = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebasestorage.app`;
  return getStorage().bucket(name);
}

export function safeName(name: string) {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
}
