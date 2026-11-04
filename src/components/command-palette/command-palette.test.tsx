import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './command-palette';

const issues = [
  { id: 'i1', identifier: 'ENG-1', priority: 0, stateId: 's1', teamId: 't1', title: 'Fix login' },
  { id: 'i2', identifier: 'ENG-2', priority: 0, stateId: 's1', teamId: 't1', title: 'Other' },
];

const stores = {
  customViewStore: { all: [] },
  documentStore: { all: [] },
  issueStore: {
    findById: (id: string) => issues.find(i => i.id === id) ?? null,
    findByIdentifier: () => null,
    search: (q: string) => (q ? issues.filter(i => i.title.toLowerCase().includes(q)) : []),
  },
  labelStore: { all: [] },
  projectStore: { all: [] },
  teamStore: { all: [], findById: () => ({ key: 'ENG' }) },
  uiStore: {
    closeCommandPalette: vi.fn(),
    commandPaletteOpen: true,
  },
  userStore: { all: [] },
  workflowStateStore: { findById: () => ({ color: 'c' }), findByTeamId: () => [] },
};

vi.mock('@/providers/store-provider', () => ({ useStore: () => stores }));
vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ setTheme: vi.fn() }) }));
vi.mock('@/providers/accent-provider', () => ({ useAccent: () => ({ setAccent: vi.fn() }) }));
vi.mock('@/hooks/use-issue-update', () => ({ useIssueUpdate: () => vi.fn() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspace: 'demo' }),
  usePathname: () => '/demo',
  useRouter: () => ({ push: vi.fn() }),
}));

Element.prototype.scrollIntoView = vi.fn();

function input() {
  return screen.getByRole('combobox') as HTMLInputElement;
}

describe('CommandPalette', () => {
  it('aria-activedescendant follows the rendered options, not the previous render', () => {
    render(<CommandPalette />);
    fireEvent.change(input(), { target: { value: 'login' } });
    const id = input().getAttribute('aria-activedescendant');
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)).not.toBeNull();
    // A query with no results: the input must stop pointing at an option.
    fireEvent.change(input(), { target: { value: 'zzzz-no-match' } });
    expect(input().getAttribute('aria-activedescendant')).toBeNull();
  });

  it('restores the search after backing out of an issue sub-menu', () => {
    render(<CommandPalette />);
    fireEvent.change(input(), { target: { value: 'login' } });
    act(() => {
      input().setSelectionRange(5, 5);
      fireEvent.keyDown(window, { key: 'Tab' });
    });
    expect(input().value).toBe('');
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(input().value).toBe('login');
  });

  it('groups sections with role=group instead of loose presentation labels', () => {
    render(<CommandPalette />);
    fireEvent.change(input(), { target: { value: 'login' } });
    const group = screen.getAllByRole('group')[0];
    expect(group.getAttribute('aria-labelledby')).toBeTruthy();
  });
});
