import { autorun } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBNotification } from '@/lib/db';
import { NotificationStore } from './notification-store';

function makeNotification(overrides: Partial<DBNotification> & { id: string }): DBNotification {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    data: {},
    organizationId: 'org-1',
    read: false,
    type: 'mention',
    updatedAt: '2026-01-01T00:00:00Z',
    userId: 'user-1',
    ...overrides,
  };
}

describe('NotificationStore', () => {
  let store: NotificationStore;

  beforeEach(() => {
    store = new NotificationStore();
  });

  describe('all', () => {
    it('sorts newest-first by createdAt', () => {
      store.upsertMany([
        makeNotification({ createdAt: '2026-01-01T00:00:00Z', id: 'old' }),
        makeNotification({ createdAt: '2026-03-01T00:00:00Z', id: 'new' }),
        makeNotification({ createdAt: '2026-02-01T00:00:00Z', id: 'mid' }),
      ]);
      expect(store.all.map(n => n.id)).toEqual(['new', 'mid', 'old']);
    });
  });

  describe('unread', () => {
    beforeEach(() => {
      store.upsertMany([
        makeNotification({ id: '1', read: false }),
        makeNotification({ id: '2', read: true }),
        makeNotification({ id: '3', read: false }),
      ]);
    });

    it('filters to unread and counts them', () => {
      expect(store.unread.map(n => n.id).sort()).toEqual(['1', '3']);
      expect(store.unreadCount).toBe(2);
    });
  });

  describe('markRead / markAllRead', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('marks a single notification read with a timestamp', () => {
      store.upsertMany([makeNotification({ id: '1', read: false })]);
      store.markRead('1');
      const n = store.findById('1');
      expect(n?.read).toBe(true);
      expect(n?.readAt).toBe('2026-06-15T12:00:00.000Z');
    });

    it('markRead is a no-op for an unknown id', () => {
      store.markRead('missing');
      expect(store.findById('missing')).toBeNull();
    });

    it('marks all unread read and leaves already-read untouched', () => {
      store.upsertMany([
        makeNotification({ id: '1', read: false }),
        makeNotification({ id: '2', read: true, readAt: '2026-01-01T00:00:00Z' }),
      ]);
      store.markAllRead();
      expect(store.unreadCount).toBe(0);
      // The already-read one keeps its original readAt.
      expect(store.findById('2')?.readAt).toBe('2026-01-01T00:00:00Z');
      expect(store.findById('1')?.readAt).toBe('2026-06-15T12:00:00.000Z');
    });
  });

  describe('applySyncAction', () => {
    it('upserts on I/U/A and deletes on D', () => {
      store.applySyncAction('I', '1', makeNotification({ id: '1' }));
      expect(store.findById('1')).not.toBeNull();
      store.applySyncAction('D', '1', null);
      expect(store.findById('1')).toBeNull();
    });

    it('ignores I/U/A with null data, leaving an existing row intact', () => {
      const row = makeNotification({ id: '1' });
      store.applySyncAction('I', '1', row);

      store.applySyncAction('A', '1', null);

      // Asserted through `pool`, not `findById`: the latter is `get(id) ?? null`,
      // so a row overwritten with `null` would still read back as `null` and this
      // test could not fail.
      expect(store.pool.get('1')).toEqual(row);
      expect(store.pool.size).toBe(1);
    });
  });

  describe('hasMore / loadState', () => {
    it('flags a full page as truncated and a short page as complete', () => {
      store.reconcile([makeNotification({ id: 'a' }), makeNotification({ id: 'b' })], 2);
      expect(store.hasMore).toBe(true);
      store.reconcile([makeNotification({ id: 'a' })], 2);
      expect(store.hasMore).toBe(false);
    });

    it('starts idle and records load state', () => {
      expect(store.loadState).toBe('idle');
      store.setLoadState('error');
      expect(store.loadState).toBe('error');
    });
  });

  describe('reconcile', () => {
    it('drops pooled rows the server no longer returns (short page = whole list)', () => {
      store.upsertMany([makeNotification({ id: 'snoozed' }), makeNotification({ id: 'kept' })]);
      store.reconcile([makeNotification({ id: 'kept' })], 50);
      expect([...store.pool.keys()]).toEqual(['kept']);
      expect(store.unreadCount).toBe(1);
    });

    it('on a full page only judges rows at least as new as the oldest returned', () => {
      store.upsertMany([
        makeNotification({ createdAt: '2025-01-01T00:00:00Z', id: 'beyond-page' }),
        makeNotification({ createdAt: '2026-02-01T00:00:00Z', id: 'gone' }),
      ]);
      store.reconcile([makeNotification({ createdAt: '2026-01-01T00:00:00Z', id: 'a' })], 1);
      expect(store.pool.has('beyond-page')).toBe(true);
      expect(store.pool.has('gone')).toBe(false);
      expect(store.pool.has('a')).toBe(true);
    });
  });

  describe('unreadCount with a server total', () => {
    it('reports the server total, not the size of the fetched page', () => {
      store.reconcile([makeNotification({ id: 'a' }), makeNotification({ id: 'b' })], 2, 29);
      expect(store.unreadCount).toBe(29);
    });

    it('moves by local read/unread flips since the fetch', () => {
      store.reconcile([makeNotification({ id: 'a' }), makeNotification({ id: 'b' })], 2, 29);
      store.markRead('a');
      expect(store.unreadCount).toBe(28);
      store.markUnread('a');
      expect(store.unreadCount).toBe(29);
    });

    it('does not count older unread rows from Load more twice', () => {
      store.reconcile([makeNotification({ id: 'a' })], 1, 3);
      store.appendPage([makeNotification({ createdAt: '2025-01-01T00:00:00Z', id: 'older' })], 1);
      expect(store.unreadCount).toBe(3);
    });

    it('stops counting a row once it is snoozed', () => {
      store.reconcile([makeNotification({ id: 'a' })], 50, 5);
      store.optimisticUpdate('a', { snoozedUntilAt: '2999-01-01T00:00:00Z' });
      expect(store.unreadCount).toBe(4);
      expect(store.snoozed.map(n => n.id)).toEqual(['a']);
    });
  });

  describe('reconcile and snoozed rows', () => {
    it('keeps a snoozed row that the default list omits', () => {
      store.upsertMany([
        makeNotification({ id: 'sn', snoozedUntilAt: '2999-01-01T00:00:00Z' }),
        makeNotification({ id: 'kept' }),
      ]);
      store.reconcile([makeNotification({ id: 'kept' })], 50);
      expect(store.pool.has('sn')).toBe(true);
    });
  });

  describe('markAllRead past the first page', () => {
    it('drops the badge to zero even when unread rows sit beyond the pooled page', () => {
      // 7 unread pooled, 29 unread on the server: the 22 unpooled ones are
      // cleared by the same server call, so the badge must not keep them.
      const page = Array.from({ length: 7 }, (_, i) => makeNotification({ id: `n${i}` }));
      store.reconcile(page, 50, 29);
      expect(store.unreadCount).toBe(29);
      store.markAllRead();
      expect(store.unreadCount).toBe(0);
      expect(store.serverUnread).toBe(0);
      expect(store.baselineUnread).toBe(0);
    });

    it('still counts rows that arrive unread afterwards', () => {
      store.reconcile([makeNotification({ id: 'a' })], 50, 5);
      store.markAllRead();
      store.applySyncAction('I', 'new', makeNotification({ id: 'new' }));
      expect(store.unreadCount).toBe(1);
    });
  });

  describe('snooze expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
      // `window` gates the wake-up timer (SSR safety); the jsdom/node env here may lack it.
      vi.stubGlobal('window', globalThis);
    });
    afterEach(() => {
      store.dispose();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('returns a row to the unread count and badge when its snooze elapses, with no other store write', () => {
      store = new NotificationStore();
      // Observe like a component does — an unobserved computed recomputes on every
      // read and would hide a stale-clock bug.
      const stop = autorun(() => {
        void store.unreadCount;
        void store.unread;
        void store.snoozed;
      });
      store.reconcile([makeNotification({ id: 'a' })], 50, 5);
      store.optimisticUpdate('a', { snoozedUntilAt: '2026-06-15T12:10:00Z' });
      expect(store.unreadCount).toBe(4);
      expect(store.unread).toHaveLength(0);
      expect(store.snoozed.map(n => n.id)).toEqual(['a']);

      vi.setSystemTime(new Date('2026-06-15T12:10:01Z'));
      vi.advanceTimersByTime(10 * 60 * 1000 + 100);

      expect(store.unreadCount).toBe(5);
      expect(store.unread.map(n => n.id)).toEqual(['a']);
      expect(store.snoozed).toHaveLength(0);
      stop();
    });
  });
});
