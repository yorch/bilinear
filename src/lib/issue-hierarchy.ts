/** The slice of an issue the hierarchy helpers read. */
interface HierarchyRow {
  id: string;
  parentId?: string | null;
}

/**
 * Every issue below `rootId` in the parent/child tree. Used to keep a
 * "Set parent…" picker from offering a descendant, which would close a loop —
 * the server rejects that too, this just stops the UI offering a doomed choice.
 * Guards against an existing loop in the data by never revisiting a node.
 */
export function collectDescendantIds(rows: Iterable<HierarchyRow>, rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (row.parentId) {
      const siblings = childrenOf.get(row.parentId);
      if (siblings) {
        siblings.push(row.id);
      } else {
        childrenOf.set(row.parentId, [row.id]);
      }
    }
  }
  const found = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const next = queue.pop() as string;
    for (const child of childrenOf.get(next) ?? []) {
      if (!found.has(child)) {
        found.add(child);
        queue.push(child);
      }
    }
  }
  return found;
}

/**
 * Whether `candidateId` may become the parent of `issueId`: not the issue
 * itself and not anywhere in its subtree.
 */
export function canBeParent(rows: Iterable<HierarchyRow>, issueId: string, candidateId: string) {
  return candidateId !== issueId && !collectDescendantIds(rows, issueId).has(candidateId);
}
