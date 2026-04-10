import { CustomViewStore } from './custom-view-store';
import { CycleStore } from './cycle-store';
import { IssueStore } from './issue-store';
import { LabelStore } from './label-store';
import { ProjectStore } from './project-store';
import { SyncStore } from './sync-store';
import { TeamStore } from './team-store';
import { UIStore } from './ui-store';
import { UserStore } from './user-store';
import { WorkflowStateStore } from './workflow-state-store';

export class RootStore {
  customViewStore: CustomViewStore;
  cycleStore: CycleStore;
  issueStore: IssueStore;
  labelStore: LabelStore;
  projectStore: ProjectStore;
  syncStore: SyncStore;
  teamStore: TeamStore;
  uiStore: UIStore;
  userStore: UserStore;
  workflowStateStore: WorkflowStateStore;

  constructor() {
    this.syncStore = new SyncStore();
    this.userStore = new UserStore();
    this.teamStore = new TeamStore();
    this.workflowStateStore = new WorkflowStateStore();
    this.customViewStore = new CustomViewStore();
    this.cycleStore = new CycleStore();
    this.issueStore = new IssueStore();
    this.labelStore = new LabelStore();
    this.projectStore = new ProjectStore();
    this.uiStore = new UIStore();
  }
}

// Singleton for the client — created once on first import in browser context
let _rootStore: RootStore | null = null;

export function getRootStore(): RootStore {
  if (!_rootStore) {
    _rootStore = new RootStore();
  }
  return _rootStore;
}
