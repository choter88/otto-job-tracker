/**
 * Office-defined custom lists (statuses, types, labs, columns) are stored
 * with an `order` field. Sort consistently everywhere the user sees them
 * — lifecycle progress bar, filter dropdowns, New Job form selects.
 *
 * Without a single sort helper, drift is easy: the wizard's drag-to-reorder
 * editor would say "Status #4" but the worklist filter dropdown would show
 * a different position.
 */

interface OrderedItem {
  order?: number;
}

export function sortByOrder<T extends OrderedItem>(items: T[]): T[] {
  if (!Array.isArray(items)) return [];
  return [...items]
    .map((item, idx) => ({ item, idx, order: typeof item.order === "number" ? item.order : idx }))
    .sort((a, b) => a.order - b.order || a.idx - b.idx)
    .map(({ item }) => item);
}
