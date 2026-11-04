import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateProjectModal } from './create-project-modal';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({
    teamStore: { all: [{ icon: null, id: 't1', name: 'Eng' }] },
    userStore: { all: [] },
  }),
}));
const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: { success: toastSuccess } }));

HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

describe('CreateProjectModal', () => {
  it('blocks submit and explains when the target precedes the start', () => {
    render(<CreateProjectModal onClose={() => {}} onSubmit={vi.fn()} open />);
    fireEvent.change(screen.getByLabelText(/projects.name/), { target: { value: 'P' } });
    fireEvent.change(screen.getByLabelText(/projects.startDate/), {
      target: { value: '2026-12-01' },
    });
    fireEvent.change(screen.getByLabelText(/projects.targetDate/), {
      target: { value: '2026-11-01' },
    });
    expect(screen.getByText('projects.invalidRange')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'projects.createProject' })).toBeDisabled();
  });

  it('toasts exactly once on success and marks team chips as toggles', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CreateProjectModal onClose={() => {}} onSubmit={onSubmit} open />);
    fireEvent.change(screen.getByLabelText(/projects.name/), { target: { value: 'P' } });
    const chip = screen.getByRole('button', { name: 'Eng' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'projects.createProject' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].teamIds).toEqual(['t1']);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });
});
