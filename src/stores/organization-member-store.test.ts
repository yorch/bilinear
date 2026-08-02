import { describe, expect, it } from 'vitest';
import type { DBOrganizationMember } from '@/lib/db';
import { OrganizationMemberStore } from './organization-member-store';

function member(over: Partial<DBOrganizationMember> = {}): DBOrganizationMember {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 'mem-1',
    organizationId: 'org-1',
    role: 'member',
    updatedAt: '2026-01-01T00:00:00.000Z',
    userId: 'user-1',
    ...over,
  };
}

describe('OrganizationMemberStore', () => {
  it('exposes a userId -> role map', () => {
    const store = new OrganizationMemberStore();
    store.upsertMany([
      member({ id: 'm1', role: 'owner', userId: 'u1' }),
      member({ id: 'm2', role: 'guest', userId: 'u2' }),
    ]);

    expect(store.rolesByUserId).toEqual({ u1: 'owner', u2: 'guest' });
  });

  it('counts by role, which is what the last-owner guard reads', () => {
    const store = new OrganizationMemberStore();
    store.upsertMany([
      member({ id: 'm1', role: 'owner', userId: 'u1' }),
      member({ id: 'm2', role: 'owner', userId: 'u2' }),
      member({ id: 'm3', role: 'admin', userId: 'u3' }),
    ]);

    expect(store.countByRole('owner')).toBe(2);
    expect(store.countByRole('admin')).toBe(1);
    expect(store.countByRole('guest')).toBe(0);
  });

  it('applies a role change', () => {
    const store = new OrganizationMemberStore();
    store.upsertMany([member({ id: 'm1', role: 'member', userId: 'u1' })]);

    store.applySyncAction('U', 'm1', member({ id: 'm1', role: 'admin', userId: 'u1' }));

    expect(store.rolesByUserId).toEqual({ u1: 'admin' });
  });

  // The reason the store exists: `'D'` used to have no handler anywhere, so a
  // second admin's open tab kept listing someone who had been removed.
  it('drops the member on a delete action', () => {
    const store = new OrganizationMemberStore();
    store.upsertMany([member({ id: 'm1', userId: 'u1' }), member({ id: 'm2', userId: 'u2' })]);

    store.applySyncAction('D', 'm1', null);

    expect(store.rolesByUserId).toEqual({ u2: 'member' });
    expect(store.findByUserId('u1')).toBeNull();
  });

  // There is no `archivedAt` on organization_members, so unlike the entity
  // stores 'A' cannot mean "soft delete" — it is just an upsert.
  it('treats an archive action as an upsert, not a removal', () => {
    const store = new OrganizationMemberStore();
    store.upsertMany([member({ id: 'm1', userId: 'u1' })]);

    store.applySyncAction('A', 'm1', member({ id: 'm1', role: 'guest', userId: 'u1' }));

    expect(store.rolesByUserId).toEqual({ u1: 'guest' });
  });

  it('ignores an update with no payload rather than blanking the row', () => {
    const store = new OrganizationMemberStore();
    store.upsertMany([member({ id: 'm1', role: 'owner', userId: 'u1' })]);

    store.applySyncAction('U', 'm1', null);

    expect(store.rolesByUserId).toEqual({ u1: 'owner' });
  });
});
