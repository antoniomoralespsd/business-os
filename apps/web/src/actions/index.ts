import { billingActions } from './billing';
import { clientActions } from './clients';
import type { AnyAction } from './define';
import { inboxActions } from './inbox';
import { settingsActions } from './settings';
import { subscriptionActions } from './subscriptions';
import { systemActions } from './system';
import { taskActions } from './tasks';

/**
 * The single catalogue of write actions. Used by /api/actions (server, Admin SDK) and by the
 * offline demo (MemoryDb). Nothing else writes data. Later, the Command Center / AI use it too.
 */
const all: AnyAction[] = [
  ...taskActions,
  ...clientActions,
  ...billingActions,
  ...subscriptionActions,
  ...inboxActions,
  ...settingsActions,
  ...systemActions,
] as AnyAction[];

export const ACTIONS: ReadonlyMap<string, AnyAction> = new Map(all.map((a) => [a.name, a]));
