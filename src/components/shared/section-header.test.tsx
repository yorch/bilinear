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
