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
