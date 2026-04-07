import { action, makeObservable, observable } from 'mobx';

export class UIStore {
  sidebarCollapsed = false;
  activeTeamId: string | null = null;
  selectedIssueId: string | null = null;
  detailIssueId: string | null = null;
  createIssueModalOpen = false;

  constructor() {
    makeObservable(this, {
      activeTeamId: observable,
      closeCreateIssueModal: action,
      createIssueModalOpen: observable,
      detailIssueId: observable,
      openCreateIssueModal: action,
      selectedIssueId: observable,
      setActiveTeamId: action,
      setDetailIssueId: action,
      setSelectedIssueId: action,
      setSidebarCollapsed: action,
      sidebarCollapsed: observable,
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
}
