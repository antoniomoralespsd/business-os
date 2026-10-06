import 'server-only';
import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * In Firebase App Hosting the runtime service account is picked up automatically.
 * Locally: set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON, or
 * FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST to use the emulators.
 */
function app(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const usingEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  return initializeApp(usingEmulators ? { projectId } : { credential: applicationDefault(), projectId });
}

export const adminDb = () => {
  const db = getFirestore(app());
  return db;
};
export const adminAuth = () => getAuth(app());
