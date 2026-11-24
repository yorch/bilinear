import { beforeEach, describe, expect, it } from 'vitest';
import type { DBIssueReminder } from '@/lib/db';
import {
  IssueReminderStore,
  isReminderPending,
  OPTIMISTIC_REMINDER_PREFIX,
} from './issue-reminder-store';
import { runPoolStoreTests } from './test-helpers/pool-store-tests';

function makeReminder(overrides: Partial<DBIssueReminder> & { id: string }): DBIssueReminder {
  return {
    createdAt: '2026-03-01T00:00:00Z',
    issueId: `issue-for-${overrides.id}`,
    organizationId: 'org-1',
    remindAt: '2026-12-01T09:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    userId: 'user-1',
    ...overrides,
  };
}

describe('IssueReminderStore', () => {
  let store: IssueReminderStore;
  beforeEach(() => {
    store = new IssueReminderStore();
  });

  runPoolStoreTests<DBIssueReminder>({
    makeRow: makeReminder,
    makeStore: () => new IssueReminderStore(),
    updateField: 'remindAt',
    updateValue: '2027-01-01T09:00:00Z',
  });

  it('keeps one reminder per issue: a row for the same issue under a new id replaces the old', () => {
    store.applySyncAction('I', 'r1', makeReminder({ id: 'r1', issueId: 'i1' }));
    store.applySyncAction('I', 'r2', makeReminder({ id: 'r2', issueId: 'i1' }));
    expect(store.all.map(r => r.id)).toEqual(['r2']);
    expect(store.forIssue('i1')?.id).toBe('r2');
  });

  it('a sync D removes the row by id, and a late D for a replaced id leaves the new row alone', () => {
    store.applySyncAction('I', 'r1', makeReminder({ id: 'r1', issueId: 'i1' }));
    store.applySyncAction('D', 'r1', makeReminder({ id: 'r1', issueId: 'i1' }));
    expect(store.forIssue('i1')).toBeNull();

    store.applySyncAction('I', 'r2', makeReminder({ id: 'r2', issueId: 'i1' }));
    store.applySyncAction('D', 'r1', makeReminder({ id: 'r1', issueId: 'i1' }));
    expect(store.forIssue('i1')?.id).toBe('r2');
  });

  it('an optimistic row is replaced by the confirmed server row for the same issue', () => {
    const prev = store.setOptimistic('i1', '2026-12-01T09:00:00Z', {
      organizationId: 'org-1',
      userId: 'user-1',
    });
    expect(prev).toBeNull();
    expect(store.forIssue('i1')?.id).toBe(`${OPTIMISTIC_REMINDER_PREFIX}i1`);

    store.applySyncAction('U', 'r9', makeReminder({ id: 'r9', issueId: 'i1' }));
    expect(store.pool.size).toBe(1);
    expect(store.forIssue('i1')?.id).toBe('r9');
  });

  it('moving an existing reminder optimistically keeps its id and returns the old row', () => {
    store.upsertMany([makeReminder({ id: 'r1', issueId: 'i1' })]);
    const prev = store.setOptimistic('i1', '2027-02-02T09:00:00Z', {
      organizationId: 'org-1',
      userId: 'user-1',
    });
    expect(prev?.remindAt).toBe('2026-12-01T09:00:00Z');
    expect(store.forIssue('i1')).toMatchObject({ id: 'r1', remindAt: '2027-02-02T09:00:00Z' });
  });

  it('clearForIssue removes locally and returns the removed row', () => {
    store.upsertMany([makeReminder({ id: 'r1', issueId: 'i1' })]);
    expect(store.clearForIssue('i1')?.id).toBe('r1');
    expect(store.clearForIssue('i1')).toBeNull();
    expect(store.pool.size).toBe(0);
  });

  it('replaceAll is an authoritative load: rows the server omitted disappear', () => {
    store.upsertMany([makeReminder({ id: 'old', issueId: 'i0' })]);
    store.replaceAll([makeReminder({ id: 'r1', issueId: 'i1' })]);
    expect(store.all.map(r => r.id)).toEqual(['r1']);
  });

  it('isReminderPending is false once the time has passed', () => {
    const r = makeReminder({ id: 'r', remindAt: '2026-12-01T09:00:00Z' });
    expect(isReminderPending(r, Date.parse('2026-12-01T08:59:59Z'))).toBe(true);
    expect(isReminderPending(r, Date.parse('2026-12-01T09:00:00Z'))).toBe(false);
    expect(isReminderPending(r, Date.parse('2026-12-02T00:00:00Z'))).toBe(false);
  });
});
