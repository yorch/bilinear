import { CustomFieldStore } from './custom-field-store';
import { CustomViewStore } from './custom-view-store';
import { CycleStore } from './cycle-store';
import { DocumentStore } from './document-store';
import { FavoriteStore } from './favorite-store';
import { InitiativeStore } from './initiative-store';
import { IssueRelationStore } from './issue-relation-store';
import { IssueStore } from './issue-store';
import { IssueTemplateStore } from './issue-template-store';
import { LabelStore } from './label-store';
import { NotificationStore } from './notification-store';
import { OrganizationMemberStore } from './organization-member-store';
import { ProjectStore } from './project-store';
import { SyncStore } from './sync-store';
import { TeamStore } from './team-store';
import { UIStore } from './ui-store';
import { UserStore } from './user-store';
import { WorkflowStateStore } from './workflow-state-store';

export class RootStore {
  customFieldStore: CustomFieldStore;
  customViewStore: CustomViewStore;
  cycleStore: CycleStore;
  documentStore: DocumentStore;
  favoriteStore: FavoriteStore;
  initiativeStore: InitiativeStore;
  issueRelationStore: IssueRelationStore;
  issueStore: IssueStore;
  issueTemplateStore: IssueTemplateStore;
  labelStore: LabelStore;
  notificationStore: NotificationStore;
  projectStore: ProjectStore;
  syncStore: SyncStore;
  organizationMemberStore: OrganizationMemberStore;
  teamStore: TeamStore;
  uiStore: UIStore;
  userStore: UserStore;
  workflowStateStore: WorkflowStateStore;

  constructor() {
    this.syncStore = new SyncStore();
    this.userStore = new UserStore();
    this.organizationMemberStore = new OrganizationMemberStore();
    this.teamStore = new TeamStore();
    this.workflowStateStore = new WorkflowStateStore();
    this.customFieldStore = new CustomFieldStore();
    this.customViewStore = new CustomViewStore();
    this.cycleStore = new CycleStore();
    this.documentStore = new DocumentStore();
    this.favoriteStore = new FavoriteStore();
    this.initiativeStore = new InitiativeStore();
    this.issueRelationStore = new IssueRelationStore();
    this.issueStore = new IssueStore();
    this.issueTemplateStore = new IssueTemplateStore();
    this.labelStore = new LabelStore();
    this.notificationStore = new NotificationStore();
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
