import { describe, expect, it } from 'vitest';
import { type NotificationTargetLookups, resolveNotificationTarget } from './notification-target';

const D1 = '00000000-0000-0000-0000-0000000000d1';
const I1 = '00000000-0000-0000-0000-0000000000a1';
const lookups: NotificationTargetLookups = {
  document: id => (id === D1 ? { title: 'Spec' } : null),
  initiative: id => (id === I1 ? { name: 'Growth' } : null),
  issue: id => (id === 'is1' ? { identifier: 'ENG-1', title: 'Bug' } : null),
  project: id => (id === 'p1' ? { name: 'Apollo', slugId: 'apollo-abc' } : null),
};

describe('resolveNotificationTarget', () => {
  it('links an issue notification to the issue', () => {
    expect(resolveNotificationTarget({ data: {}, issueId: 'is1' }, 'ws', lookups)).toEqual({
      href: '/ws/issue/is1',
      identifier: 'ENG-1',
      title: 'Bug',
    });
  });

  it('links a project notification by slug', () => {
    expect(resolveNotificationTarget({ data: { projectId: 'p1' } }, 'ws', lookups)).toEqual({
      href: '/ws/project/apollo-abc',
      title: 'Apollo',
    });
  });

  it('links documents and initiatives, including the generic entity pair', () => {
    expect(resolveNotificationTarget({ data: { documentId: D1 } }, 'ws', lookups)?.href).toBe(
      `/ws/docs/${D1}`,
    );
    expect(
      resolveNotificationTarget(
        { data: { entityId: I1, entityType: 'Initiative' } },
        'ws',
        lookups,
      ),
    ).toEqual({ href: `/ws/initiatives/${I1}`, title: 'Growth' });
  });

  it('returns null rather than a dead link when nothing resolves', () => {
    expect(resolveNotificationTarget({ data: { projectId: 'gone' } }, 'ws', lookups)).toBeNull();
    expect(resolveNotificationTarget({ data: {}, issueId: 'missing' }, 'ws', lookups)).toBeNull();
  });

  it('never splices a non-UUID payload id into an href', () => {
    for (const bad of ['../../settings', 'd1', '1/../../x', '']) {
      expect(resolveNotificationTarget({ data: { documentId: bad } }, 'ws', lookups)).toBeNull();
      expect(resolveNotificationTarget({ data: { initiativeId: bad } }, 'ws', lookups)).toBeNull();
      expect(
        resolveNotificationTarget(
          { data: { entityId: bad, entityType: 'document' } },
          'ws',
          lookups,
        ),
      ).toBeNull();
    }
  });

  it('a REMINDER (issue-scoped, with extra payload) targets the issue, not a payload entity', () => {
    expect(
      resolveNotificationTarget(
        { data: { documentId: D1, remindAt: '2026-01-01T00:00:00Z' }, issueId: 'is1' },
        'ws',
        lookups,
      ),
    ).toEqual({ href: '/ws/issue/is1', identifier: 'ENG-1', title: 'Bug' });
  });

  it('uses the payload title for a document the store has not seen', () => {
    expect(
      resolveNotificationTarget(
        { data: { documentId: '00000000-0000-0000-0000-0000000000d9', title: 'Shared spec' } },
        'ws',
        lookups,
      )?.title,
    ).toBe('Shared spec');
  });
});
