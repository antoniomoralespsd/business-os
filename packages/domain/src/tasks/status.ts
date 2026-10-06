import type { Task, TaskBucket, TaskStatus } from '@bos/schemas';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  review: 'En revisión',
  changes_requested: 'Cambios solicitados',
  completed: 'Completado',
};

/** Short badge text used on compact cards. Empty = no badge. */
export const STATUS_BADGE: Record<TaskStatus, string> = {
  pending: '',
  in_progress: 'EN PROCESO',
  review: 'EN REVISIÓN',
  changes_requested: 'CAMBIOS',
  completed: '',
};

export function bucketOf(status: TaskStatus): TaskBucket {
  switch (status) {
    case 'pending':
    case 'in_progress':
    case 'changes_requested':
      return 'action';
    case 'review':
      return 'waiting';
    case 'completed':
      return 'done';
  }
}

export const BUCKET_LABEL: Record<TaskBucket, string> = {
  action: 'Requieren mi atención',
  waiting: 'Esperando aprobación',
  done: 'Completadas',
};

/**
 * Side effects of moving to a new status, applied in one write.
 * - entering review stamps reviewStartedAt (kept when bouncing review → changes → review? no: re-stamped, the wait restarts)
 * - leaving review/changes for an action state clears reviewStartedAt
 * - completed stamps completedAt; leaving completed clears it
 */
export function statusTransitionPatch(
  task: Pick<Task, 'status' | 'completedAt' | 'reviewStartedAt'>,
  next: TaskStatus,
  nowISO: string,
): Pick<Task, 'status' | 'completedAt' | 'reviewStartedAt'> {
  if (task.status === next) {
    return { status: next, completedAt: task.completedAt, reviewStartedAt: task.reviewStartedAt };
  }
  return {
    status: next,
    completedAt: next === 'completed' ? nowISO : null,
    reviewStartedAt:
      next === 'review' ? nowISO : next === 'completed' ? task.reviewStartedAt : null,
  };
}

export function statusChangeSummary(from: TaskStatus, to: TaskStatus): string {
  return `Estado: ${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}`;
}

/** Quick actions offered from the card menu, in display order. */
export const QUICK_STATUS_ACTIONS: { status: TaskStatus; label: string }[] = [
  { status: 'in_progress', label: 'En proceso' },
  { status: 'review', label: 'Enviar a revisión' },
  { status: 'changes_requested', label: 'Cambios solicitados' },
  { status: 'completed', label: 'Completar' },
  { status: 'pending', label: 'Volver a pendiente' },
];

/** The one-click primary action for a card: what you most likely do next. */
export function primaryNextStatus(status: TaskStatus): { status: TaskStatus; label: string } | null {
  switch (status) {
    case 'pending':
    case 'in_progress':
    case 'changes_requested':
      return { status: 'review', label: 'Enviado' };
    case 'review':
      return { status: 'completed', label: 'Aprobado' };
    case 'completed':
      return null;
  }
}
