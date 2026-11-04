import { describe, expect, it } from 'vitest';
import { groupRoadmapProjects } from './public-roadmap-view';

const p = (name: string, statusType: string, targetDate: string | null) => ({
  name,
  statusType,
  targetDate,
});

describe('groupRoadmapProjects', () => {
  it('orders sections by status and projects by target date, undated last', () => {
    const groups = groupRoadmapProjects([
      p('late', 'inProgress', '2026-12-01T00:00:00.000Z'),
      p('none', 'inProgress', null),
      p('soon', 'inProgress', '2026-11-01T00:00:00.000Z'),
      p('done', 'completed', '2026-01-01'),
      p('plan', 'planned', null),
    ]);
    expect(groups.map(g => g.status)).toEqual(['inProgress', 'planned', 'completed']);
    expect(groups[0].items.map(i => i.name)).toEqual(['soon', 'late', 'none']);
  });
  it('keeps paused projects visible in their own section', () => {
    expect(groupRoadmapProjects([p('x', 'paused', null)]).map(g => g.status)).toEqual(['paused']);
  });
  it('files an unrecognised status under planned rather than dropping it', () => {
    const groups = groupRoadmapProjects([p('x', 'mystery', null)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('planned');
  });
});
