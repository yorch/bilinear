import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
const store = vi.hoisted(() => ({ currentUser: null as unknown }));
vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({ userStore: { currentUser: store.currentUser, upsertMany: vi.fn() } }),
}));
const { gqlMutate } = vi.hoisted(() => ({ gqlMutate: vi.fn() }));
vi.mock('@/lib/graphql', () => ({ gqlMutate }));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ProfileCard } from './profile-card';

const USER = {
  avatarBgColor: '#336699',
  avatarUrl: null,
  displayName: 'Ada',
  email: 'ada@example.com',
  initials: 'A',
  name: 'Ada',
};

describe('ProfileCard', () => {
  beforeEach(() => {
    gqlMutate.mockReset();
    store.currentUser = USER;
  });

  it('shows a labelled loading region while the store has no user', () => {
    store.currentUser = null;
    render(<ProfileCard />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByLabelText('settings.profile.name')).toBeNull();
  });

  it('uploads the avatar with purpose=avatar and saves the returned URL', async () => {
    const url = 'http://localhost:3000/api/uploads/avatar-x.png';
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ url }), ok: true });
    vi.stubGlobal('fetch', fetchMock);
    gqlMutate.mockResolvedValue({ userUpdateProfile: { user: { ...USER, avatarUrl: url } } });
    const { container } = render(<ProfileCard />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(gqlMutate).toHaveBeenCalled());
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('purpose')).toBe('avatar');
    expect(gqlMutate.mock.calls[0][1]).toEqual({ input: { avatarUrl: url } });
    vi.unstubAllGlobals();
  });
});
