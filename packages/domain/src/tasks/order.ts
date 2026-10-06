export const ORDER_STEP = 1024;

/**
 * Fractional ordering: a value strictly between `before` and `after`.
 * null on either side means "start" / "end" of the list.
 */
export function orderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return ORDER_STEP;
  if (before === null) return (after as number) - ORDER_STEP;
  if (after === null) return before + ORDER_STEP;
  return (before + after) / 2;
}

/**
 * Order for an item dropped at `index` into `siblings` (already sorted, NOT containing the item).
 */
export function orderForIndex(siblings: readonly { order: number }[], index: number): number {
  const clamped = Math.max(0, Math.min(index, siblings.length));
  const before = clamped > 0 ? siblings[clamped - 1]!.order : null;
  const after = clamped < siblings.length ? siblings[clamped]!.order : null;
  return orderBetween(before, after);
}

/** Order for a new item appended at the end. */
export function orderAtEnd(siblings: readonly { order: number }[]): number {
  if (siblings.length === 0) return ORDER_STEP;
  return Math.max(...siblings.map((s) => s.order)) + ORDER_STEP;
}
