import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}));

// jsdom does not implement <dialog>'s showModal/close.
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

function setup(props: { requireText?: string } = {}) {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      confirmLabel="Archive"
      message="Archive it?"
      onCancel={() => {}}
      onConfirm={onConfirm}
      open
      title="Archive"
      {...props}
    />,
  );
  return { button: screen.getByRole('button', { name: 'Archive' }), onConfirm };
}

describe('ConfirmDialog requireText', () => {
  it('confirms immediately when no text is required', () => {
    const { button, onConfirm } = setup();
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps confirm disabled until the exact text is typed', () => {
    const { button, onConfirm } = setup({ requireText: 'acme' });
    expect(button).toBeDisabled();
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'acm' } });
    expect(button).toBeDisabled();
    fireEvent.change(field, { target: { value: 'acme' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
