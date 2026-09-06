import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModalDialog } from './modal-dialog';

// jsdom does not implement <dialog>'s showModal/close; without a stub the
// render throws. The stub deliberately does *not* move focus, so the
// `data-autofocus` assertions below exercise ModalDialog's own focus step.
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

describe('ModalDialog', () => {
  it('focuses the element marked data-autofocus on open', () => {
    render(
      <ModalDialog aria-label="Create" onClose={() => {}} open>
        <button type="button">Reset</button>
        <input aria-label="Name" data-autofocus />
      </ModalDialog>,
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('leaves focus alone when nothing opts in', () => {
    render(
      <ModalDialog aria-label="Create" onClose={() => {}} open>
        <button type="button">Reset</button>
        <input aria-label="Name" />
      </ModalDialog>,
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveFocus();
  });

  it('routes Escape through the native cancel event to onClose', () => {
    const onClose = vi.fn();
    render(
      <ModalDialog aria-label="Create" onClose={onClose} open>
        <p>body</p>
      </ModalDialog>,
    );
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    render(
      <ModalDialog aria-label="Create" onClose={() => {}} open={false}>
        <p>body</p>
      </ModalDialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
