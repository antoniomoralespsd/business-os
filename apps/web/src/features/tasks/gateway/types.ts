import type {
  ActivityLog,
  Client,
  CreateTaskInput,
  ISODate,
  MoveTaskInput,
  SetTaskStatusInput,
  Task,
  UpdateTaskInput,
} from '@bos/schemas';

export type Unsubscribe = () => void;

/**
 * Data port for the Tasks module. Two implementations:
 * - FirestoreTasksGateway: realtime reads from Firestore, writes through /api/actions.
 * - MemoryTasksGateway: same contract in memory, for tests and the offline demo.
 */
export interface TasksGateway {
  /** Live tasks with dueDate in [from, to] plus every undated task. Archived excluded. */
  subscribeTasks(range: { from: ISODate; to: ISODate }, onData: (tasks: Task[]) => void, onError: (e: Error) => void): Unsubscribe;
  subscribeClients(onData: (clients: Client[]) => void, onError: (e: Error) => void): Unsubscribe;
  createTask(input: CreateTaskInput): Promise<{ id: string }>;
  updateTask(input: UpdateTaskInput): Promise<void>;
  moveTask(input: MoveTaskInput): Promise<void>;
  setStatus(input: SetTaskStatusInput): Promise<void>;
  archiveTask(id: string): Promise<void>;
  unarchiveTask(id: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
  history(taskId: string): Promise<ActivityLog[]>;
}
