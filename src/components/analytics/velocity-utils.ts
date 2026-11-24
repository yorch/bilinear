/**
 * The scale of the "completed by team" bars — the largest completed count, or 0
 * when no team has completed anything. It is deliberately NOT floored at 1: the
 * caller uses `> 0` to decide whether the chart is worth drawing, and a floor
 * made that check always true (a chart of empty tracks, each labelled "0").
 */
export function maxCompletedCount(teams: ReadonlyArray<{ completedCount: number }>): number {
  return teams.reduce((max, t) => Math.max(max, t.completedCount), 0);
}

/** Bar width as a percentage of the largest bar; 0 when there is nothing to scale against. */
export function barPercent(value: number, max: number): number {
  return max > 0 ? (value / max) * 100 : 0;
}
