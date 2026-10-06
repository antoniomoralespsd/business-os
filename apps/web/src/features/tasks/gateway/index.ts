'use client';
import { DATA_MODE } from '@/lib/config';
import { firestoreTasksGateway } from './firestore';
import { createMemoryGateway } from './memory';
import type { TasksGateway } from './types';

let memory: TasksGateway | null = null;

export function tasksGateway(): TasksGateway {
  if (DATA_MODE === 'memory') {
    memory ??= createMemoryGateway({ storageKey: 'bos-demo-v1', latencyMs: 150 });
    return memory;
  }
  return firestoreTasksGateway;
}

export type { TasksGateway } from './types';
