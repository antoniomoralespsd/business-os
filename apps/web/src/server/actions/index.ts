import 'server-only';
import type { AnyAction } from './registry';
import { taskActions } from './tasks';

/**
 * The single catalogue of write actions. UI, Command Center and (later) AI all go through it.
 * Add a module's actions here; nothing else writes to Firestore.
 */
export const ACTIONS: ReadonlyMap<string, AnyAction> = new Map(taskActions.map((a): [string, AnyAction] => [a.name, a]));
