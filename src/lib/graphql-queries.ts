// ---------------------------------------------------------------------------
// Centralized GraphQL query and mutation strings.
// Each string is a plain template literal — no code generation. Import the
// named export and pass it directly to `gql()` from `@/lib/graphql`.
// ---------------------------------------------------------------------------

// ── Auth ─────────────────────────────────────────────────────────────────────

export const EMAIL_LOGIN_MUTATION = `
  mutation EmailLogin($input: EmailLoginInput!) {
    emailLogin(input: $input) {
      success
    }
  }
`;

export const GOOGLE_AUTH_START_QUERY = `
  query GoogleAuthStart {
    googleAuthStart { url state }
  }
`;

export const EMAIL_VERIFY_MUTATION = `
  mutation EmailVerify($input: EmailVerifyInput!) {
    emailVerify(input: $input) {
      success
      accessToken
      refreshToken
      expiresIn
      user {
        id
        displayName
        email
      }
    }
  }
`;

export const ORGANIZATION_CREATE_MUTATION = `
  mutation OrganizationCreate($input: OrganizationCreateInput!) {
    organizationCreate(input: $input) {
      success
      accessToken
      refreshToken
      expiresIn
      organization {
        id
        name
        urlKey
      }
    }
  }
`;

// ── Teams ─────────────────────────────────────────────────────────────────────

export const TEAM_CREATE_MUTATION = `
  mutation TeamCreate($input: TeamCreateInput!) {
    teamCreate(input: $input) {
      success
      lastSyncId
      team {
        id organizationId parentId
        key name displayName description icon color private timezone
        cyclesEnabled issueEstimationType triageEnabled issueCount
        defaultIssueStateId
        createdAt updatedAt archivedAt
        states { id teamId name color type position description createdAt updatedAt archivedAt }
      }
    }
  }
`;

// ── Sidebar / Favorites ──────────────────────────────────────────────────────

export const FAVORITES_QUERY = `
  query SidebarFavorites {
    favorites {
      id
      entityType
      entityId
      sortOrder
      entity {
        ... on Issue { id identifier title teamId }
        ... on Project { id name icon color slugId }
        ... on Initiative { id name color }
        ... on CustomView { id name teamId }
        ... on Cycle { id name teamId }
        ... on Document { id title teamId }
        ... on Team { id name key icon }
      }
    }
  }
`;

export const FAVORITE_DELETE_MUTATION = `
  mutation FavoriteDelete($id: ID!) {
    favoriteDelete(id: $id) {
      success
      lastSyncId
    }
  }
`;

// ── Issues — queries ─────────────────────────────────────────────────────────

export const ISSUE_TEMPLATES_QUERY = `
  query GetIssueTemplates($teamId: ID!) {
    issueTemplates(teamId: $teamId) { id name templateData isDefault }
  }
`;

export const ISSUE_ACTIVITIES_QUERY = `
  query GetIssueActivities($issueId: ID!, $limit: Int) {
    issueActivities(issueId: $issueId, limit: $limit) {
      id
      field
      oldValue
      newValue
      createdAt
      actor {
        id
        displayName
        initials
        avatarBgColor
      }
    }
  }
`;

export const ISSUE_SUBSCRIPTION_QUERY = `
  query NotificationIsSubscribed($issueId: ID!) {
    notificationIsSubscribed(issueId: $issueId)
  }
`;

export const ISSUE_SUBSCRIBE_MUTATION = `
  mutation NotificationSubscribe($issueId: ID!) {
    notificationSubscribe(issueId: $issueId) { success lastSyncId }
  }
`;

export const ISSUE_UNSUBSCRIBE_MUTATION = `
  mutation NotificationUnsubscribe($issueId: ID!) {
    notificationUnsubscribe(issueId: $issueId) { success lastSyncId }
  }
`;

export const CREATE_SUB_ISSUE_MUTATION = `
  mutation CreateSubIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      lastSyncId
      issue { id title identifier priority stateId teamId }
    }
  }
`;

export const PULL_REQUESTS_QUERY = `
  query IssuePullRequests($issueId: ID!) {
    issue(id: $issueId) {
      pullRequests {
        id prNumber title url state draft headBranch repoFullName authorLogin mergedAt closedAt
      }
    }
  }
`;

// ── Issues — shared field set and core mutations ──────────────────────────────

/** Full issue field set used by IssueCreate / IssueUpdate / IssuesBulkUpdate responses. */
const ISSUE_FIELDS = `
  id identifier number title description priority estimate dueDate startDate
  sortOrder prioritySortOrder trashed
  teamId organizationId stateId assigneeId creatorId parentId
  projectId cycleId branchName
  startedAt completedAt canceledAt archivedAt createdAt updatedAt
  labels { id name color }
`;

export const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      lastSyncId
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

export const ISSUE_UPDATE_MUTATION = `
  mutation IssueUpdate($id: ID!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      lastSyncId
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

export const ISSUES_BULK_UPDATE_MUTATION = `
  mutation IssuesBulkUpdate($ids: [ID!]!, $input: IssueUpdateInput!) {
    issuesBulkUpdate(ids: $ids, input: $input) {
      success
      lastSyncId
      issues { ${ISSUE_FIELDS} }
    }
  }
`;

export const ISSUE_ARCHIVE_MUTATION = `
  mutation IssueArchive($id: ID!) {
    issueArchive(id: $id) {
      success
      lastSyncId
    }
  }
`;

// ── Comments ─────────────────────────────────────────────────────────────────

const COMMENTS_FRAGMENT = `
  id issueId body bodyData parentId resolvedAt editedAt createdAt updatedAt
  author { id displayName initials avatarBackgroundColor avatarUrl }
  reactions { id emoji userId user { id displayName } }
  replyCount
  replies {
    id issueId body bodyData parentId resolvedAt editedAt createdAt updatedAt
    author { id displayName initials avatarBackgroundColor avatarUrl }
    reactions { id emoji userId user { id displayName } }
    replyCount
    replies { id }
  }
`;

export const GET_COMMENTS_QUERY = `
  query GetComments($issueId: ID!) {
    comments(issueId: $issueId) { ${COMMENTS_FRAGMENT} }
  }
`;

export const COMMENT_CREATE_MUTATION = `
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success lastSyncId
      comment { ${COMMENTS_FRAGMENT} }
    }
  }
`;

export const COMMENT_UPDATE_MUTATION = `
  mutation CommentUpdate($id: ID!, $input: CommentUpdateInput!) {
    commentUpdate(id: $id, input: $input) {
      success
      comment { ${COMMENTS_FRAGMENT} }
    }
  }
`;

export const COMMENT_DELETE_MUTATION = `
  mutation CommentDelete($id: ID!) {
    commentDelete(id: $id) { success }
  }
`;

export const COMMENT_RESOLVE_MUTATION = `
  mutation CommentResolve($id: ID!) {
    commentResolve(id: $id) {
      success
      comment { id resolvedAt }
    }
  }
`;

export const COMMENT_UNRESOLVE_MUTATION = `
  mutation CommentUnresolve($id: ID!) {
    commentUnresolve(id: $id) {
      success
      comment { id resolvedAt }
    }
  }
`;

export const COMMENT_REACTION_ADD_MUTATION = `
  mutation ReactionAdd($commentId: ID!, $emoji: String!) {
    commentReactionAdd(commentId: $commentId, emoji: $emoji) {
      success
      reaction { id emoji userId user { id displayName } }
    }
  }
`;

export const COMMENT_REACTION_REMOVE_MUTATION = `
  mutation ReactionRemove($commentId: ID!, $emoji: String!) {
    commentReactionRemove(commentId: $commentId, emoji: $emoji) { success }
  }
`;

export const CONVERT_TO_SUB_ISSUE_MUTATION = `
  mutation ConvertCommentToSubIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success lastSyncId
      issue { id title identifier }
    }
  }
`;

// ── Issue Reactions ──────────────────────────────────────────────────────────

export const ISSUE_REACTIONS_QUERY = `
  query IssueReactions($id: ID!) {
    issue(id: $id) {
      id
      reactions { id emoji userId user { id displayName } }
    }
  }
`;

export const ISSUE_REACTION_ADD_MUTATION = `
  mutation IssueReactionAdd($issueId: ID!, $emoji: String!) {
    issueReactionAdd(issueId: $issueId, emoji: $emoji) {
      success
      reaction { id emoji userId user { id displayName } }
    }
  }
`;

export const ISSUE_REACTION_REMOVE_MUTATION = `
  mutation IssueReactionRemove($issueId: ID!, $emoji: String!) {
    issueReactionRemove(issueId: $issueId, emoji: $emoji) { success }
  }
`;

// ── Cycles ────────────────────────────────────────────────────────────────────

export const CYCLE_ROLLOVER_MUTATION = `
  mutation CycleRollover($cycleId: ID!) {
    cycleRollover(cycleId: $cycleId) { success lastSyncId movedCount nextCycleId }
  }
`;

export const CYCLE_BURNDOWN_QUERY = `
  query CycleBurndown($cycleId: ID!) {
    cycleBurndown(cycleId: $cycleId) { date remaining completed scope }
  }
`;

export const CYCLE_SCOPE_METRICS_QUERY = `
  query CycleScopeMetrics($cycleId: ID!) {
    analyticsCycleScopeMetrics(cycleId: $cycleId) {
      totalCount
      plannedCount
      completedCount
      scopeCreepCount
      scopeCreepPct
      carryoverCount
      carryoverPct
    }
  }
`;

export const CYCLE_VELOCITY_QUERY = `
  query CycleVelocity($teamId: ID!, $cycleCount: Int) {
    cycleVelocity(teamId: $teamId, cycleCount: $cycleCount) {
      averageIssues
      cycles { cycleId cycleNumber completedIssues }
    }
  }
`;

// ── Notifications ─────────────────────────────────────────────────────────────

export const GET_NOTIFICATIONS_QUERY = `
  query GetNotifications($limit: Int) {
    notifications(limit: $limit) {
      id
      type
      read
      readAt
      snoozedUntilAt
      data
      createdAt
      userId
      actorId
      issueId
      organizationId
      updatedAt
    }
  }
`;

export const NOTIFICATION_MARK_READ_MUTATION = `
  mutation NotificationMarkRead($id: ID!) {
    notificationMarkRead(id: $id) {
      success
      lastSyncId
    }
  }
`;

export const NOTIFICATION_MARK_ALL_READ_MUTATION = `
  mutation NotificationMarkAllRead {
    notificationMarkAllRead {
      success
      lastSyncId
    }
  }
`;

export const NOTIFICATION_SNOOZE_MUTATION = `
  mutation NotificationSnooze($id: ID!, $until: DateTime!) {
    notificationSnooze(id: $id, until: $until) {
      success lastSyncId
    }
  }
`;

// ── Projects ──────────────────────────────────────────────────────────────────

export const PROJECT_UPDATE_MUTATION = `
  mutation ProjectUpdate($id: ID!, $input: ProjectUpdateInput!) {
    projectUpdate(id: $id, input: $input) {
      success
      lastSyncId
      project {
        id
        startDate
        targetDate
      }
    }
  }
`;

export const PROJECT_PROGRESS_HISTORY_QUERY = `
  query ProjectProgressHistory($id: ID!) {
    project(id: $id) {
      id
      progressHistory {
        date
        issueCount
        completedIssueCount
      }
    }
  }
`;

// ── Initiatives ───────────────────────────────────────────────────────────────

export const INITIATIVE_UPDATES_QUERY = `
  query InitiativeUpdates($id: ID!) {
    initiative(id: $id) {
      id
      updates {
        id
        body
        health
        editedAt
        createdAt
        user { id displayName }
      }
    }
  }
`;

export const INITIATIVE_UPDATE_CREATE_MUTATION = `
  mutation InitiativeUpdateCreate($input: InitiativeUpdateCreateInput!) {
    initiativeUpdateCreate(input: $input) {
      success
      initiativeUpdate {
        id body health editedAt createdAt user { id displayName }
      }
    }
  }
`;

export const INITIATIVE_UPDATE_EDIT_MUTATION = `
  mutation InitiativeUpdateEdit($id: ID!, $input: InitiativeUpdateEditInput!) {
    initiativeUpdateUpdate(id: $id, input: $input) {
      success
      initiativeUpdate {
        id body health editedAt createdAt user { id displayName }
      }
    }
  }
`;
