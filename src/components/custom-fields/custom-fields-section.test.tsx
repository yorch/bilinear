import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBCustomFieldDefinition } from '@/lib/db';
import { RootStore } from '@/stores/root-store';
import { CustomFieldsSection, readStoredOptions } from './custom-fields-section';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) =>
    params?.name ? `${key}:${params.name}` : key,
}));

const { storeHolder, gqlMutate, toast } = vi.hoisted(() => ({
  gqlMutate: vi.fn(),
  storeHolder: {} as { current: RootStore },
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/providers/store-provider', () => ({ useStore: () => storeHolder.current }));
vi.mock('@/lib/graphql', () => ({ gqlMutate }));
vi.mock('@/lib/toast', () => ({ toast }));

const SEVERITY: DBCustomFieldDefinition = {
  createdAt: '2026-01-01T00:00:00Z',
  description: 'How bad is it',
  id: 'sev',
  name: 'Severity',
  options: [
    { label: 'High', value: 'high' },
    { label: 'Low', value: 'low' },
  ],
  organizationId: 'org',
  required: false,
  sortOrder: 1,
  teamId: 'team-1',
  type: 'select',
  updatedAt: '2026-01-01T00:00:00Z',
} as DBCustomFieldDefinition;

beforeEach(() => {
  gqlMutate.mockReset();
  toast.success.mockReset();
  storeHolder.current = new RootStore();
  runInAction(() => {
    storeHolder.current.customFieldStore.upsertDefinitions([SEVERITY]);
  });
});

describe('readStoredOptions', () => {
  it('normalises a JSON blob and drops entries without a value', () => {
    expect(
      readStoredOptions([{ label: 'A', value: 'a' }, { value: 'b' }, { label: 'x' }, 3]),
    ).toEqual([
      { color: undefined, label: 'A', value: 'a' },
      { color: undefined, label: 'b', value: 'b' },
    ]);
    expect(readStoredOptions(null)).toEqual([]);
  });
});

describe('CustomFieldsSection edit', () => {
  it('prefills the form from the definition and sends an update without the type', async () => {
    gqlMutate.mockResolvedValueOnce({
      customFieldDefinitionUpdate: { customFieldDefinition: { ...SEVERITY, name: 'Impact' } },
    });
    render(<CustomFieldsSection teamId="team-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'customFields.editAria:Severity' }));
    const nameInput = screen.getByLabelText('customFields.name') as HTMLInputElement;
    expect(nameInput.value).toBe('Severity');
    expect(screen.getByDisplayValue('High')).toBeInTheDocument();
    expect(screen.getByDisplayValue('low')).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: 'Impact' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => expect(gqlMutate).toHaveBeenCalledTimes(1));
    const [, variables] = gqlMutate.mock.calls[0] as [
      string,
      { id: string; input: Record<string, unknown> },
    ];
    expect(variables.id).toBe('sev');
    expect(variables.input).toEqual({
      description: 'How bad is it',
      name: 'Impact',
      options: [
        { color: undefined, label: 'High', value: 'high' },
        { color: undefined, label: 'Low', value: 'low' },
      ],
      required: false,
    });
    expect(variables.input).not.toHaveProperty('type');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('customFields.updateSuccess'));
    // The form closes back to the row on success.
    expect(screen.queryByRole('button', { name: 'common.save' })).not.toBeInTheDocument();
  });

  it('keeps the form open when the update is rejected', async () => {
    gqlMutate.mockRejectedValueOnce(new Error('nope'));
    render(<CustomFieldsSection teamId="team-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'customFields.editAria:Severity' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'common.save' })).toBeInTheDocument();
  });
});
