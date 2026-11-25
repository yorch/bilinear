import { action, makeObservable, observable } from 'mobx';

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export class UIStore {
  // Always starts expanded so the first client render matches the server HTML;
  // the stored preference is applied after hydration by `restoreSidebarCollapsed`.
  // Reading localStorage here made the sidebar render differently from the SSR
  // markup (React error #418) for anyone who had collapsed it.
  sidebarCollapsed = false;
  activeTeamId: string | null = null;
  selectedIssueId: string | null = null;
  detailIssueId: string | null = null;
  createIssueModalOpen = false;
  createTeamModalOpen = false;
  createProjectModalOpen = false;
  commandPaletteOpen = false;
  shortcutHelpOpen = false;

  constructor() {
    makeObservable(this, {
      activeTeamId: observable,
      closeCommandPalette: action,
      closeCreateIssueModal: action,
      closeCreateProjectModal: action,
      closeCreateTeamModal: action,
      closeShortcutHelp: action,
      commandPaletteOpen: observable,
      createIssueModalOpen: observable,
      createProjectModalOpen: observable,
      createTeamModalOpen: observable,
      detailIssueId: observable,
      openCommandPalette: action,
      openCreateIssueModal: action,
      openCreateProjectModal: action,
      openCreateTeamModal: action,
      openShortcutHelp: action,
      restoreSidebarCollapsed: action,
      selectedIssueId: observable,
      setActiveTeamId: action,
      setDetailIssueId: action,
      setSelectedIssueId: action,
      setSidebarCollapsed: action,
      shortcutHelpOpen: observable,
      sidebarCollapsed: observable,
      toggleCommandPalette: action,
      toggleShortcutHelp: action,
      toggleSidebarCollapsed: action,
    });
  }

  /** Apply the persisted sidebar preference. Call from an effect, never during render. */
  restoreSidebarCollapsed() {
    this.sidebarCollapsed = readSidebarCollapsed();
  }

  setSidebarCollapsed(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Storage blocked: the preference just lasts for this session.
    }
  }

  toggleSidebarCollapsed() {
    this.setSidebarCollapsed(!this.sidebarCollapsed);
  }

  setActiveTeamId(id: string | null) {
    this.activeTeamId = id;
  }

  setSelectedIssueId(id: string | null) {
    this.selectedIssueId = id;
  }

  setDetailIssueId(id: string | null) {
    this.detailIssueId = id;
  }

  openCreateIssueModal() {
    this.createIssueModalOpen = true;
  }

  closeCreateIssueModal() {
    this.createIssueModalOpen = false;
  }

  openCreateProjectModal() {
    this.createProjectModalOpen = true;
  }

  closeCreateProjectModal() {
    this.createProjectModalOpen = false;
  }

  openCreateTeamModal() {
    this.createTeamModalOpen = true;
  }

  closeCreateTeamModal() {
    this.createTeamModalOpen = false;
  }

  openCommandPalette() {
    this.commandPaletteOpen = true;
  }

  closeCommandPalette() {
    this.commandPaletteOpen = false;
  }

  toggleCommandPalette() {
    this.commandPaletteOpen = !this.commandPaletteOpen;
  }

  openShortcutHelp() {
    this.shortcutHelpOpen = true;
  }

  closeShortcutHelp() {
    this.shortcutHelpOpen = false;
  }

  toggleShortcutHelp() {
    this.shortcutHelpOpen = !this.shortcutHelpOpen;
  }
}
