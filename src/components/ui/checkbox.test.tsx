import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';

function Wrapped() {
  const [on, setOn] = useState(false);
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox below is the control
    <label>
      <Checkbox aria-label="x" checked={on} onChange={e => setOn(e.target.checked)} />
      text
    </label>
  );
}

describe('Checkbox', () => {
  it('keeps the box 16px at every width (no touch class on the input itself)', () => {
    render(<Checkbox aria-label="x" onChange={() => {}} />);
    const input = screen.getByRole('checkbox');
    expect(input.className).toContain('h-4 w-4');
    expect(input.className).not.toContain('h-11');
    expect(input.className).not.toContain('min-w-11');
  });

  it('renders no extended hit label (it overlapped neighbours and nested labels)', () => {
    const { container } = render(
      // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox below is the control
      <label>
        <Checkbox aria-label="x" onChange={() => {}} />
      </label>,
    );
    expect(container.querySelectorAll('label label')).toHaveLength(0);
    expect(container.querySelector('[class*="absolute"]')).toBeNull();
    expect(container.querySelector('[class*="-inset-"]')).toBeNull();
  });

  it('adjacent rows are separate labels, each toggling only its own box', () => {
    render(
      <div>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wrapped control */}
        <label>
          <Checkbox aria-label="a" defaultChecked={false} />a
        </label>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wrapped control */}
        <label>
          <Checkbox aria-label="b" defaultChecked={false} />b
        </label>
      </div>,
    );
    fireEvent.click(screen.getByText('a'));
    expect((screen.getByLabelText('a') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('b') as HTMLInputElement).checked).toBe(false);
  });

  it('toggles once when the wrapping label text is clicked', () => {
    render(<Wrapped />);
    fireEvent.click(screen.getByText('text'));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });
});
