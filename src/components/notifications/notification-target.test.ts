import { describe, expect, it } from 'vitest';
import { type NotificationTargetLookups, resolveNotificationTarget } from './notification-target';

const lookups: NotificationTargetLookups = {
  document: id => (id === 'd1' ? { title: 'Spec' } : null),
  initiative: id => (id === 'i1' ? { name: 'Growth' } : null),
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
    expect(resolveNotificationTarget({ data: { documentId: 'd1' } }, 'ws', lookups)?.href).toBe(
      '/ws/docs/d1',
    );
    expect(
      resolveNotificationTarget(
        { data: { entityId: 'i1', entityType: 'Initiative' } },
        'ws',
        lookups,
      ),
    ).toEqual({ href: '/ws/initiatives/i1', title: 'Growth' });
  });

  it('returns null rather than a dead link when nothing resolves', () => {
    expect(resolveNotificationTarget({ data: { projectId: 'gone' } }, 'ws', lookups)).toBeNull();
    expect(resolveNotificationTarget({ data: {}, issueId: 'missing' }, 'ws', lookups)).toBeNull();
  });
});
