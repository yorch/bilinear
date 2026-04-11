import { beforeEach, describe, expect, it } from 'vitest';
import type { DBCycle } from '@/lib/db';
import { CycleStore } from './cycle-store';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEAM_A = '00000000-0000-0000-0000-000000000100';
const TEAM_B = '00000000-0000-0000-0000-000000000101';

function makeCycle(overrides: Partial<DBCycle> & { id: string }): DBCycle {
  return {
    archivedAt: null,
    completedAt: null,
    createdAt: '2026-03-01T00:00:00Z',
    description: null,
    endsAt: '2026-03-15T00:00:00Z',
    name: 'Sprint 1',
    number: 1,
    organizationId: '00000000-0000-0000-0000-000000000001',
    progress: 0,
    scope: 0,
    startsAt: '2026-03-01T00:00:00Z',
    teamId: TEAM_A,
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CycleStore', () => {
  let store: CycleStore;

  beforeEach(() => {
    store = new CycleStore();
  });

  // ─── pool ───────────────────────────────────────────────────────────────────

  it('starts with empty pool', () => {
    expect(store.pool.size).toBe(0);
  });

  // ─── upsertMany ─────────────────────────────────────────────────────────────

  describe('upsertMany', () => {
    it('adds cycles', () => {
      const c1 = makeCycle({ id: 'c1' });
      const c2 = makeCycle({ id: 'c2', teamId: TEAM_B });

      store.upsertMany([c1, c2]);

      expect(store.pool.size).toBe(2);
      expect(store.pool.get('c1')).toEqual(c1);
      expect(store.pool.get('c2')).toEqual(c2);
    });
  });

  // ─── all ────────────────────────────────────────────────────────────────────

  describe('all', () => {
    it('filters out archived', () => {
      store.upsertMany([
        makeCycle({ id: 'c1' }),
        makeCycle({ archivedAt: '2026-03-10T00:00:00Z', id: 'c2' }),
      ]);

      expect(store.all).toHaveLength(1);
      expect(store.all[0].id).toBe('c1');
    });

    it('sorts by startsAt desc', () => {
      store.upsertMany([
        makeCycle({ id: 'c1', startsAt: '2026-01-01T00:00:00Z' }),
        makeCycle({ id: 'c3', startsAt: '2026-03-01T00:00:00Z' }),
        makeCycle({ id: 'c2', startsAt: '2026-02-01T00:00:00Z' }),
      ]);

      const ids = store.all.map(c => c.id);
      expect(ids).toEqual(['c3', 'c2', 'c1']);
    });
  });

  // ─── findById ───────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns cycle or null', () => {
      store.upsertMany([makeCycle({ id: 'c1' })]);

      expect(store.findById('c1')).not.toBeNull();
      expect(store.findById('c1')?.id).toBe('c1');
      expect(store.findById('nonexistent')).toBeNull();
    });
  });

  // ─── findByTeamId ──────────────────────────────────────────────────────────

  describe('findByTeamId', () => {
    it('filters by team', () => {
      store.upsertMany([
        makeCycle({ id: 'c1', teamId: TEAM_A }),
        makeCycle({ id: 'c2', teamId: TEAM_B }),
        makeCycle({ id: 'c3', teamId: TEAM_A }),
      ]);

      const result = store.findByTeamId(TEAM_A);
      expect(result).toHaveLength(2);
      expect(result.every(c => c.teamId === TEAM_A)).toBe(true);
    });
  });

  // ─── getActiveCycle ────────────────────────────────────────────────────────

  describe('getActiveCycle', () => {
    it('returns current cycle', () => {
      const now = new Date();
      const pastStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const futureEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      store.upsertMany([
        makeCycle({
          endsAt: futureEnd.toISOString(),
          id: 'active',
          startsAt: pastStart.toISOString(),
        }),
      ]);

      const result = store.getActiveCycle(TEAM_A);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('active');
    });
  });

  // ─── getUpcomingCycles ─────────────────────────────────────────────────────

  describe('getUpcomingCycles', () => {
    it('returns future cycles', () => {
      const now = new Date();
      const futureStart = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const futureEnd = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);
      const pastStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const pastEnd = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

      store.upsertMany([
        makeCycle({
          endsAt: futureEnd.toISOString(),
          id: 'upcoming',
          startsAt: futureStart.toISOString(),
        }),
        makeCycle({
          endsAt: pastEnd.toISOString(),
          id: 'past',
          startsAt: pastStart.toISOString(),
        }),
      ]);

      const result = store.getUpcomingCycles(TEAM_A);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('upcoming');
    });
  });

  // ─── getCompletedCycles ────────────────────────────────────────────────────

  describe('getCompletedCycles', () => {
    it('returns past cycles', () => {
      const now = new Date();
      const pastStart = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
      const pastEnd = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const futureStart = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const futureEnd = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);

      store.upsertMany([
        makeCycle({
          endsAt: pastEnd.toISOString(),
          id: 'completed',
          startsAt: pastStart.toISOString(),
        }),
        makeCycle({
          endsAt: futureEnd.toISOString(),
          id: 'upcoming',
          startsAt: futureStart.toISOString(),
        }),
      ]);

      const result = store.getCompletedCycles(TEAM_A);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('completed');
    });
  });

  // ─── applySyncAction ──────────────────────────────────────────────────────

  describe('applySyncAction', () => {
    it('Insert adds cycle', () => {
      const c = makeCycle({ id: 'c1' });
      store.applySyncAction('I', 'c1', c);

      expect(store.pool.get('c1')).toEqual(c);
    });

    it('Update updates cycle', () => {
      store.upsertMany([makeCycle({ id: 'c1', name: 'Sprint 1' })]);
      store.applySyncAction(
        'U',
        'c1',
        makeCycle({ id: 'c1', name: 'Sprint 1 Updated' }),
      );

      expect(store.pool.get('c1')?.name).toBe('Sprint 1 Updated');
    });

    it('Delete removes cycle', () => {
      store.upsertMany([makeCycle({ id: 'c1' })]);
      store.applySyncAction('D', 'c1', null);

      expect(store.pool.has('c1')).toBe(false);
    });
  });

  // ─── optimisticUpdate ──────────────────────────────────────────────────────

  describe('optimisticUpdate', () => {
    it('patches existing cycle', () => {
      store.upsertMany([makeCycle({ id: 'c1', name: 'Sprint 1' })]);

      store.optimisticUpdate('c1', { name: 'Sprint 1 Patched' });

      expect(store.pool.get('c1')?.name).toBe('Sprint 1 Patched');
    });

    it('does nothing for non-existent cycle', () => {
      store.optimisticUpdate('nonexistent', { name: 'Nope' });

      expect(store.pool.size).toBe(0);
    });
  });
});
