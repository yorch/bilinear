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
});
