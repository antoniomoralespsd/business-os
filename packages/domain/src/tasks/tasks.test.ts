import { describe, expect, it } from 'vitest';
import type { Task } from '@bos/schemas';
import { addDays, formatWeekRange, startOfWeek, todayISO, weekDays } from '../dates';
import { bucketCounts, DEFAULT_FILTER, groupByDay, matchesFilter } from './filter';
import { orderBetween, orderForIndex } from './order';
import { parseQuickAdd } from './quickAdd';
import { bucketOf, primaryNextStatus, statusTransitionPatch } from './status';

const clients = [
  { id: 'cityhall', name: 'City Hall', aliases: ['CH'], status: 'active' as const },
  { id: 'level-bcn', name: 'Level Barcelona', aliases: ['level bcn'], status: 'active' as const },
  { id: 'level-and', name: 'Level Andorra', aliases: ['level and'], status: 'active' as const },
  { id: 'bellaka', name: 'Bellaka', aliases: [], status: 'active' as const },
  { id: 'old', name: 'Otto', aliases: [], status: 'archived' as const },
];

const task = (over: Partial<Task>): Task => ({
  id: 't', workspaceId: 'w', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z',
  createdBy: 'u', title: 'x', clientId: null, description: '', dueDate: '2026-10-12', status: 'pending',
  priority: 'normal', order: 1024, archived: false, completedAt: null, reviewStartedAt: null, jobId: null, ...over,
});

describe('dates', () => {
  it('weeks start on Monday', () => {
    expect(startOfWeek('2026-10-07')).toBe('2026-10-05');
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05');
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12');
    expect(weekDays('2026-10-14')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  });
  it('crosses months and DST without drifting', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26'); // DST ends 25 Oct in Madrid
    expect(formatWeekRange(weekDays('2026-10-28'))).toBe('26 octubre — 1 noviembre 2026');
    expect(formatWeekRange(weekDays('2026-10-14'))).toBe('12 — 18 octubre 2026');
  });
  it('today is computed in Europe/Madrid', () => {
    // 23:30 UTC on 6 Oct is already 7 Oct in Madrid (UTC+2)
    expect(todayISO(new Date('2026-10-06T23:30:00Z'))).toBe('2026-10-07');
  });
});

describe('status', () => {
  it('splits work from waiting', () => {
    expect(bucketOf('pending')).toBe('action');
    expect(bucketOf('in_progress')).toBe('action');
    expect(bucketOf('changes_requested')).toBe('action');
    expect(bucketOf('review')).toBe('waiting');
    expect(bucketOf('completed')).toBe('done');
  });
  it('stamps reviewStartedAt and completedAt', () => {
    const now = '2026-10-12T18:32:00.000Z';
    const toReview = statusTransitionPatch({ status: 'in_progress', completedAt: null, reviewStartedAt: null }, 'review', now);
    expect(toReview.reviewStartedAt).toBe(now);
    const toChanges = statusTransitionPatch({ ...toReview }, 'changes_requested', now);
    expect(toChanges.reviewStartedAt).toBeNull();
    const done = statusTransitionPatch({ status: 'review', completedAt: null, reviewStartedAt: now }, 'completed', now);
    expect(done.completedAt).toBe(now);
    const reopened = statusTransitionPatch(done, 'pending', now);
    expect(reopened.completedAt).toBeNull();
  });
  it('primary action sends to review, then approves', () => {
    expect(primaryNextStatus('pending')?.status).toBe('review');
    expect(primaryNextStatus('changes_requested')?.status).toBe('review');
    expect(primaryNextStatus('review')?.status).toBe('completed');
    expect(primaryNextStatus('completed')).toBeNull();
  });
});

describe('order', () => {
  it('inserts between neighbours', () => {
    expect(orderBetween(null, null)).toBe(1024);
    expect(orderBetween(1024, 2048)).toBe(1536);
    expect(orderBetween(null, 1024)).toBe(0);
    const sibs = [{ order: 1024 }, { order: 2048 }];
    expect(orderForIndex(sibs, 0)).toBe(0);
    expect(orderForIndex(sibs, 1)).toBe(1536);
    expect(orderForIndex(sibs, 2)).toBe(3072);
    expect(orderForIndex(sibs, 99)).toBe(3072);
  });
});

describe('quick add', () => {
  it('detects the client and strips it from the title', () => {
    expect(parseQuickAdd('Flyer Halloween City Hall', clients)).toEqual({ title: 'Flyer Halloween', clientId: 'cityhall' });
    expect(parseQuickAdd('city hall 21 oct sala 2', clients)).toEqual({ title: '21 oct sala 2', clientId: 'cityhall' });
    expect(parseQuickAdd('Bellaka - flyer lunes', clients)).toEqual({ title: 'flyer lunes', clientId: 'bellaka' });
  });
  it('prefers the longest match', () => {
    expect(parseQuickAdd('level barcelona vie', clients).clientId).toBe('level-bcn');
    expect(parseQuickAdd('level and sab 2', clients)).toEqual({ title: 'sab 2', clientId: 'level-and' });
  });
  it('does not guess', () => {
    expect(parseQuickAdd('cityhallish flyer', clients)).toEqual({ title: 'cityhallish flyer', clientId: null });
    expect(parseQuickAdd('otto week', clients).clientId).toBeNull(); // archived client
    expect(parseQuickAdd('City Hall', clients)).toEqual({ title: 'City Hall', clientId: 'cityhall' });
  });
});

describe('filters and counts', () => {
  const byId = new Map(clients.map((c) => [c.id, c]));
  it('searches title, client and notes', () => {
    const t = task({ title: 'Flyer', clientId: 'cityhall', description: 'versión azul' });
    expect(matchesFilter(t, { ...DEFAULT_FILTER, query: 'city' }, byId)).toBe(true);
    expect(matchesFilter(t, { ...DEFAULT_FILTER, query: 'azul flyer' }, byId)).toBe(true);
    expect(matchesFilter(t, { ...DEFAULT_FILTER, query: 'rojo' }, byId)).toBe(false);
  });
  it('filters by bucket and hides completed', () => {
    const r = task({ status: 'review' });
    expect(matchesFilter(r, { ...DEFAULT_FILTER, status: 'bucket:action' }, byId)).toBe(false);
    expect(matchesFilter(r, { ...DEFAULT_FILTER, status: 'bucket:waiting' }, byId)).toBe(true);
    expect(matchesFilter(task({ status: 'completed' }), { ...DEFAULT_FILTER, showCompleted: false }, byId)).toBe(false);
  });
  it('counts 7 to do and 4 waiting as separate numbers', () => {
    const tasks = [
      ...Array.from({ length: 7 }, (_, i) => task({ id: `a${i}`, status: i % 2 ? 'in_progress' : 'pending' })),
      ...Array.from({ length: 4 }, (_, i) => task({ id: `w${i}`, status: 'review' })),
      task({ id: 'd', status: 'completed', completedAt: '2026-10-12T09:00:00.000Z' }),
      task({ id: 'd2', status: 'completed', completedAt: '2026-10-10T09:00:00.000Z' }),
      task({ id: 'arch', archived: true }),
    ];
    expect(bucketCounts(tasks, '2026-10-12')).toEqual({ action: 7, waiting: 4, done: 1 });
  });
  it('groups by day sorted by order', () => {
    const g = groupByDay([task({ id: 'b', order: 2 }), task({ id: 'a', order: 1 }), task({ id: 'n', dueDate: null })]);
    expect(g.get('2026-10-12')!.map((t) => t.id)).toEqual(['a', 'b']);
    expect(g.get('none')!.map((t) => t.id)).toEqual(['n']);
  });
});
