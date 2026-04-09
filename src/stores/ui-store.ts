import { action, makeObservable, observable } from 'mobx';

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
}

export class UIStore {
  sidebarCollapsed = readSidebarCollapsed();
  activeTeamId: string | null = null;
  selectedIssueId: string | null = null;
  detailIssueId: string | null = null;
  createIssueModalOpen = false;
  createTeamModalOpen = false;
  createProjectModalOpen = false;
  commandPaletteOpen = false;

  constructor() {
    makeObservable(this, {
      activeTeamId: observable,
      closeCommandPalette: action,
      closeCreateIssueModal: action,
      closeCreateProjectModal: action,
      closeCreateTeamModal: action,
      commandPaletteOpen: observable,
      createIssueModalOpen: observable,
      createProjectModalOpen: observable,
      createTeamModalOpen: observable,
      detailIssueId: observable,
      openCommandPalette: action,
      openCreateIssueModal: action,
      openCreateProjectModal: action,
      openCreateTeamModal: action,
      selectedIssueId: observable,
      setActiveTeamId: action,
      setDetailIssueId: action,
      setSelectedIssueId: action,
      setSidebarCollapsed: action,
      sidebarCollapsed: observable,
      toggleCommandPalette: action,
      toggleSidebarCollapsed: action,
    });
  }

  setSidebarCollapsed(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
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
}
