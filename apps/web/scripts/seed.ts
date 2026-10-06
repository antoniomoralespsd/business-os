/**
 * Seeds the clients collection. Idempotent (uses fixed ids).
 *   Emulators: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bos pnpm seed
 *   Real project: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json NEXT_PUBLIC_FIREBASE_PROJECT_ID=<id> pnpm seed
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { DEMO_CLIENTS } from '../src/features/tasks/gateway/memory';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const ws = process.env.NEXT_PUBLIC_WORKSPACE_ID || 'main';
initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { credential: applicationDefault(), projectId });
const db = getFirestore();

const batch = db.batch();
for (const c of DEMO_CLIENTS) {
  batch.set(
    db.doc(`workspaces/${ws}/clients/${c.id}`),
    { ...c, workspaceId: ws, status: 'active', createdBy: 'seed', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
await batch.commit();
console.log(`Seeded ${DEMO_CLIENTS.length} clients into workspaces/${ws}/clients`);
