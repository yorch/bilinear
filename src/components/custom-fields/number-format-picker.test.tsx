import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/hooks/use-formatters', () => ({ useFormatters: () => ({ intlLocale: 'en-US' }) }));

const { NumberFormatPicker } = await import('./number-format-picker');

describe('NumberFormatPicker', () => {
  it('previews the chosen format', () => {
    render(
      <NumberFormatPicker onChange={() => {}} value={{ currency: 'EUR', kind: 'currency' }} />,
    );
    expect(screen.getByTestId('number-format-preview')).toHaveTextContent('€1,234.50');
  });

  it('flags a well-formed but unassigned code (QQQ), which Intl alone would accept', () => {
    render(
      <NumberFormatPicker onChange={() => {}} value={{ currency: 'QQQ', kind: 'currency' }} />,
    );
    expect(screen.getByText('customFields.numberFormat.invalidCurrency')).toBeInTheDocument();
  });

  it('does not flag a real code', () => {
    render(
      <NumberFormatPicker onChange={() => {}} value={{ currency: 'MXN', kind: 'currency' }} />,
    );
    expect(screen.queryByText('customFields.numberFormat.invalidCurrency')).toBeNull();
  });

  it('flags an unknown currency code and degrades the preview', () => {
    render(<NumberFormatPicker onChange={() => {}} value={{ currency: 'ZZ', kind: 'currency' }} />);
    expect(screen.getByText('customFields.numberFormat.invalidCurrency')).toBeInTheDocument();
    expect(screen.getByTestId('number-format-preview')).toHaveTextContent('1,234.5 ZZ');
  });

  it('reports a typed currency code upper-cased', () => {
    const onChange = vi.fn();
    render(<NumberFormatPicker onChange={onChange} value={{ kind: 'currency' }} />);
    fireEvent.change(screen.getByLabelText('customFields.numberFormat.currency'), {
      target: { value: 'usd' },
    });
    expect(onChange).toHaveBeenCalledWith({ currency: 'USD', kind: 'currency' });
  });
  it('offers the currency input only for the currency kind', () => {
    const { rerender } = render(
      <NumberFormatPicker onChange={() => {}} value={{ kind: 'percent' }} />,
    );
    expect(screen.queryByLabelText('customFields.numberFormat.currency')).toBeNull();
    rerender(<NumberFormatPicker onChange={() => {}} value={{ kind: 'currency' }} />);
    expect(screen.getByLabelText('customFields.numberFormat.currency')).toBeInTheDocument();
  });

  it('hides decimals for duration and previews minutes as h/m', () => {
    render(<NumberFormatPicker onChange={() => {}} value={{ kind: 'duration' }} />);
    expect(screen.queryByLabelText('customFields.numberFormat.decimals')).toBeNull();
    expect(screen.getByTestId('number-format-preview')).toHaveTextContent('1h 30m');
  });

  it('reports a kind change through the select, keeping the other fields', () => {
    const onChange = vi.fn();
    render(<NumberFormatPicker onChange={onChange} value={{ decimals: 1, kind: 'plain' }} />);
    fireEvent.click(screen.getByLabelText('customFields.numberFormat.title'));
    fireEvent.click(screen.getByText('customFields.numberFormat.kinds.percent'));
    expect(onChange).toHaveBeenCalledWith({ decimals: 1, kind: 'percent' });
  });
});
