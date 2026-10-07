'use client';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseClientConfig, USE_EMULATORS } from './config';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

export function firebaseApp(): FirebaseApp {
  if (!app) app = getApps()[0] ?? initializeApp(firebaseClientConfig);
  return app;
}

export function clientAuth(): Auth {
  if (!auth) {
    auth = getAuth(firebaseApp());
    if (USE_EMULATORS) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  return auth;
}

export function clientDb(): Firestore {
  if (!db) {
    db = getFirestore(firebaseApp());
    if (USE_EMULATORS) connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return db;
}

/**
 * Runs `start` once Firebase Auth has restored the signed-in user in this browser, and stops it on sign-out.
 * Without this, a listener created on page load can reach Firestore before the token is ready
 * and fail with "Missing or insufficient permissions".
 */
export function whileSignedIn(start: () => () => void, onSignedOut: () => void): () => void {
  let stop: (() => void) | null = null;
  const unsubAuth = clientAuth().onAuthStateChanged((user) => {
    stop?.();
    stop = null;
    if (user) stop = start();
    else onSignedOut();
  });
  return () => {
    unsubAuth();
    stop?.();
  };
}

/** Browser lost its Firebase session (cleared storage, other device): drop the server cookie and go to login. */
export function goToLogin(): void {
  if (typeof window === 'undefined' || window.location.pathname.startsWith('/login')) return;
  void fetch('/api/session', { method: 'DELETE' }).finally(() => window.location.assign('/login'));
}
