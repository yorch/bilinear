import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBNotification } from '@/lib/db';
import { RootStore } from '@/stores/root-store';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) =>
    params?.count !== undefined ? `${key}:${params.count}` : key,
}));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({
    formatDateTime: () => 'when',
    formatRelativeTime: () => 'now',
    intlLocale: 'en-US',
  }),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ workspace: 'acme' }) }));

const { storeHolder } = vi.hoisted(() => ({ storeHolder: {} as { current: RootStore } }));
vi.mock('@/providers/store-provider', () => ({ useStore: () => storeHolder.current }));
vi.mock('@/lib/graphql', () => ({ gql: vi.fn(), gqlMutate: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { NotificationInbox } = await import('./notification-inbox');

const ME = 'user-me';
const OTHER_USER = 'user-other';

let seq = 0;
function notification(overrides: Partial<DBNotification>): DBNotification {
  seq += 1;
  return {
    actorId: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, seq)).toISOString(),
    data: {},
    id: `n-${seq}`,
    issueId: null,
    organizationId: 'org',
    read: false,
    snoozedUntilAt: null,
    type: 'ISSUE_COMMENTED',
    updatedAt: '2026-01-01T00:00:00Z',
    userId: ME,
    ...overrides,
  };
}

// Priority lane: assigned (unread), mentioned (read), a reply to me (unread).
// Other lane: two plain comments and a status change on an issue I do not own,
// all unread. Row identity comes from the type label, since the translation
// stub echoes keys.
const MIXED: DBNotification[] = [
  notification({ type: 'ISSUE_ASSIGNED' }),
  notification({ read: true, type: 'ISSUE_MENTIONED' }),
  notification({ data: { replyToUserId: ME }, type: 'ISSUE_COMMENTED' }),
  notification({ type: 'ISSUE_COMMENTED' }),
  notification({ data: { replyToUserId: OTHER_USER }, type: 'ISSUE_COMMENTED' }),
  notification({ issueId: 'not-mine', type: 'ISSUE_STATUS_CHANGED' }),
];

function seed(rows: DBNotification[]) {
  storeHolder.current = new RootStore();
  runInAction(() => {
    storeHolder.current.userStore.setCurrentUserId(ME);
    storeHolder.current.notificationStore.upsertMany(rows);
    storeHolder.current.notificationStore.setLoadState('loaded');
  });
}

const priorityBtn = () => screen.getByRole('tab', { name: /notifications\.lanes\.priority/ });
const otherBtn = () => screen.getByRole('tab', { name: /notifications\.lanes\.other/ });
const count = (lane: 'other' | 'priority') => screen.getByTestId(`lane-count-${lane}`).textContent;

beforeEach(() => {
  window.localStorage.clear();
  seq = 0;
});

describe('NotificationInbox tab semantics', () => {
  it('exposes the filter as a tablist whose panel is labelled by the selected tab', () => {
    seed(MIXED);
    render(<NotificationInbox />);
    const tabs = screen.getByRole('tablist', { name: 'notifications.tabs.label' });
    const all = within(tabs).getByRole('tab', { name: 'notifications.tabs.all' });
    expect(all).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', all.id);

    fireEvent.click(within(tabs).getByRole('tab', { name: 'notifications.tabs.unread' }));
    const unread = within(tabs).getByRole('tab', { name: 'notifications.tabs.unread' });
    expect(unread).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', unread.id);
    // The lane switcher drives the same panel.
    expect(priorityBtn()).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);
  });
});

describe('NotificationInbox lanes', () => {
  it('opens on Priority with per-lane unread counts and only priority rows', () => {
    seed(MIXED);
    render(<NotificationInbox />);

    expect(priorityBtn()).toHaveAttribute('aria-selected', 'true');
    expect(otherBtn()).toHaveAttribute('aria-selected', 'false');
    // Priority: assigned + reply are unread (the mention is read). Other: 3.
    expect(count('priority')).toBe('2');
    expect(count('other')).toBe('3');

    expect(screen.getByText('notifications.labels.issueAssigned')).toBeInTheDocument();
    expect(screen.getByText('notifications.labels.issueMentioned')).toBeInTheDocument();
    // Only the reply to me, not the two other comments.
    expect(screen.getAllByText('notifications.labels.issueCommented')).toHaveLength(1);
    expect(screen.queryByText('notifications.labels.issueStatusChanged')).toBeNull();
  });

  it('switches to Other on click and shows only the subscribed activity', () => {
    seed(MIXED);
    render(<NotificationInbox />);

    fireEvent.click(otherBtn());

    expect(otherBtn()).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('notifications.labels.issueAssigned')).toBeNull();
    expect(screen.queryByText('notifications.labels.issueMentioned')).toBeNull();
    expect(screen.getAllByText('notifications.labels.issueCommented')).toHaveLength(2);
    expect(screen.getByText('notifications.labels.issueStatusChanged')).toBeInTheDocument();
    // Counts are per lane and do not depend on which lane is showing.
    expect(count('priority')).toBe('2');
    expect(count('other')).toBe('3');
  });

  it('moves between lanes with ArrowRight / ArrowLeft, wrapping at both ends', async () => {
    seed(MIXED);
    render(<NotificationInbox />);
    const group = screen.getByRole('tablist', { name: 'notifications.lanes.label' });

    fireEvent.keyDown(priorityBtn(), { key: 'ArrowRight' });
    expect(otherBtn()).toHaveAttribute('aria-selected', 'true');
    // Focus follows the selected segment.
    await waitFor(() => expect(otherBtn()).toHaveFocus());

    fireEvent.keyDown(otherBtn(), { key: 'ArrowRight' });
    expect(priorityBtn()).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(priorityBtn(), { key: 'ArrowLeft' });
    expect(otherBtn()).toHaveAttribute('aria-selected', 'true');

    // Unrelated keys leave the lane alone.
    fireEvent.keyDown(otherBtn(), { key: 'ArrowDown' });
    expect(otherBtn()).toHaveAttribute('aria-selected', 'true');
    expect(within(group).getAllByRole('tab')).toHaveLength(2);
  });

  it('shows a lane-specific empty state for an empty lane only', () => {
    seed([notification({ type: 'ISSUE_ASSIGNED' })]);
    render(<NotificationInbox />);

    // Priority has the row, so no empty state.
    expect(screen.queryByTestId('empty-state')).toBeNull();

    fireEvent.click(otherBtn());
    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      'notifications.emptyState.otherTitle',
    );
    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      'notifications.emptyState.otherDetail',
    );
    expect(screen.queryByText('notifications.emptyState.priorityTitle')).toBeNull();
  });

  it('shows the Priority empty state when only subscribed activity exists', () => {
    seed([notification({ type: 'ISSUE_COMMENTED' })]);
    render(<NotificationInbox />);

    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      'notifications.emptyState.priorityTitle',
    );
    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      'notifications.emptyState.priorityDetail',
    );
    expect(count('priority')).toBe('0');
    expect(count('other')).toBe('1');
  });

  it('remembers the last lane across mounts', () => {
    seed(MIXED);
    const first = render(<NotificationInbox />);
    fireEvent.click(otherBtn());
    expect(window.localStorage.getItem('inbox.lane')).toBe('other');
    first.unmount();

    render(<NotificationInbox />);
    expect(otherBtn()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('notifications.labels.issueStatusChanged')).toBeInTheDocument();
  });

  it('ignores a junk stored lane and opens on Priority', () => {
    window.localStorage.setItem('inbox.lane', 'nonsense');
    seed(MIXED);
    render(<NotificationInbox />);
    expect(priorityBtn()).toHaveAttribute('aria-selected', 'true');
  });

  it('reclassifies live when a new reply to the viewer arrives', () => {
    seed([notification({ type: 'ISSUE_COMMENTED' })]);
    render(<NotificationInbox />);
    expect(count('priority')).toBe('0');

    act(() => {
      storeHolder.current.notificationStore.upsertMany([
        notification({ data: { replyToUserId: ME }, type: 'ISSUE_COMMENTED' }),
      ]);
    });
    expect(count('priority')).toBe('1');
    expect(count('other')).toBe('1');
  });
});
