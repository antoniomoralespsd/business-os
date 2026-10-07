import { z } from 'zod';
import { ClientSchema, type Client } from '@bos/schemas';
import { parseQuickAdd } from '@bos/domain';
import { parseDoc } from '@/lib/convert';
import type { TxLike } from '@/data/db';
import { baseFields, defineAction, type ActionContext } from './define';

/**
 * One-off data migrations, applied once per workspace and recorded in `migrations/{id}`.
 * The app calls `system.migrate` on load; it is a no-op when everything is applied.
 */
interface Migration {
  id: string;
  description: string;
  run: (ctx: ActionContext, tx: TxLike, clients: Client[]) => Promise<number> | number;
}

/** Tasks of the week 5–11 Oct 2026 as they were in Asana (Mon/Tue done, Wed pending). */
const WEEK_41: { date: string; done: boolean; titles: string[] }[] = [
  {
    date: '2026-10-05',
    done: true,
    titles: ['level barcelona vie', 'level barcelona sab', 'icon vie', 'icon sab', 'icon dom', 'level and vie', 'level and sab1', 'level and sab 2', 'level and dom'],
  },
  {
    date: '2026-10-06',
    done: true,
    titles: [
      'contestar 620',
      'contestar 612',
      'city 7 oct sala 2',
      'cambio icon 11 oct',
      'cambio icon 9 oct',
      'cambio icon 10 oct',
      'level bcn 11 oct',
      'alternativo espacios singulares',
      'cambio rafa tour',
      'city hall 21 oct',
      'otto week',
    ],
  },
  {
    date: '2026-10-07',
    done: false,
    titles: [
      'cambio voz city 31 oct',
      'FACTURAS',
      'paradise london finde',
      'hybrunch 25 oct',
      'icon imprimir',
      'city hall 20 oct',
      'city hall 21 oct sala 2',
      'city 17 oct sala 2',
      'video flyer 10 oct city',
      'city hall 29 oct sala 2',
      'flyers sugar',
      'flyers caprixo',
    ],
  },
];

const MIGRATIONS: Migration[] = [
  {
    id: '2026-10-07-import-week-41',
    description: 'Importa las tareas de Asana de la semana del 5 de octubre',
    run: (ctx, tx, clients) => {
      let n = 0;
      for (const day of WEEK_41) {
        day.titles.forEach((raw, i) => {
          const { title, clientId } = parseQuickAdd(raw, clients);
          const ref = ctx.col('tasks').doc(`import-w41-${day.date}-${i}`);
          const doneAt = new Date(`${day.date}T19:00:00.000Z`);
          tx.set(ref, {
            ...baseFields(ctx, ref.id),
            title: title.charAt(0).toUpperCase() + title.slice(1),
            clientId,
            description: '',
            dueDate: day.date,
            status: day.done ? 'completed' : 'pending',
            priority: raw === 'FACTURAS' ? 'high' : 'normal',
            order: (i + 1) * 1024,
            archived: false,
            completedAt: day.done ? doneAt : null,
            reviewStartedAt: null,
            jobId: null,
          });
          n++;
        });
      }
      return n;
    },
  },
];

export const runMigrations = defineAction({
  name: 'system.migrate',
  description: 'Aplica migraciones de datos pendientes (una sola vez).',
  input: z.object({}).default({}),
  critical: false,
  handler: async (ctx) => {
    const applied: string[] = [];
    for (const m of MIGRATIONS) {
      await ctx.db.runTransaction(async (tx) => {
        const mref = ctx.col('migrations').doc(m.id);
        if ((await tx.get(mref)).exists) return;
        const clientDocs = await tx.getQuery(ctx.col('clients'));
        const clients = clientDocs.docs.map((d) => parseDoc(ClientSchema, d.id, d.data() ?? {})).filter((c): c is Client => c !== null);
        const count = await m.run(ctx, tx, clients);
        tx.set(mref, { id: m.id, description: m.description, appliedAt: ctx.now, count });
        ctx.log(tx, { action: 'system.migrate', entity: { kind: 'migration', id: m.id }, summary: `${m.description} (${count})` });
        applied.push(m.id);
      });
    }
    return { applied };
  },
});

export const systemActions = [runMigrations];
