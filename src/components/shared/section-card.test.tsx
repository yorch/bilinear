import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionCard } from './section-card';

describe('SectionCard', () => {
  it('renders the title as an h3 by default and the body under it', () => {
    render(
      <SectionCard title="Lead time">
        <span>chart</span>
      </SectionCard>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Lead time' })).toBeInTheDocument();
    expect(screen.getByText('chart')).toBeInTheDocument();
  });

  // The analytics grid nests four cards under an h2 section title; a settings
  // page uses them as top-level h2 sections. The frame must not fix the level.
  it('honours the requested heading level', () => {
    render(
      <SectionCard as="h2" title="Organization">
        <span />
      </SectionCard>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Organization' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  it('renders the description only when given', () => {
    const { rerender } = render(
      <SectionCard description="Created → completed" title="Lead time">
        <span />
      </SectionCard>,
    );
    expect(screen.getByText('Created → completed')).toBeInTheDocument();
    rerender(
      <SectionCard title="Lead time">
        <span />
      </SectionCard>,
    );
    expect(screen.queryByText('Created → completed')).not.toBeInTheDocument();
  });
});
