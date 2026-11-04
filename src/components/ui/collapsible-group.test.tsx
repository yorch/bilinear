import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CollapsibleGroup } from './collapsible-group';

describe('CollapsibleGroup', () => {
  it('exposes its state through aria-expanded and toggles the content', () => {
    render(
      <CollapsibleGroup count={2} title="Active">
        <p>row</p>
      </CollapsibleGroup>,
    );
    const toggle = screen.getByRole('button', { name: /Active/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('row')).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('row')).toBeNull();
  });

  it('starts collapsed when asked', () => {
    render(
      <CollapsibleGroup defaultCollapsed title="Done">
        <p>row</p>
      </CollapsibleGroup>,
    );
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('row')).toBeNull();
  });
});
