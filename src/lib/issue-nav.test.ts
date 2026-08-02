import { describe, expect, it } from 'vitest';
import { buildIssueHref, isPathWithin } from './issue-nav';

describe('isPathWithin', () => {
  it('matches the route itself', () => {
    expect(isPathWithin('/acme/team/ENG', '/acme/team/ENG')).toBe(true);
  });

  it('matches a descendant route', () => {
    expect(isPathWithin('/acme/team/ENG/cycles', '/acme/team/ENG')).toBe(true);
    expect(isPathWithin('/acme/team/ENG/view/abc', '/acme/team/ENG')).toBe(true);
  });

  // The reason this helper exists. Team keys are free-form, so one is
  // routinely a prefix of another; a bare `startsWith` made the sidebar expand
  // ENG when you were in ENGX, hiding ENGX's own sub-nav.
  it('does not match a sibling whose key merely shares a prefix', () => {
    expect(isPathWithin('/acme/team/ENGX', '/acme/team/ENG')).toBe(false);
    expect(isPathWithin('/acme/team/ENGX/cycles', '/acme/team/ENG')).toBe(false);
  });

  it('does not match a shorter path', () => {
    expect(isPathWithin('/acme/team', '/acme/team/ENG')).toBe(false);
  });
});

describe('buildIssueHref', () => {
  it('builds a bare href without a return target', () => {
    expect(buildIssueHref('acme', 'iss-1')).toBe('/acme/issue/iss-1');
  });

  it('carries the return path and label as query params', () => {
    expect(buildIssueHref('acme', 'iss-1', { label: 'My Issues', path: '/acme/my-issues' })).toBe(
      '/acme/issue/iss-1?from=%2Facme%2Fmy-issues&fromLabel=My+Issues',
    );
  });
});
