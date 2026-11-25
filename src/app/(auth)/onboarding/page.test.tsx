import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMember = vi.fn();
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost' }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/page-metadata', () => ({ titleMetadata: async () => ({}) }));
vi.mock('@/components/auth/onboarding-flow', () => ({ OnboardingFlow: () => null }));
vi.mock('@/server/lib/prisma', () => ({
  prisma: { organizationMember: { findFirst: (...a: unknown[]) => findMember(...a) } },
}));
vi.mock('@/server/lib/session-claim', () => ({
  readSessionClaim: async () => ({ orgId: null, userId: 'u1' }),
}));
vi.mock('@/server/services/user.service', () => ({
  UserService: class {
    findById = async () => ({ name: 'Ada' });
    findUsableMembership = async () => null;
  },
}));

import OnboardingPage from './page';

type Props = { resume: unknown };
async function render(search: { org?: string; step?: string }) {
  const el = (await OnboardingPage({ searchParams: Promise.resolve(search) })) as {
    props: Props;
  };
  return el.props.resume;
}

describe('OnboardingPage resume', () => {
  beforeEach(() => {
    findMember.mockReset();
  });

  it('restores a step only for a workspace the viewer owns', async () => {
    findMember.mockResolvedValue({ organization: { name: 'Acme', urlKey: 'acme' } });
    expect(await render({ org: 'acme', step: 'team' })).toEqual({
      name: 'Acme',
      step: 'team',
      urlKey: 'acme',
    });
    expect(findMember).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'owner', userId: 'u1' }),
      }),
    );
  });

  it('ignores a workspace the viewer does not own', async () => {
    findMember.mockResolvedValue(null);
    expect(await render({ org: 'someone-elses', step: 'invite' })).toBeNull();
  });

  it('does not look anything up for a missing or unknown step', async () => {
    expect(await render({ org: 'acme' })).toBeNull();
    expect(await render({ org: 'acme', step: 'workspace' })).toBeNull();
    expect(findMember).not.toHaveBeenCalled();
  });
});
