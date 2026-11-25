import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DBCustomFieldDefinition } from '@/lib/db';
import { CustomFieldValueInput } from './custom-field-value-input';

vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/hooks/use-formatters', () => ({ useFormatters: () => ({ intlLocale: 'en-US' }) }));

const numberDef = (options: unknown): DBCustomFieldDefinition =>
  ({ id: 'n1', name: 'Budget', options, type: 'number' }) as unknown as DBCustomFieldDefinition;

describe('CustomFieldValueInput number display', () => {
  it('shows the formatted value at rest and the raw number while editing', () => {
    render(
      <CustomFieldValueInput
        definition={numberDef({ numberFormat: { currency: 'USD', decimals: 2, kind: 'currency' } })}
        onSave={() => {}}
        value={1234.5}
      />,
    );
    const input = screen.getByLabelText('Budget') as HTMLInputElement;
    expect(input.value).toBe('$1,234.50');

    fireEvent.focus(input);
    expect((screen.getByLabelText('Budget') as HTMLInputElement).value).toBe('1234.5');
  });

  it('keeps the raw number for a field with no format', () => {
    render(<CustomFieldValueInput definition={numberDef(null)} onSave={() => {}} value={1234.5} />);
    expect((screen.getByLabelText('Budget') as HTMLInputElement).value).toBe('1234.5');
  });
});
