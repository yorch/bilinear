import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoleSelect } from './role-select';

const OPTIONS = [
  { label: 'Owner', value: 'owner' },
  { label: 'Admin', value: 'admin' },
  { label: 'Member', value: 'member' },
];

describe('RoleSelect', () => {
  it('paints the pill with the tone for the current role', () => {
    const { container, rerender } = render(
      <RoleSelect ariaLabel="Role" onChange={() => {}} options={OPTIONS} value="owner" />,
    );
    expect(container.firstElementChild).toHaveClass('bg-brand-subtle');
    rerender(<RoleSelect ariaLabel="Role" onChange={() => {}} options={OPTIONS} value="member" />);
    expect(container.firstElementChild).toHaveClass('bg-muted');
    expect(container.firstElementChild).not.toHaveClass('bg-brand-subtle');
  });

  it('shows the current label and reports a pick', () => {
    const onChange = vi.fn();
    render(<RoleSelect ariaLabel="Role" onChange={onChange} options={OPTIONS} value="admin" />);
    const trigger = screen.getByRole('button', { name: 'Role' });
    expect(trigger).toHaveTextContent('Admin');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Member' }));
    expect(onChange).toHaveBeenCalledWith('member');
  });

  it('renders read-only when disabled', () => {
    render(
      <RoleSelect ariaLabel="Role" disabled onChange={() => {}} options={OPTIONS} value="admin" />,
    );
    expect(screen.getByRole('button', { name: 'Role' })).toBeDisabled();
  });
});
