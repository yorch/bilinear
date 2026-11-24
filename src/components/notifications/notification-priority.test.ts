import { describe, expect, it } from 'vitest';
import {
  classifyNotification,
  nextLane,
  partitionByLane,
  reminderTime,
} from './notification-priority';

const lookups = { issueAssigneeId: (id: string) => (id === 'mine' ? 'me' : 'someone') };
const n = (type: string, extra: { data?: object; issueId?: string | null } = {}) => ({
  data: extra.data ?? {},
  issueId: extra.issueId ?? null,
  type,
});

describe('classifyNotification', () => {
  it('treats assignment, mention and reminder as priority', () => {
    for (const type of ['ISSUE_ASSIGNED', 'ISSUE_MENTIONED', 'REMINDER']) {
      expect(classifyNotification(n(type), 'me', lookups)).toBe('priority');
    }
  });

  it('treats a plain subscribed comment as other but a reply to the viewer as priority', () => {
    expect(classifyNotification(n('ISSUE_COMMENTED'), 'me', lookups)).toBe('other');
    expect(
      classifyNotification(n('ISSUE_COMMENTED', { data: { replyToUserId: 'me' } }), 'me', lookups),
    ).toBe('priority');
    expect(
      classifyNotification(n('ISSUE_COMMENTED', { data: { replyToUserId: 'x' } }), 'me', lookups),
    ).toBe('other');
  });

  it('still honours legacy reply markers on old rows', () => {
    expect(
      classifyNotification(n('ISSUE_COMMENTED', { data: { parentAuthorId: 'me' } }), 'me', lookups),
    ).toBe('priority');
    expect(
      classifyNotification(n('ISSUE_COMMENTED', { data: { parentAuthorId: 'x' } }), 'me', lookups),
    ).toBe('other');
    expect(
      classifyNotification(n('ISSUE_COMMENTED', { data: { isReply: true } }), 'me', lookups),
    ).toBe('priority');
  });

  it('promotes status changes only on issues assigned to the viewer', () => {
    expect(
      classifyNotification(n('ISSUE_STATUS_CHANGED', { issueId: 'mine' }), 'me', lookups),
    ).toBe('priority');
    expect(
      classifyNotification(n('ISSUE_STATUS_CHANGED', { issueId: 'theirs' }), 'me', lookups),
    ).toBe('other');
    expect(
      classifyNotification(n('ISSUE_STATUS_CHANGED', { issueId: 'mine' }), null, lookups),
    ).toBe('other');
  });

  it('sends unknown types to other', () => {
    expect(classifyNotification(n('SOMETHING_NEW'), 'me', lookups)).toBe('other');
  });
});

describe('partitionByLane', () => {
  it('splits while preserving order', () => {
    const rows = [n('ISSUE_ASSIGNED'), n('ISSUE_COMMENTED'), n('REMINDER')];
    const out = partitionByLane(rows, 'me', lookups);
    expect(out.priority).toEqual([rows[0], rows[2]]);
    expect(out.other).toEqual([rows[1]]);
  });
});

describe('reminderTime / nextLane', () => {
  it('reads a valid remindAt only', () => {
    expect(reminderTime({ data: { remindAt: '2026-11-25T09:00:00Z' } })).toBe(
      '2026-11-25T09:00:00Z',
    );
    expect(reminderTime({ data: { remindAt: 'nope' } })).toBeNull();
    expect(reminderTime({ data: {} })).toBeNull();
  });

  it('wraps arrow navigation and ignores other keys', () => {
    expect(nextLane('priority', 'ArrowRight')).toBe('other');
    expect(nextLane('other', 'ArrowRight')).toBe('priority');
    expect(nextLane('priority', 'ArrowLeft')).toBe('other');
    expect(nextLane('priority', 'Enter')).toBeNull();
  });
});
