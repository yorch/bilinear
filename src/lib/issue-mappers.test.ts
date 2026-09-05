import { describe, expect, it } from 'vitest';
import type { DBIssueLabel } from './db';
import { resolveIssueLabels, toIssueDetail, toIssueSyncRow } from './issue-mappers';

/** The minimum a row must carry to be accepted — every required `DBIssue` column. */
const VALID: Record<string, unknown> = {
  createdAt: '2026-01-01T00:00:00.000Z',
  id: 'iss_1',
  identifier: 'ENG-1',
  number: 1,
  organizationId: 'org_1',
  priority: 2,
  prioritySortOrder: 100,
  sortOrder: 50,
  stateId: 'st_1',
  teamId: 'team_1',
  title: 'Fix the thing',
  trashed: false,
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('toIssueSyncRow', () => {
  it('accepts a row carrying every required column', () => {
    expect(toIssueSyncRow(VALID)).toEqual(VALID);
  });

  it.each([
    'createdAt',
    'id',
    'identifier',
    'number',
    'organizationId',
    'priority',
    'prioritySortOrder',
    'sortOrder',
    'stateId',
    'teamId',
    'title',
    'trashed',
    'updatedAt',
  ])('rejects a row missing %s', key => {
    const { [key]: _omitted, ...rest } = VALID;
    expect(toIssueSyncRow(rest)).toBeNull();
  });

  it('rejects a required column of the wrong primitive type', () => {
    expect(toIssueSyncRow({ ...VALID, number: '1' })).toBeNull();
    expect(toIssueSyncRow({ ...VALID, trashed: 'false' })).toBeNull();
    expect(toIssueSyncRow({ ...VALID, title: 42 })).toBeNull();
  });

  it('carries optional string columns through, null included', () => {
    const row = toIssueSyncRow({ ...VALID, assigneeId: 'usr_1', dueDate: null });
    expect(row).toMatchObject({ assigneeId: 'usr_1', dueDate: null });
  });

  it('omits an optional column that was absent rather than nulling it', () => {
    const row = toIssueSyncRow(VALID);
    expect(row).not.toBeNull();
    expect('assigneeId' in (row ?? {})).toBe(false);
  });

  it('rejects a present-but-wrong-typed optional column instead of dropping it', () => {
    // Dropping would reach the store as `undefined` and clear the column.
    expect(toIssueSyncRow({ ...VALID, assigneeId: 7 })).toBeNull();
    expect(toIssueSyncRow({ ...VALID, estimate: 'three' })).toBeNull();
  });

  it('accepts estimate as a number or null', () => {
    expect(toIssueSyncRow({ ...VALID, estimate: 3 })).toMatchObject({ estimate: 3 });
    expect(toIssueSyncRow({ ...VALID, estimate: null })).toMatchObject({ estimate: null });
  });

  it('accepts each of the three label shapes', () => {
    expect(
      toIssueSyncRow({ ...VALID, labels: [{ color: 'x', id: 'lbl_1', name: 'bug' }] }),
    ).toMatchObject({ labels: [{ id: 'lbl_1' }] });
    expect(toIssueSyncRow({ ...VALID, labelAssignments: [{ labelId: 'lbl_2' }] })).toMatchObject({
      labelAssignments: [{ labelId: 'lbl_2' }],
    });
    expect(toIssueSyncRow({ ...VALID, labelIds: ['lbl_3'] })).toMatchObject({
      labelIds: ['lbl_3'],
    });
  });

  it('narrows labels to ids so no extra label fields reach the issue row', () => {
    const row = toIssueSyncRow({ ...VALID, labels: [{ color: 'x', id: 'lbl_1', name: 'bug' }] });
    expect(row?.labels?.[0]).toEqual({ id: 'lbl_1' });
  });

  it('rejects a malformed label list', () => {
    expect(toIssueSyncRow({ ...VALID, labels: [{ name: 'no id' }] })).toBeNull();
    expect(toIssueSyncRow({ ...VALID, labels: 'bug' })).toBeNull();
    expect(toIssueSyncRow({ ...VALID, labelAssignments: [{ id: 'wrong key' }] })).toBeNull();
    expect(toIssueSyncRow({ ...VALID, labelIds: [1, 2] })).toBeNull();
  });

  it('ignores keys it does not know about', () => {
    const row = toIssueSyncRow({ ...VALID, __typename: 'Issue', somethingNew: 'ignored' });
    expect(row).toEqual(VALID);
  });
});

const LABELS: Record<string, DBIssueLabel> = {
  lbl_bug: { color: 'var(--label-red)', id: 'lbl_bug', name: 'Bug' } as DBIssueLabel,
  lbl_ux: { color: 'var(--label-green)', id: 'lbl_ux', name: 'UX' } as DBIssueLabel,
};
const labelStore = { findById: (id: string) => LABELS[id] ?? null };

describe('resolveIssueLabels', () => {
  it('maps each known id to its { color, id, name } view model, in order', () => {
    expect(resolveIssueLabels(['lbl_ux', 'lbl_bug'], labelStore)).toEqual([
      { color: 'var(--label-green)', id: 'lbl_ux', name: 'UX' },
      { color: 'var(--label-red)', id: 'lbl_bug', name: 'Bug' },
    ]);
  });

  it('drops an id the pool no longer holds instead of rendering a blank chip', () => {
    expect(resolveIssueLabels(['lbl_bug', 'lbl_gone'], labelStore)).toEqual([
      { color: 'var(--label-red)', id: 'lbl_bug', name: 'Bug' },
    ]);
  });

  it('treats a missing or null id list as no labels', () => {
    expect(resolveIssueLabels(undefined, labelStore)).toEqual([]);
    expect(resolveIssueLabels(null, labelStore)).toEqual([]);
  });
});

describe('toIssueDetail', () => {
  it('resolves labels and keeps every other column of the row', () => {
    const detail = toIssueDetail({ ...VALID, labelIds: ['lbl_bug'] }, labelStore);
    expect(detail).toMatchObject({
      ...VALID,
      labels: [{ color: 'var(--label-red)', id: 'lbl_bug', name: 'Bug' }],
    });
  });

  it('normalises an absent dueDate to null and preserves a present one', () => {
    expect(toIssueDetail(VALID, labelStore).dueDate).toBeNull();
    expect(toIssueDetail({ ...VALID, dueDate: '2026-03-01' }, labelStore).dueDate).toBe(
      '2026-03-01',
    );
  });
});
