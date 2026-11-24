import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/auth/onboarding-form', () => ({
  OnboardingForm: ({ onCreated }: { onCreated: (o: { name: string; urlKey: string }) => void }) => (
    <button onClick={() => onCreated({ name: 'Acme', urlKey: 'acme' })} type="button">
      create-workspace
    </button>
  ),
}));

import { OnboardingFlow } from './onboarding-flow';

const base = { backTo: null, defaultName: '', host: 'localhost' };

describe('OnboardingFlow resume', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/onboarding');
  });

  it('writes the step and workspace into the URL as the flow advances', () => {
    render(<OnboardingFlow {...base} />);
    fireEvent.click(screen.getByText('create-workspace'));
    expect(window.location.search).toBe('?org=acme&step=team');
    fireEvent.click(screen.getByRole('button', { name: 'auth.setup.skip' }));
    expect(window.location.search).toBe('?org=acme&step=invite');
  });

  it('restores step 2 after a reload instead of the create-workspace form', () => {
    render(<OnboardingFlow {...base} resume={{ name: 'Acme', step: 'team', urlKey: 'acme' }} />);
    expect(screen.queryByText('create-workspace')).toBeNull();
    expect(screen.getByLabelText('auth.setup.teamName')).toBeTruthy();
  });

  it('restores step 3', () => {
    render(<OnboardingFlow {...base} resume={{ name: 'Acme', step: 'invite', urlKey: 'acme' }} />);
    expect(screen.getByLabelText('auth.setup.inviteLabel')).toBeTruthy();
  });
});
