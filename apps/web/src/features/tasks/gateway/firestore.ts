'use client';
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { ActivityLog, Client, ISODate, Task } from '@bos/schemas';
import { callAction } from '@/lib/actionsClient';
import { WORKSPACE_ID } from '@/lib/config';
import { activityFromDoc, clientFromDoc, taskFromDoc } from '@/lib/convert';
import { clientDb, goToLogin, whileSignedIn } from '@/lib/firebaseClient';
import type { TasksGateway } from './types';

const ws = (name: string) => collection(clientDb(), 'workspaces', WORKSPACE_ID, name);

/** Firestore errors in plain Spanish. */
function friendly(e: Error): Error {
  const code = (e as { code?: string }).code;
  if (code === 'permission-denied') {
    return new Error('Sin permiso para leer los datos. Revisa que las reglas de Firestore estén publicadas, o cierra sesión y vuelve a entrar.');
  }
  if (code === 'unavailable') return new Error('Sin conexión con la base de datos. Se reintentará automáticamente.');
  return e;
}

/** Single-field queries only (no composite index needed); archived tasks are filtered here. */
function subscribeTasksNow({ from, to }: { from: ISODate; to: ISODate }, onData: (t: Task[]) => void, onError: (e: Error) => void) {
  // Two live queries (dated range + undated); emit only once both have answered.
  let dated: Task[] | null = null;
  let undated: Task[] | null = null;
  const emit = () => {
    if (dated && undated) onData([...dated, ...undated]);
  };
  const toTasks = (docs: { id: string; data: () => Record<string, unknown> }[]) =>
    docs.map((d) => taskFromDoc(d.id, d.data())).filter((t): t is Task => t !== null && !t.archived);

  const unsubA = onSnapshot(
    query(ws('tasks'), where('dueDate', '>=', from), where('dueDate', '<=', to)),
    (snap) => {
      dated = toTasks(snap.docs);
      emit();
    },
    onError,
  );
  const unsubB = onSnapshot(
    query(ws('tasks'), where('dueDate', '==', null)),
    (snap) => {
      undated = toTasks(snap.docs);
      emit();
    },
    onError,
  );
  return () => {
    unsubA();
    unsubB();
  };
}

export const firestoreTasksGateway: TasksGateway = {
  subscribeTasks(range, onData, onError) {
    return whileSignedIn(() => subscribeTasksNow(range, onData, (e) => onError(friendly(e))), goToLogin);
  },

  subscribeClients(onData, onError) {
    return whileSignedIn(
      () =>
        onSnapshot(
          query(ws('clients'), orderBy('name')),
          (snap) => onData(snap.docs.map((d) => clientFromDoc(d.id, d.data())).filter((c): c is Client => c !== null)),
          (e) => onError(friendly(e)),
        ),
      goToLogin,
    );
  },

  async createTask(input) {
    return callAction<{ id: string }>('task.create', input);
  },
  async updateTask(input) {
    await callAction('task.update', input);
  },
  async moveTask(input) {
    await callAction('task.move', input);
  },
  async setStatus(input) {
    await callAction('task.status', input);
  },
  async archiveTask(id) {
    await callAction('task.archive', { id });
  },
  async unarchiveTask(id) {
    await callAction('task.unarchive', { id });
  },
  async deleteTask(id) {
    await callAction('task.delete', { id });
  },
  async history(taskId) {
    // Single-field filter; sorted here so no composite index is required.
    const snap = await getDocs(query(ws('activity_logs'), where('entity.id', '==', taskId), limit(100)));
    return snap.docs
      .map((d) => activityFromDoc(d.id, d.data()))
      .filter((x): x is ActivityLog => x !== null && x.entity.kind === 'task')
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 50);
  },
};
