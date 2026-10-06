export type DataMode = 'firestore' | 'memory';

export const DATA_MODE: DataMode = process.env.NEXT_PUBLIC_DATA_MODE === 'memory' ? 'memory' : 'firestore';
export const WORKSPACE_ID = process.env.NEXT_PUBLIC_WORKSPACE_ID || 'main';
/** True only in the static demo build (no server, relative links). */
export const STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';
export const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

export const firebaseClientConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
};

export const SESSION_COOKIE = 'bos_session';
