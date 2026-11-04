/**
 * Helpers for pages that list issues from several teams at once (My Issues).
 *
 * Workflow states belong to a team: ENG and OPS each have their own "Todo" row
 * with a different id. A list grouped by `stateId` over the union of every
 * team's states therefore shows one "Todo" group per team, and a status picker
 * built from that union lets a team A issue be moved to a team B state, which
 * the server rejects. The fix is by source: render one section per team, each
 * with only that team's states.
 */

/** Issues bucketed by team, in `teamOrder` first and unknown teams last. */
export function groupIssuesByTeam<T extends { teamId: string }>(
  issues: readonly T[],
  teamOrder: readonly string[],
): Array<{ issues: T[]; teamId: string }> {
  const buckets = new Map<string, T[]>();
  for (const issue of issues) {
    const bucket = buckets.get(issue.teamId);
    if (bucket) {
      bucket.push(issue);
    } else {
      buckets.set(issue.teamId, [issue]);
    }
  }
  const rank = (teamId: string) => {
    const i = teamOrder.indexOf(teamId);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return Array.from(buckets, ([teamId, group]) => ({ issues: group, teamId })).sort(
    (a, b) => rank(a.teamId) - rank(b.teamId),
  );
}

/**
 * Suffixes a state's name with its team key wherever the same name exists in
 * more than one team, so a flat list of every team's states (the filter
 * options) doesn't offer two indistinguishable "Todo" entries. Names that are
 * unique across teams are untouched.
 */
export function disambiguateStateNames<T extends { name: string; teamId: string }>(
  states: readonly T[],
  teamKey: (teamId: string) => string | undefined,
): T[] {
  const teamsByName = new Map<string, Set<string>>();
  for (const state of states) {
    const teams = teamsByName.get(state.name) ?? new Set<string>();
    teams.add(state.teamId);
    teamsByName.set(state.name, teams);
  }
  return states.map(state => {
    const key = teamKey(state.teamId);
    return key && (teamsByName.get(state.name)?.size ?? 0) > 1
      ? { ...state, name: `${state.name} · ${key}` }
      : { ...state };
  });
}
