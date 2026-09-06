import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutHelpModal } from './shortcut-help-modal';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

describe('ShortcutHelpModal', () => {
  it('renders inside a native <dialog> so the focus trap is real', () => {
    render(<ShortcutHelpModal onClose={() => {}} open />);
    const dialog = screen.getByRole('dialog', { name: 'layout.shortcutHelp.title' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
  });

  // Every listed key must have a live handler. Shift+P, Q and Backspace were
  // advertised for months with nothing bound to them; `useIssueListPage` binds
  // all three now, so they are listed again. The pairing is what this pins:
  // an entry here without a `useHotkeys` for it is the regression to catch.
  it('advertises exactly the list-page shortcuts that have a handler', () => {
    render(<ShortcutHelpModal onClose={() => {}} open />);
    for (const key of ['setProject', 'setCycle', 'archiveIssue', 'setEstimate']) {
      expect(screen.getByText(`layout.shortcutHelp.${key}`)).toBeInTheDocument();
    }
    expect(screen.getByText('⌫')).toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    render(<ShortcutHelpModal onClose={() => {}} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
