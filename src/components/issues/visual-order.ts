/**
 * The order issue rows are drawn in, published by `IssueListView` for the
 * keyboard handlers that live in `useIssueListPage`.
 *
 * With configurable grouping the rendered order is not the order of the
 * `issues` array (a list grouped by priority is partitioned, a list grouped by
 * status but ordered by priority is globally sorted but drawn per status), so
 * j/k and Shift-range select must walk what the user sees. Only one issue list
 * is mounted at a time, so a module-level value is enough.
 */
// `null` means no list is mounted (the board, or between pages). An EMPTY array
// is a real answer — every group collapsed, nothing is drawn — and must not be
// mistaken for "unpublished", or j/k would walk rows the user cannot see.
let visualOrder: string[] | null = null;

export function setVisualOrder(ids: string[] | null): void {
  visualOrder = ids;
}

export function getVisualOrder(): string[] | null {
  return visualOrder;
}

/**
 * Neighbour of `currentId` in the drawn order, restricted to ids still in
 * `fallback` (the page's issue array, used when no list has published an order,
 * e.g. the board view). With no current row it starts from the first/last.
 */
export function stepVisualOrder(
  currentId: string | null,
  direction: 1 | -1,
  fallback: string[],
): string | null {
  const known = new Set(fallback);
  const order = visualOrder === null ? fallback : visualOrder.filter(id => known.has(id));
  if (order.length === 0) {
    return null;
  }
  const idx = currentId ? order.indexOf(currentId) : -1;
  const next = Math.min(Math.max(idx + direction, 0), order.length - 1);
  return order[next] ?? null;
}

/** Ids of the rows actually drawn: rows inside a collapsed group are skipped. */
export function drawnIdsOf(
  groups: { issues: { id: string }[]; key: string }[],
  collapsed: ReadonlySet<string>,
  headerless = false,
): string[] {
  return groups
    .filter(g => headerless || !collapsed.has(g.key))
    .flatMap(g => g.issues.map(i => i.id));
}
