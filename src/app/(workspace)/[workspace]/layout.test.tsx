import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
);
const state = vi.hoisted(() => ({ path: '/old/team/ENG?x=1' }));
const findOrg = vi.fn();
const findRetired = vi.fn();
const findMembership = vi.fn();

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-bilinear-path': state.path }),
}));
vi.mock('@/components/layouts/workspace-mismatch', () => ({ WorkspaceMismatch: () => null }));
vi.mock('@/server/lib/prisma', () => ({
  prisma: { organization: { findUnique: (...a: unknown[]) => findOrg(...a) } },
}));
vi.mock('@/server/lib/session-claim', () => ({
  readSessionClaim: async () => ({ orgId: 'org-1', userId: 'u1' }),
}));
vi.mock('@/server/services/organization.service', () => ({
  OrganizationService: class {
    findByRetiredUrlKey = (...a: unknown[]) => findRetired(...a);
  },
}));
vi.mock('@/server/services/user.service', () => ({
  UserService: class {
    findUsableMembership = (...a: unknown[]) => findMembership(...a);
  },
}));

import WorkspaceGuardLayout from './layout';

const run = () =>
  WorkspaceGuardLayout({ children: null, params: Promise.resolve({ workspace: 'old' }) });

describe('WorkspaceGuardLayout renamed workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOrg.mockResolvedValue(null);
    findRetired.mockResolvedValue({ id: 'org-1', urlKey: 'new' });
    findMembership.mockResolvedValue({ organization: { id: 'org-1', name: 'X' } });
  });

  it('redirects an old link to the same page under the new key', async () => {
    await expect(run()).rejects.toThrow('REDIRECT:/new/team/ENG?x=1');
  });

  it('does not reveal a rename to a non-member', async () => {
    findMembership.mockResolvedValue(null);
    await expect(run()).rejects.toThrow('REDIRECT:/');
  });

  it('sends an unknown key home', async () => {
    findRetired.mockResolvedValue(null);
    await expect(run()).rejects.toThrow('REDIRECT:/');
  });
});
