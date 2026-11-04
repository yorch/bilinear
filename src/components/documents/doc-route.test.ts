import { describe, expect, it } from 'vitest';
import { getDocumentIdFromPath, isTeamDocsActive } from './doc-route';

describe('getDocumentIdFromPath', () => {
  it('extracts the id from a document route', () => {
    expect(getDocumentIdFromPath('/demo/docs/abc-123')).toBe('abc-123');
  });
  it('ignores the docs index and unrelated paths', () => {
    expect(getDocumentIdFromPath('/demo/docs')).toBeNull();
    expect(getDocumentIdFromPath('/demo/team/ENG/docs')).toBeNull();
    expect(getDocumentIdFromPath('/demo/issues/abc')).toBeNull();
  });
});

describe('isTeamDocsActive', () => {
  const base = { docsHref: '/demo/team/ENG/docs', teamId: 't1' };
  it('is active on the team docs list', () => {
    expect(isTeamDocsActive({ ...base, docTeamId: null, pathname: '/demo/team/ENG/docs' })).toBe(
      true,
    );
  });
  it('is active on a document owned by the team', () => {
    expect(isTeamDocsActive({ ...base, docTeamId: 't1', pathname: '/demo/docs/d1' })).toBe(true);
  });
  it("is not active on another team's document or a team-less one", () => {
    expect(isTeamDocsActive({ ...base, docTeamId: 't2', pathname: '/demo/docs/d1' })).toBe(false);
    expect(isTeamDocsActive({ ...base, docTeamId: null, pathname: '/demo/docs/d1' })).toBe(false);
  });
});
