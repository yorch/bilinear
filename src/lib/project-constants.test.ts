import { describe, expect, it } from 'vitest';
import { PROJECT_STATUS_CONFIG, projectListGroup } from './project-constants';

describe('projectListGroup', () => {
  it('places every known status in a group, so no project vanishes from the list', () => {
    for (const status of Object.keys(PROJECT_STATUS_CONFIG)) {
      expect(['active', 'completed']).toContain(projectListGroup(status));
    }
  });
  it('keeps paused projects visible in the active group', () => {
    expect(projectListGroup('paused')).toBe('active');
  });
  it('groups finished work as completed', () => {
    expect(projectListGroup('completed')).toBe('completed');
    expect(projectListGroup('canceled')).toBe('completed');
  });
  it('falls back to active for an unrecognised status', () => {
    expect(projectListGroup('mystery')).toBe('active');
  });
});
