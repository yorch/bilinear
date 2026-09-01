import { fireEvent, render, screen } from '@testing-library/react';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootStore } from '@/stores/root-store';
import { GlobalCreateIssueModal } from './global-create-issue-modal';

// jsdom does not implement <dialog>'s showModal/close. ModalDialog calls
// showModal() in an effect, so without a stub the render throws before the
// test can assert anything. Set the `open` attribute so jest-dom's
// toBeVisible() treats the dialog content as visible.
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

const { storeHolder } = vi.hoisted(() => ({ storeHolder: {} as { current: RootStore } }));
vi.mock('@/providers/store-provider', () => ({
  useStore: () => storeHolder.current,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/',
}));

vi.mock('@/hooks/use-issue-create', () => ({
  useIssueCreate: () => () => {},
}));

beforeEach(() => {
  storeHolder.current = new RootStore();
  runInAction(() => {
    storeHolder.current.teamStore.pool.clear();
    storeHolder.current.uiStore.closeCreateIssueModal();
    storeHolder.current.uiStore.closeCreateTeamModal();
  });
});

describe('GlobalCreateIssueModal no-teams dialog', () => {
  it('renders no-teams dialog when createIssueModalOpen and no teams exist', () => {
    runInAction(() => {
      storeHolder.current.uiStore.createIssueModalOpen = true;
    });
    render(<GlobalCreateIssueModal />);
    expect(screen.getByText('issueDetail.createModal.noTeamsTitle')).toBeVisible();
    expect(screen.getByText('issueDetail.createModal.noTeamsDescription')).toBeVisible();
    expect(screen.getByText('teams.createTeam')).toBeVisible();
    expect(screen.getByText('common.cancel')).toBeVisible();
  });

  it('Create team button closes issue modal and opens team modal', () => {
    runInAction(() => {
      storeHolder.current.uiStore.createIssueModalOpen = true;
    });
    render(<GlobalCreateIssueModal />);
    fireEvent.click(screen.getByText('teams.createTeam'));
    expect(storeHolder.current.uiStore.createIssueModalOpen).toBe(false);
    expect(storeHolder.current.uiStore.createTeamModalOpen).toBe(true);
  });

  it('Cancel button closes issue modal without opening team modal', () => {
    runInAction(() => {
      storeHolder.current.uiStore.createIssueModalOpen = true;
    });
    render(<GlobalCreateIssueModal />);
    fireEvent.click(screen.getByText('common.cancel'));
    expect(storeHolder.current.uiStore.createIssueModalOpen).toBe(false);
    expect(storeHolder.current.uiStore.createTeamModalOpen).toBe(false);
  });

  it('returns null when modal is closed', () => {
    render(<GlobalCreateIssueModal />);
    expect(screen.queryByText('issueDetail.createModal.noTeamsTitle')).toBeNull();
  });
});
