import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBIssue } from '@/lib/db';
import { IssueStore } from '@/stores/issue-store';
import TriagePage from './page';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({ formatRelativeTime: () => 'now' }),
}));
vi.mock('@/hooks/use-document-title', () => ({ useDocumentTitle: () => {} }));
vi.mock('@/hooks/use-issue-update', () => ({ useIssueUpdate: () => vi.fn() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ key: 'ENG', workspace: 'ws' }),
  usePathname: () => '/ws/team/ENG/triage',
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/issue-nav', () => ({ buildIssueHref: () => '/x' }));
vi.mock('@/lib/issue-mappers', () => ({ toIssueLabels: () => [], toIssueUsers: () => [] }));

const gql = vi.fn();
vi.mock('@/lib/graphql', () => ({
  gql: (...a: unknown[]) => gql(...a),
}));
const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  undo: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({ toast: toastMock }));

// Heavy children are irrelevant to key handling.
vi.mock('@/components/editor/tiptap-editor.lazy', () => ({ TipTapEditor: () => null }));
vi.mock('@/components/properties/assignee-select', () => ({ AssigneeSelect: () => null }));
vi.mock('@/components/properties/label-select', () => ({ LabelSelect: () => null }));
vi.mock('@/components/properties/priority-select', () => ({ PrioritySelect: () => null }));
vi.mock('@/components/properties/priority-icon', () => ({ PriorityIcon: () => null }));
vi.mock('@/components/issues/issue-picker', () => ({ IssuePicker: () => null }));
vi.mock('@/components/issues/triage-snooze-menu', () => ({ TriageSnoozeMenu: () => null }));
vi.mock('@/components/issues/triage-duplicate-suggestions', () => ({
  TriageDuplicateSuggestions: () => null,
}));

const storeHolder = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/providers/store-provider', () => ({ useStore: () => storeHolder.current }));

const TRIAGE = 'st-triage';
const BACKLOG = 'st-backlog';

function issue(n: number, extra: Partial<DBIssue> = {}): DBIssue {
  return {
    createdAt: new Date(2026, 0, n).toISOString(),
    id: `i${n}`,
    identifier: `ENG-${n}`,
    labelIds: [],
    number: n,
    organizationId: 'o',
    priority: 0,
    prioritySortOrder: 0,
    sortOrder: 0,
    stateId: TRIAGE,
    teamId: 't1',
    title: `Issue ${n}`,
    trashed: false,
    updatedAt: '',
    ...extra,
  } as DBIssue;
}

let issueStore: IssueStore;

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    fireEvent.keyDown(document.body, { key, ...init });
  });
}

const focusedRow = () =>
  screen.getAllByTestId('triage-row').find(r => r.getAttribute('aria-current') === 'true');

beforeEach(() => {
  issueStore = new IssueStore();
  issueStore.upsertMany([issue(1), issue(2), issue(3)]);
  storeHolder.current = {
    issueStore,
    labelStore: { all: [] },
    syncStore: { status: 'ready' },
    teamStore: { findByKey: () => ({ displayName: 'Eng', id: 't1', name: 'Eng' }) },
    userStore: { all: [], findById: () => null },
    workflowStateStore: {
      findByTeamId: () => [
        { id: TRIAGE, type: 'triage' },
        { id: BACKLOG, type: 'backlog' },
      ],
    },
  };
  gql.mockReset();
  gql.mockResolvedValue({ data: {} });
  for (const fn of Object.values(toastMock)) {
    fn.mockReset();
  }
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TriagePage keys', () => {
  it('shows the first row as focused and the first J moves off it', () => {
    render(<TriagePage />);
    expect(focusedRow()).toHaveTextContent('ENG-1');
    press('j');
    expect(focusedRow()).toHaveTextContent('ENG-2');
    press('k');
    expect(focusedRow()).toHaveTextContent('ENG-1');
  });

  it('accepts the focused issue with 1 and with A', async () => {
    render(<TriagePage />);
    press('1');
    await waitFor(() => expect(gql).toHaveBeenCalledTimes(1));
    expect(gql.mock.calls[0][1]).toMatchObject({
      input: { stateId: BACKLOG },
      issueId: 'i1',
    });
    await waitFor(() => expect(issueStore.findById('i1')?.stateId).toBe(BACKLOG));
    press('a');
    await waitFor(() => expect(gql).toHaveBeenCalledTimes(2));
    expect(gql.mock.calls[1][1]).toMatchObject({ issueId: 'i2' });
  });

  it('moves focus to the next row (not the top) after a decision', async () => {
    render(<TriagePage />);
    press('j'); // ENG-2
    press('3'); // decline ENG-2
    await waitFor(() => expect(screen.getAllByTestId('triage-row')).toHaveLength(2));
    expect(focusedRow()).toHaveTextContent('ENG-3');
  });

  it('falls back to the previous row when the last row is decided', async () => {
    render(<TriagePage />);
    press('j');
    press('j'); // ENG-3
    press('d');
    await waitFor(() => expect(screen.getAllByTestId('triage-row')).toHaveLength(2));
    expect(focusedRow()).toHaveTextContent('ENG-2');
  });

  it('ignores key auto-repeat so holding a decision key cannot walk the queue', async () => {
    render(<TriagePage />);
    press('1');
    await waitFor(() => expect(gql).toHaveBeenCalledTimes(1));
    // Let the first decision settle so only the repeat guard (not the in-flight
    // busy guard) can stop the repeats.
    await waitFor(() => expect(toastMock.undo).toHaveBeenCalledTimes(1));
    await act(async () => {});
    press('1', { repeat: true });
    press('1', { repeat: true });
    press('3', { repeat: true });
    await act(async () => {});
    expect(gql).toHaveBeenCalledTimes(1);
  });

  it('does nothing while a dialog is open (help / create modal)', async () => {
    render(<TriagePage />);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    press('1');
    press('3');
    press('j');
    await act(async () => {});
    expect(gql).not.toHaveBeenCalled();
    expect(focusedRow()).toHaveTextContent('ENG-1');
  });

  it('does nothing while a popover trigger is expanded', async () => {
    render(<TriagePage />);
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'true');
    document.body.appendChild(trigger);
    press('2');
    press('d');
    await act(async () => {});
    expect(gql).not.toHaveBeenCalled();
  });
});

describe('TriagePage outcomes', () => {
  it('offers Undo after an accept and reverts through issueTriageRevert', async () => {
    render(<TriagePage />);
    press('1');
    await waitFor(() => expect(toastMock.undo).toHaveBeenCalledTimes(1));
    const [message, label, onUndo] = toastMock.undo.mock.calls[0];
    expect(message).toContain('ENG-1');
    expect(label).toBe('settings.triage.undo');
    gql.mockClear();
    await act(async () => {
      onUndo();
    });
    expect(gql.mock.calls[0][0]).toContain('issueTriageRevert');
    expect(gql.mock.calls[0][1]).toEqual({ issueId: 'i1' });
    expect(issueStore.findById('i1')?.stateId).toBe(TRIAGE);
    expect(screen.getAllByTestId('triage-row')).toHaveLength(3);
  });

  it('rolls back an ordinary failure to the pre-action snapshot', async () => {
    gql.mockResolvedValue({
      errors: [{ extensions: { code: 'BAD_USER_INPUT' }, message: 'nope' }],
    });
    render(<TriagePage />);
    press('1');
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(issueStore.findById('i1')?.stateId).toBe(TRIAGE);
    expect(screen.getAllByTestId('triage-row')).toHaveLength(3);
  });

  it('does NOT resurrect an issue someone else already decided (stale error)', async () => {
    gql.mockImplementation(async (query: string) => {
      if (query.includes('TriageIssueState')) {
        return {
          data: {
            issue: {
              canceledAt: '2026-01-01T00:00:00Z',
              id: 'i1',
              snoozedUntilAt: null,
              stateId: 'st-canceled',
              triagedAt: '2026-01-01T00:00:00Z',
            },
          },
        };
      }
      return {
        errors: [
          {
            extensions: { code: 'BAD_USER_INPUT', reason: 'TRIAGE_STALE' },
            message: 'Issue is not in the triage queue',
          },
        ],
      };
    });
    render(<TriagePage />);
    press('1');
    await waitFor(() =>
      expect(toastMock.info).toHaveBeenCalledWith('settings.triage.alreadyHandled'),
    );
    expect(toastMock.error).not.toHaveBeenCalled();
    // Adopted the server's state, not the stale `triage` snapshot.
    expect(issueStore.findById('i1')?.stateId).toBe('st-canceled');
    expect(screen.getAllByTestId('triage-row')).toHaveLength(2);
    // And the next decision still works (the old bug wedged every later action).
    await act(async () => {}); // let the in-flight guard clear
    gql.mockClear();
    gql.mockResolvedValue({ data: {} });
    press('1');
    await waitFor(() => expect(gql).toHaveBeenCalledTimes(1));
    expect(gql.mock.calls[0][1]).toMatchObject({ issueId: 'i2' });
  });
});
