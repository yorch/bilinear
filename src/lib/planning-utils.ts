/**
 * Order in which workflow-state types read down a planning list: what is being
 * worked on first, finished work last. Rows used to come back in pool
 * insertion order, which is neither by state nor by identifier.
 */
const STATE_TYPE_RANK: Record<string, number> = {
  backlog: 2,
  canceled: 5,
  completed: 4,
  started: 0,
  triage: 3,
  unstarted: 1,
};

export function sortIssuesByState<T extends { stateId: string; identifier: string }>(
  issues: T[],
  findState: (id: string) => { type: string; position: number } | null | undefined,
): T[] {
  const rank = (issue: T) => STATE_TYPE_RANK[findState(issue.stateId)?.type ?? ''] ?? 99;
  return [...issues].sort((a, b) => {
    const byType = rank(a) - rank(b);
    if (byType !== 0) {
      return byType;
    }
    const byPos = (findState(a.stateId)?.position ?? 0) - (findState(b.stateId)?.position ?? 0);
    if (byPos !== 0) {
      return byPos;
    }
    return a.identifier.localeCompare(b.identifier, undefined, { numeric: true });
  });
}

/**
 * Chart fill for a workflow state. A stored state colour is entity data, but
 * the neutral "not started" states (Backlog, Todo) are seeded as a pale slate
 * that is ~1.2:1 on a light card and a white slab on a dark one. Those types
 * take the theme-aware neutral token; coloured states keep their own colour.
 */
export function stateChartColor(state: { color: string; type: string }): string {
  return state.type === 'unstarted' || state.type === 'backlog' || state.type === 'triage'
    ? 'var(--state-default)'
    : state.color;
}
