import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useMobileDrawer } from './use-mobile-drawer';

function Harness({ onClose, open = true }: { onClose: () => void; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useMobileDrawer(open, onClose, ref);
  return (
    <button data-testid="close" ref={ref} type="button">
      x
    </button>
  );
}

describe('useMobileDrawer', () => {
  it('closes on Escape even when a page-level bubble listener cancels it first', () => {
    const onClose = vi.fn();
    // Mirrors useIssueListPage's Escape hotkey: bubble phase, preventDefault.
    const page = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener('keydown', page);
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    window.removeEventListener('keydown', page);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape alone inside an open dialog', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const dlg = document.createElement('dialog');
    document.body.appendChild(dlg);
    fireEvent.keyDown(dlg, { key: 'Escape' });
    dlg.remove();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not steal focus back to the close button when the callback identity changes', () => {
    const { getByTestId, rerender } = render(<Harness onClose={() => {}} />);
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();
    rerender(<Harness onClose={() => {}} />);
    expect(document.activeElement).toBe(other);
    expect(getByTestId('close')).toBeTruthy();
    other.remove();
  });
});
