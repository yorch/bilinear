import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TabSwitcher, tabPanelProps } from './tab-switcher';

afterEach(cleanup);

function Harness({ initial = 'a' }: { initial?: 'a' | 'b' | 'c' }) {
  const [v, setV] = useState<'a' | 'b' | 'c'>(initial);
  return (
    <>
      <TabSwitcher
        ariaLabel="View"
        idPrefix="t"
        onChange={setV}
        options={[
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
          { label: 'C', value: 'c' },
        ]}
        value={v}
      />
      <div {...tabPanelProps('t', v)}>panel {v}</div>
    </>
  );
}

describe('TabSwitcher', () => {
  it('exposes tablist/tab/tabpanel semantics tied together', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'View' })).toBeTruthy();
    const a = screen.getByRole('tab', { name: 'A' });
    const b = screen.getByRole('tab', { name: 'B' });
    expect(a.getAttribute('aria-selected')).toBe('true');
    expect(b.getAttribute('aria-selected')).toBe('false');
    expect(a.hasAttribute('aria-pressed')).toBe(false);
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(a.id);
    expect(a.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('keeps only the selected tab in the Tab order (roving tabindex)', () => {
    render(<Harness initial="b" />);
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('tabindex')).toBe('0');
  });

  it('moves selection and focus with Arrow/Home/End, wrapping at the ends', () => {
    render(<Harness />);
    const press = (key: string) =>
      fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key });
    press('ArrowRight');
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'B' }));
    press('End');
    expect(screen.getByRole('tab', { name: 'C' }).getAttribute('aria-selected')).toBe('true');
    press('ArrowRight');
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true');
    press('ArrowLeft');
    expect(screen.getByRole('tab', { name: 'C' }).getAttribute('aria-selected')).toBe('true');
    press('Home');
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('panel a');
  });

  it('ignores unrelated keys', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'x' });
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true');
  });
});
