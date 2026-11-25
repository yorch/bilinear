import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';
import { SsoEntry } from './sso-entry';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

const assign = vi.fn();
const providers = { github: false, google: false };

beforeEach(() => {
  search.value = '';
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function openAndSubmit(key: string) {
  fireEvent.click(screen.getByRole('button', { name: 'auth.sso.button' }));
  fireEvent.change(screen.getByLabelText('auth.workspaceUrl'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: 'auth.sso.continue' }));
}

describe('SsoEntry inside the sign-in form', () => {
  it('is not nested in the email form', () => {
    render(<LoginForm providers={providers} />);
    fireEvent.click(screen.getByRole('button', { name: 'auth.sso.button' }));
    const ssoForm = screen.getByLabelText('auth.workspaceUrl').closest('form');
    expect(ssoForm).not.toBeNull();
    expect(ssoForm?.parentElement?.closest('form')).toBeNull();
  });

  it('probes the route and navigates when the IdP redirect is ready', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ type: 'opaqueredirect' });
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginForm providers={providers} />);
    openAndSubmit('demo');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/auth/saml/initiate?org=demo'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/saml/initiate?org=demo&probe=1', {
      redirect: 'manual',
    });
  });

  it('shows the one generic message when the probe is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, type: 'basic' }));
    render(<SsoEntry busy={false} next={null} />);
    openAndSubmit('nope');
    expect(await screen.findByText('auth.sso.unavailable')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows the generic message after a plain-navigation fallback to /login', () => {
    search.value = 'sso=unavailable';
    render(<LoginForm providers={providers} />);
    expect(screen.getByText('auth.sso.unavailable')).toBeTruthy();
  });
});
