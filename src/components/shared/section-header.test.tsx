import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SectionAddButton, SectionHeader } from './section-header';

describe('SectionHeader', () => {
  it('renders the title as an h3 by default', () => {
    render(<SectionHeader title="Updates" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Updates' })).toBeInTheDocument();
  });

  // Consolidating the markup must not flatten the document outline: the
  // initiative section nests under a project heading and renders an h4.
  it('honours the requested heading level', () => {
    render(<SectionHeader as="h4" title="Updates" />);
    expect(screen.getByRole('heading', { level: 4, name: 'Updates' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  it('accepts a node title so a count can be inlined', () => {
    render(
      <SectionHeader
        title={
          <>
            Relations <span>(3)</span>
          </>
        }
      />,
    );
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Relations (3)');
  });

  // Sub-issues shows "0" deliberately — "no sub-issues" is information. An
  // `if (count)` guard would silently drop it, which is why the check is
  // against undefined.
  it('renders a zero count but omits an absent one', () => {
    const { unmount } = render(<SectionHeader count={0} title="Sub-issues" />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Sub-issues 0');
    unmount();

    render(<SectionHeader title="Sub-issues" />);
    expect(screen.getByRole('heading', { level: 3 }).textContent?.trim()).toBe('Sub-issues');
  });

  it('renders a disclosure button only when onToggle is supplied', () => {
    const onToggle = vi.fn();
    const { unmount } = render(
      <SectionHeader collapsed={false} onToggle={onToggle} title="Relations" />,
    );
    const toggle = screen.getByRole('button', { name: 'Relations' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
    unmount();

    // Sections that cannot collapse must not advertise a control that does
    // nothing, so the heading stays plain text.
    render(<SectionHeader title="Relations" />);
    expect(screen.queryByRole('button', { name: 'Relations' })).not.toBeInTheDocument();
  });

  it('reports the collapsed state to assistive tech', () => {
    render(<SectionHeader collapsed onToggle={() => {}} title="Relations" />);
    expect(screen.getByRole('button', { name: 'Relations' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('renders the meta slot alongside the action', () => {
    render(
      <SectionHeader
        action={<button type="button">Add</button>}
        meta={<span>2/3</span>}
        title="Sub-issues"
      />,
    );
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('renders the action slot', () => {
    render(<SectionHeader action={<button type="button">Add</button>} title="Relations" />);
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  // Every call site gates its action on local state, passing `false` when the
  // create form is already open.
  it('renders no action when the slot is falsy', () => {
    render(<SectionHeader action={false} title="Relations" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('SectionAddButton', () => {
  it('renders its label and fires onClick', () => {
    const onClick = vi.fn();
    render(<SectionAddButton label="Add sub-issue" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-issue' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  // It sits inside <form>-bearing sections; a bare <button> would submit them.
  it('is not a submit button', () => {
    render(<SectionAddButton label="Add" onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('type', 'button');
  });
});
