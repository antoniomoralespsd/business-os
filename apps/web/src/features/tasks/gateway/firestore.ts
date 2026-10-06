'use client';
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { Client, Task } from '@bos/schemas';
import { callAction } from '@/lib/actionsClient';
import { WORKSPACE_ID } from '@/lib/config';
import { activityFromDoc, clientFromDoc, taskFromDoc } from '@/lib/convert';
import { clientDb } from '@/lib/firebaseClient';
import type { TasksGateway } from './types';

const ws = (name: string) => collection(clientDb(), 'workspaces', WORKSPACE_ID, name);

export const firestoreTasksGateway: TasksGateway = {
  subscribeTasks({ from, to }, onData, onError) {
    // Two live queries (dated range + undated); emit only once both have answered.
    let dated: Task[] | null = null;
    let undated: Task[] | null = null;
    const emit = () => {
      if (dated && undated) onData([...dated, ...undated]);
    };
    const toTasks = (docs: { id: string; data: () => Record<string, unknown> }[]) =>
      docs.map((d) => taskFromDoc(d.id, d.data())).filter((t): t is Task => t !== null);

    const unsubA = onSnapshot(
      query(ws('tasks'), where('archived', '==', false), where('dueDate', '>=', from), where('dueDate', '<=', to)),
      (snap) => {
        dated = toTasks(snap.docs);
        emit();
      },
      onError,
    );
    const unsubB = onSnapshot(
      query(ws('tasks'), where('archived', '==', false), where('dueDate', '==', null)),
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
  },

  subscribeClients(onData, onError) {
    return onSnapshot(
      query(ws('clients'), orderBy('name')),
      (snap) => onData(snap.docs.map((d) => clientFromDoc(d.id, d.data())).filter((c): c is Client => c !== null)),
      onError,
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
    const snap = await getDocs(
      query(ws('activity_logs'), where('entity.kind', '==', 'task'), where('entity.id', '==', taskId), orderBy('at', 'desc'), limit(50)),
    );
    return snap.docs.map((d) => activityFromDoc(d.id, d.data())).filter((x) => x !== null);
  },
};
