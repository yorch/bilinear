import { action, makeObservable, observable } from 'mobx';

export class UIStore {
  sidebarCollapsed = false;
  activeTeamId: string | null = null;
  selectedIssueId: string | null = null;
  detailIssueId: string | null = null;
  createIssueModalOpen = false;
  commandPaletteOpen = false;

  constructor() {
    makeObservable(this, {
      activeTeamId: observable,
      closeCommandPalette: action,
      closeCreateIssueModal: action,
      commandPaletteOpen: observable,
      createIssueModalOpen: observable,
      detailIssueId: observable,
      openCommandPalette: action,
      openCreateIssueModal: action,
      selectedIssueId: observable,
      setActiveTeamId: action,
      setDetailIssueId: action,
      setSelectedIssueId: action,
      setSidebarCollapsed: action,
      sidebarCollapsed: observable,
      toggleCommandPalette: action,
    });
  }

  setSidebarCollapsed(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
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
