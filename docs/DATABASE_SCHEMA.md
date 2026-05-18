# Database Schema Design

## Issue Tracker — Linear Rebuild

**Version:** 1.5
**Date:** 2026-05-17
**Database:** PostgreSQL 18
**Source of truth:** `prisma/schema.prisma` — this document describes both the
implemented schema and design targets for unbuilt features. Read the Prisma
schema when the two disagree.

---

## 1. Design Principles

- **UUIDs** as primary keys (client-generated for offline-first)
- **Soft delete** via `archived_at` and `trashed` columns
- **Audit trail** via `created_at`, `updated_at` timestamps on every table
- **Monotonic sync IDs** for delta sync (`sync_id BIGSERIAL`)
- **JSONB** for extensible metadata where appropriate
- **GIN indexes** for array and full-text search columns
- **Row-level security** via organization/team scoping

---

## 1.1 Schema Implementation Status

Every subsection of §2 carries one of these tags. When a tag is missing assume
✅. The goal is to distinguish what actually exists in Prisma today from what
remains a design target.

| Tag | Meaning                                                                                        |
| --- | ---------------------------------------------------------------------------------------------- |
| ✅   | Shipped — exists in `prisma/schema.prisma` and matches this doc                                |
| ⚠️   | Partial drift — model exists in Prisma but column set differs; this doc has been aligned below |
| 📋   | Future — table described here but **not** in Prisma yet                                        |

| Section                   | Status | Notes                                                                                                 |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| 2.1 Organizations & Users | ✅      |                                                                                                       |
| 2.2 Teams                 | ✅      | Covers `teams`, `team_memberships`, and the paired `team_member_roles` (also cross-linked from §2.26) |
| 2.3 Workflow States       | ✅      |                                                                                                       |
| 2.4 Issues                | ✅      |                                                                                                       |
| 2.5 Labels                | ✅      |                                                                                                       |
| 2.6 Comments              | ✅      |                                                                                                       |
| 2.7 Issue Relations       | ✅      |                                                                                                       |
| 2.8 Issue Activity        | ⚠️      | Real model is simpler than Linear-style history                                                       |
| 2.9 Projects              | ✅      |                                                                                                       |
| 2.10 Project Milestones   | ✅      |                                                                                                       |
| 2.11 Project Updates      | ✅      |                                                                                                       |
| 2.12 Cycles               | ⚠️      | `organization_id` was missing from doc                                                                |
| 2.13 Initiatives          | ✅      | Shipped 2026-05-05 — `initiatives` + `initiative_projects` join                                       |
| 2.14 Attachments          | 📋      | Superseded by §2.25 Files                                                                             |
| 2.15 Comment Reactions    | ✅      |                                                                                                       |
| 2.16 Notifications        | ⚠️      | Doc listed polymorphic FKs that were never added                                                      |
| 2.17 Custom Views         | ⚠️      | Real columns use `filters/sort/layout`, not `filter_data/sort_by/columns`                             |
| 2.18 Favorites            | 📋      |                                                                                                       |
| 2.19 Documents            | ✅      | Parent hierarchy, editor output in `content` TEXT; no YJS yet                                         |
| 2.20 Issue Templates      | ⚠️      | Real model is issue-only (not polymorphic)                                                            |
| 2.21 Webhooks             | ✅      | Shipped 2026-05-05 — `webhooks` + `webhook_deliveries`                                                |
| 2.22 Sync Actions         | ✅      |                                                                                                       |
| 2.23 Auth Tokens          | ✅      |                                                                                                       |
| 2.24 Audit Log            | 📋      |                                                                                                       |
| 2.25 Files                | ✅      |                                                                                                       |
| 2.26 Team Member Roles    | ✅      |                                                                                                       |
| 2.27 Custom Fields        | ✅      |                                                                                                       |
| 2.28 Public Roadmaps      | ✅      |                                                                                                       |
| 2.29 GitHub Integration   | ✅      | Shipped 2026-05-17 — `github_integrations` + `github_pull_requests`                                   |

---

## 2. Core Tables

### 2.1 Organizations & Users

```sql
-- Top-level workspace container
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    url_key         VARCHAR(63) NOT NULL UNIQUE,  -- workspace slug
    logo_url        TEXT,
    data_region     VARCHAR(2) NOT NULL DEFAULT 'US',  -- 'US' | 'EU'

    -- Feature flags
    roadmap_enabled     BOOLEAN NOT NULL DEFAULT false,
    customers_enabled   BOOLEAN NOT NULL DEFAULT false,
    initiatives_enabled BOOLEAN NOT NULL DEFAULT false,

    -- Settings (JSONB for flexibility)
    security_settings   JSONB NOT NULL DEFAULT '{}',
    auth_settings       JSONB NOT NULL DEFAULT '{}',
    theme_settings      JSONB,

    -- Git integration defaults
    git_branch_format           TEXT,
    git_linkback_messages       BOOLEAN NOT NULL DEFAULT true,

    -- Project update reminders
    project_update_frequency_weeks  INT DEFAULT 1,
    project_update_reminders_day    INT DEFAULT 1,  -- 0=Sun, 1=Mon...
    project_update_reminders_hour   INT DEFAULT 10,

    fiscal_year_start_month INT NOT NULL DEFAULT 1,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);

-- Users
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    initials        VARCHAR(4) NOT NULL,
    avatar_url      TEXT,
    avatar_bg_color VARCHAR(7) NOT NULL DEFAULT '#6366f1',

    -- Status
    active          BOOLEAN NOT NULL DEFAULT true,
    last_seen       TIMESTAMPTZ,
    timezone        VARCHAR(63),

    -- Status message
    status_emoji    VARCHAR(32),
    status_label    VARCHAR(255),
    status_until_at TIMESTAMPTZ,

    -- Auth
    password_hash   TEXT,  -- null for OAuth-only users
    google_id       VARCHAR(255),

    -- Notification preferences
    email_notifications_enabled  BOOLEAN NOT NULL DEFAULT true,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Organization membership (many-to-many)
CREATE TABLE organization_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL DEFAULT 'member',  -- 'owner', 'admin', 'member', 'guest'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(organization_id, user_id)
);
CREATE INDEX idx_org_members_org ON organization_members(organization_id);
CREATE INDEX idx_org_members_user ON organization_members(user_id);
```

### 2.2 Teams

```sql
CREATE TABLE teams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    key             VARCHAR(10) NOT NULL,  -- e.g., 'ENG'
    display_name    VARCHAR(255) NOT NULL,
    description     TEXT,
    icon            VARCHAR(255),
    color           VARCHAR(7),
    private         BOOLEAN NOT NULL DEFAULT false,

    -- Hierarchy
    parent_id       UUID REFERENCES teams(id) ON DELETE SET NULL,

    -- Timezone
    timezone        VARCHAR(63) NOT NULL DEFAULT 'UTC',

    -- Cycle configuration
    cycles_enabled          BOOLEAN NOT NULL DEFAULT false,
    cycle_duration          INT DEFAULT 2,  -- weeks
    cycle_cooldown_time     INT DEFAULT 0,  -- weeks
    cycle_start_day         INT DEFAULT 1,  -- 0=Sun, 1=Mon...
    cycle_lock_to_active    BOOLEAN NOT NULL DEFAULT false,
    cycle_auto_assign_started   BOOLEAN NOT NULL DEFAULT false,
    cycle_auto_assign_completed BOOLEAN NOT NULL DEFAULT false,

    -- Auto-close/archive
    auto_close_period       INT,  -- days, null=disabled
    auto_close_state_id     UUID,  -- FK to workflow_states
    auto_archive_period     INT,  -- days, null=disabled
    auto_close_child_issues     BOOLEAN NOT NULL DEFAULT false,
    auto_close_parent_issues    BOOLEAN NOT NULL DEFAULT false,

    -- Estimation
    issue_estimation_type       VARCHAR(20) NOT NULL DEFAULT 'notUsed',  -- 'notUsed', 'linear', 'fibonacci', 'exponential', 'tshirt'
    issue_estimation_extended   BOOLEAN NOT NULL DEFAULT false,
    issue_estimation_allow_zero BOOLEAN NOT NULL DEFAULT false,
    default_issue_estimate      FLOAT,

    -- Default states
    default_issue_state_id      UUID,  -- FK to workflow_states
    triage_enabled              BOOLEAN NOT NULL DEFAULT false,

    -- Issue counter (for TEAM-123 IDs)
    issue_count     INT NOT NULL DEFAULT 0,

    -- Lifecycle
    join_by_default BOOLEAN NOT NULL DEFAULT false,
    retired_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    UNIQUE(organization_id, key)
);
CREATE INDEX idx_teams_org ON teams(organization_id);
CREATE INDEX idx_teams_parent ON teams(parent_id);

-- Team membership (who is on the team)
CREATE TABLE team_memberships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_owner        BOOLEAN NOT NULL DEFAULT false,
    sort_order      FLOAT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(team_id, user_id)
);
CREATE INDEX idx_team_members_team ON team_memberships(team_id);
CREATE INDEX idx_team_members_user ON team_memberships(user_id);

-- Team-scoped role assignment (what the member can do on this team)
CREATE TABLE team_member_roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL DEFAULT 'member',  -- 'admin' | 'member' | 'guest'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(team_id, user_id)
);
CREATE INDEX idx_team_member_roles_team ON team_member_roles(team_id);
CREATE INDEX idx_team_member_roles_user ON team_member_roles(user_id);
```

> **Membership vs. role.** `team_memberships` says *who* is on a team (and who
> the owner is); `team_member_roles` says *what* they can do on that team. A
> user can be a member without a role row — in that case the API treats them
> as `"member"` by default. The two tables are deliberately separate so that
> (a) role mutations don't rewrite the membership row and bump timestamps, and
> (b) a future invite / pre-assign flow can create a role before the user has
> actually joined. GraphQL exposes the effective role as
> `TeamMembership.role: TeamMemberRole!` (see `src/server/graphql/schema.ts`).

### 2.3 Workflow States

```sql
CREATE TABLE workflow_states (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    color           VARCHAR(7) NOT NULL,
    description     TEXT,
    type            VARCHAR(20) NOT NULL,  -- 'triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'
    position        FLOAT NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_workflow_states_team ON workflow_states(team_id);
CREATE INDEX idx_workflow_states_type ON workflow_states(team_id, type);
```

### 2.4 Issues (Core Entity)

```sql
CREATE TABLE issues (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),

    -- Identity
    team_id         UUID NOT NULL REFERENCES teams(id),
    number          INT NOT NULL,  -- sequential per team
    identifier      VARCHAR(20) NOT NULL,  -- 'ENG-123' (denormalized)
    previous_identifiers TEXT[] DEFAULT '{}',

    -- Content
    title           VARCHAR(1000) NOT NULL,
    description     TEXT,
    description_state BYTEA,  -- YJS collaborative state

    -- Properties
    priority        SMALLINT NOT NULL DEFAULT 0,  -- 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
    estimate        FLOAT,
    due_date        DATE,
    sort_order      FLOAT NOT NULL DEFAULT 0,
    priority_sort_order FLOAT NOT NULL DEFAULT 0,
    sub_issue_sort_order FLOAT,

    -- Relationships
    state_id        UUID NOT NULL REFERENCES workflow_states(id),
    assignee_id     UUID REFERENCES users(id),
    creator_id      UUID REFERENCES users(id),
    parent_id       UUID REFERENCES issues(id) ON DELETE SET NULL,
    project_id      UUID,  -- FK added after projects table
    project_milestone_id UUID,
    cycle_id        UUID,  -- FK added after cycles table
    template_id     UUID,  -- FK to templates

    -- Git
    branch_name     VARCHAR(500),

    -- SLA
    sla_breaches_at     TIMESTAMPTZ,
    sla_high_risk_at    TIMESTAMPTZ,
    sla_medium_risk_at  TIMESTAMPTZ,
    sla_started_at      TIMESTAMPTZ,
    sla_type            VARCHAR(50),

    -- Lifecycle timestamps
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    canceled_at     TIMESTAMPTZ,
    auto_archived_at TIMESTAMPTZ,
    auto_closed_at  TIMESTAMPTZ,
    started_triage_at TIMESTAMPTZ,
    triaged_at      TIMESTAMPTZ,
    added_to_cycle_at TIMESTAMPTZ,
    added_to_project_at TIMESTAMPTZ,

    -- Soft delete
    trashed         BOOLEAN NOT NULL DEFAULT false,
    snoozed_by_id   UUID REFERENCES users(id),
    snoozed_until_at TIMESTAMPTZ,

    -- Metadata
    reaction_data   JSONB NOT NULL DEFAULT '{}',
    customer_ticket_count INT NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    UNIQUE(team_id, number)
);

-- Performance indexes
CREATE INDEX idx_issues_org ON issues(organization_id);
CREATE INDEX idx_issues_team ON issues(team_id);
CREATE INDEX idx_issues_state ON issues(state_id);
CREATE INDEX idx_issues_assignee ON issues(assignee_id);
CREATE INDEX idx_issues_project ON issues(project_id);
CREATE INDEX idx_issues_cycle ON issues(cycle_id);
CREATE INDEX idx_issues_parent ON issues(parent_id);
CREATE INDEX idx_issues_identifier ON issues(identifier);
CREATE INDEX idx_issues_priority ON issues(team_id, priority);
CREATE INDEX idx_issues_due_date ON issues(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_issues_created_at ON issues(team_id, created_at);
CREATE INDEX idx_issues_updated_at ON issues(updated_at);
CREATE INDEX idx_issues_trashed ON issues(trashed) WHERE trashed = true;
CREATE INDEX idx_issues_archived ON issues(archived_at) WHERE archived_at IS NOT NULL;

-- Full-text search
CREATE INDEX idx_issues_search ON issues
    USING GIN (to_tsvector('english', title || ' ' || COALESCE(description, '')));
```

### 2.5 Labels

```sql
CREATE TABLE issue_labels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    team_id         UUID REFERENCES teams(id),  -- null = workspace-global
    name            VARCHAR(255) NOT NULL,
    color           VARCHAR(7) NOT NULL,
    description     TEXT,

    -- Group hierarchy
    is_group        BOOLEAN NOT NULL DEFAULT false,
    parent_id       UUID REFERENCES issue_labels(id) ON DELETE SET NULL,

    creator_id      UUID REFERENCES users(id),
    last_applied_at TIMESTAMPTZ,

    -- Lifecycle
    retired_at      TIMESTAMPTZ,
    retired_by_id   UUID REFERENCES users(id),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_labels_org ON issue_labels(organization_id);
CREATE INDEX idx_labels_team ON issue_labels(team_id);
CREATE INDEX idx_labels_parent ON issue_labels(parent_id);

-- Many-to-many: issues <-> labels
CREATE TABLE issue_label_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id        UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    label_id        UUID NOT NULL REFERENCES issue_labels(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(issue_id, label_id)
);
CREATE INDEX idx_issue_labels_issue ON issue_label_assignments(issue_id);
CREATE INDEX idx_issue_labels_label ON issue_label_assignments(label_id);
```

### 2.6 Comments

```sql
-- Comments are currently issue-only. Project and project_update comments are planned but deferred.
-- Bot actors, quote-reply, and polymorphic parent are planned but not yet implemented.
CREATE TABLE comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id        UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,
    body_data       JSONB,  -- ProseMirror document JSON

    -- Threading
    parent_id       UUID REFERENCES comments(id) ON DELETE SET NULL,

    -- Resolution
    resolved_at     TIMESTAMPTZ,
    resolved_by_id  UUID REFERENCES users(id) ON DELETE SET NULL,

    edited_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_comments_issue ON comments(issue_id, created_at);
CREATE INDEX idx_comments_author ON comments(author_id);
CREATE INDEX idx_comments_parent ON comments(parent_id);
```

### 2.7 Issue Relations

```sql
CREATE TABLE issue_relations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id        UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    related_issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL,  -- 'related', 'blocks', 'duplicate'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(issue_id, related_issue_id, type)
);
CREATE INDEX idx_relations_issue ON issue_relations(issue_id);
CREATE INDEX idx_relations_related ON issue_relations(related_issue_id);
```

### 2.8 Issue Activity ⚠️

The actual implementation uses a much simpler change log than the fat Linear-
style `issue_history` originally planned. Each row describes **one** field
change with plain string old/new values.

```sql
CREATE TABLE issue_activities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id    UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    -- 'status', 'assignee', 'priority', 'estimate', 'title',
    -- 'project', 'cycle', 'parent', 'labels', 'archived', 'trashed', etc.
    field       VARCHAR(50) NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_issue_activities_issue_created ON issue_activities(issue_id, created_at);
CREATE INDEX idx_issue_activities_actor ON issue_activities(actor_id);
```

Rationale: the IDs and labels that UI wants are resolved client-side by
joining against the MobX entity pools, so the activity row only needs to carry
the scalar that changed. The schema is additive — a future migration can
introduce the structured-diff columns if we find cases where plain strings
can't encode the change.

### 2.9 Projects

```sql
CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name            VARCHAR(255) NOT NULL,
    slug_id         VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT NOT NULL DEFAULT '',
    content         TEXT,  -- markdown
    icon            VARCHAR(255),
    color           VARCHAR(7) NOT NULL DEFAULT '#6366f1',

    -- Status
    status_type     VARCHAR(20) NOT NULL DEFAULT 'planned',  -- 'backlog', 'planned', 'started', 'paused', 'completed', 'canceled'
    status_name     VARCHAR(255),
    health          VARCHAR(20),  -- 'onTrack', 'atRisk', 'offTrack'
    health_updated_at TIMESTAMPTZ,

    -- Priority
    priority        SMALLINT NOT NULL DEFAULT 0,
    priority_sort_order FLOAT NOT NULL DEFAULT 0,

    -- Progress
    progress        FLOAT NOT NULL DEFAULT 0,
    scope           FLOAT NOT NULL DEFAULT 0,

    -- Dates
    start_date      DATE,
    target_date     DATE,
    start_date_resolution VARCHAR(20),  -- 'day', 'month', 'quarter', 'half', 'year'
    target_date_resolution VARCHAR(20),

    -- People
    lead_id         UUID REFERENCES users(id),
    creator_id      UUID REFERENCES users(id),

    -- History (JSONB arrays for charts)
    completed_issue_count_history JSONB NOT NULL DEFAULT '[]',
    completed_scope_history       JSONB NOT NULL DEFAULT '[]',
    issue_count_history           JSONB NOT NULL DEFAULT '[]',
    scope_history                 JSONB NOT NULL DEFAULT '[]',

    -- Update reminders
    update_reminder_frequency_weeks INT,
    update_reminders_day            INT,
    update_reminders_hour           INT,

    -- Lifecycle
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    canceled_at     TIMESTAMPTZ,
    auto_archived_at TIMESTAMPTZ,
    trashed         BOOLEAN NOT NULL DEFAULT false,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_projects_org ON projects(organization_id);
CREATE INDEX idx_projects_status ON projects(status_type);
CREATE INDEX idx_projects_lead ON projects(lead_id);

-- Projects <-> Teams (many-to-many)
CREATE TABLE project_teams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, team_id)
);

-- Projects <-> Members (many-to-many)
CREATE TABLE project_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, user_id)
);

-- Add FK from issues to projects
ALTER TABLE issues ADD CONSTRAINT fk_issues_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
```

### 2.10 Project Milestones

```sql
CREATE TABLE project_milestones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    target_date     DATE,
    sort_order      FLOAT NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_milestones_project ON project_milestones(project_id);

ALTER TABLE issues ADD CONSTRAINT fk_issues_milestone
    FOREIGN KEY (project_milestone_id) REFERENCES project_milestones(id) ON DELETE SET NULL;
```

### 2.11 Project Updates

```sql
CREATE TABLE project_updates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    body            TEXT NOT NULL,
    body_data       JSONB NOT NULL,
    health          VARCHAR(20) NOT NULL,  -- 'onTrack', 'atRisk', 'offTrack'
    diff            JSONB,
    diff_markdown   TEXT,
    edited_at       TIMESTAMPTZ,
    reaction_data   JSONB NOT NULL DEFAULT '{}',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_project_updates_project ON project_updates(project_id);
```

### 2.12 Cycles

```sql
CREATE TABLE cycles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    number          INT NOT NULL,
    name            VARCHAR(255),
    description     TEXT,

    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,

    completed_at     TIMESTAMPTZ,
    auto_archived_at TIMESTAMPTZ,

    -- Progress
    progress        FLOAT NOT NULL DEFAULT 0,
    scope           FLOAT NOT NULL DEFAULT 0,

    -- History (drives burndown / burnup charts)
    scope_history                 JSONB NOT NULL DEFAULT '[]',
    completed_scope_history       JSONB NOT NULL DEFAULT '[]',
    issue_count_history           JSONB NOT NULL DEFAULT '[]',
    completed_issue_count_history JSONB NOT NULL DEFAULT '[]',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    UNIQUE(team_id, number)
);
CREATE INDEX idx_cycles_organization ON cycles(organization_id);
CREATE INDEX idx_cycles_team ON cycles(team_id);
CREATE INDEX idx_cycles_team_starts_at ON cycles(team_id, starts_at);

ALTER TABLE issues ADD CONSTRAINT fk_issues_cycle
    FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL;
```

`organization_id` is denormalized onto the cycle so bootstrap / delta sync can
scope by org without a join through teams.

### 2.13 Initiatives ✅

> **Shipped (2026-05-05).** Top-level strategic objects that group projects
> toward multi-quarter goals. `Initiative.progress` is a cached roll-up
> computed as the mean of associated projects' progress; recompute fires
> on project create/archive/delete and on project status/progress changes.
> The actual schema is flatter than the early sketch — no `parent_id` (no
> sub-initiatives yet) and no `slug_id` (lookups by id only).

```sql
CREATE TABLE initiatives (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name                   VARCHAR(255) NOT NULL,
    description            TEXT,
    icon                   VARCHAR(255),
    color                  VARCHAR(7) NOT NULL DEFAULT '#6366f1',

    status                 VARCHAR(20) NOT NULL DEFAULT 'planned',  -- 'planned' | 'active' | 'completed' | 'canceled'
    priority               SMALLINT NOT NULL DEFAULT 0,
    priority_sort_order    FLOAT NOT NULL DEFAULT 0,
    sort_order             FLOAT NOT NULL DEFAULT 0,

    target_date            DATE,
    start_date             DATE,
    start_date_resolution  VARCHAR(20),
    target_date_resolution VARCHAR(20),

    owner_id               UUID REFERENCES users(id) ON DELETE SET NULL,
    creator_id             UUID REFERENCES users(id) ON DELETE SET NULL,

    progress               FLOAT NOT NULL DEFAULT 0,  -- 0..1, recomputed from linked projects

    started_at             TIMESTAMPTZ,
    completed_at           TIMESTAMPTZ,
    canceled_at            TIMESTAMPTZ,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL,
    archived_at            TIMESTAMPTZ
);
CREATE INDEX idx_initiatives_organization_id ON initiatives(organization_id);
CREATE INDEX idx_initiatives_status ON initiatives(status);
CREATE INDEX idx_initiatives_owner_id ON initiatives(owner_id);

-- Initiatives <-> Projects (many-to-many)
CREATE TABLE initiative_projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiative_id   UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sort_order      FLOAT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(initiative_id, project_id)
);
```

**Sync action coverage:** `initiativeAddProject`/`initiativeRemoveProject`
emit BOTH an `InitiativeProject` action (for the link row) and an
`Initiative` `'U'` action (for the recomputed progress). `projectArchive`,
`projectDelete`, and `projectUpdate` emit a follow-up `Initiative` `'U'`
for every linked initiative whose progress shifted, so collaborators see
roll-up changes in real time without a bootstrap.

### 2.14 Attachments 📋

> **Not implemented.** Superseded by §2.25 Files for image / document uploads.
> The Linear-style "linked resource" attachment (Figma, Google Doc, etc.) is
> still a design target.

```sql
CREATE TABLE attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id        UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    title           VARCHAR(500) NOT NULL,
    subtitle        VARCHAR(500),
    url             TEXT NOT NULL,
    source_type     VARCHAR(50),
    source          JSONB,
    metadata        JSONB,

    creator_id      UUID REFERENCES users(id),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_attachments_issue ON attachments(issue_id);
```

### 2.15 Comment Reactions

```sql
-- Reactions on issues and project updates are planned but deferred.
-- Only comment reactions are currently implemented.
CREATE TABLE comment_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id  UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       VARCHAR(50) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(comment_id, user_id, emoji)
);
CREATE INDEX idx_comment_reactions_comment ON comment_reactions(comment_id);
CREATE INDEX idx_comment_reactions_user ON comment_reactions(user_id);
```

### 2.16 Notifications ⚠️

Notifications today are issue-scoped only. The `data` JSONB column holds any
denormalized payload the UI needs (comment excerpt, old/new state name, etc.),
so no polymorphic FKs are required.

```sql
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_id        UUID REFERENCES issues(id) ON DELETE CASCADE,
    actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,

    -- ISSUE_ASSIGNED, ISSUE_MENTIONED, ISSUE_COMMENTED, ISSUE_STATUS_CHANGED, ...
    type            VARCHAR(50) NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}',

    -- State
    read              BOOLEAN NOT NULL DEFAULT false,
    read_at           TIMESTAMPTZ,
    snoozed_until_at  TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at);
CREATE INDEX idx_notifications_organization ON notifications(organization_id);
CREATE INDEX idx_notifications_issue ON notifications(issue_id);

-- Per-user subscription toggle, issue-scoped
CREATE TABLE notification_subscriptions (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_id  UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    active    BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(user_id, issue_id)
);
CREATE INDEX idx_notif_subs_user ON notification_subscriptions(user_id);
CREATE INDEX idx_notif_subs_issue ON notification_subscriptions(issue_id);
```

> **Project / team-level subscriptions and e-mail delivery tracking
> (`emailed_at`) are design targets, not yet in Prisma.**

### 2.17 Custom Views ⚠️

The implemented columns are `filters / sort / layout / group_by`, not the
Linear-style `filter_data / display_type / sort_by / columns / owner_id`
originally sketched here. Per-column list config lives inside the `filters`
JSONB blob under `columns`.

```sql
CREATE TABLE custom_views (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    team_id         UUID REFERENCES teams(id) ON DELETE SET NULL,  -- null = workspace-level
    creator_id      UUID NOT NULL REFERENCES users(id),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    icon            VARCHAR(255),
    color           VARCHAR(7),

    -- View config
    filters     JSONB NOT NULL DEFAULT '{}',           -- IssueFilter + optional column picker state
    sort        JSONB NOT NULL DEFAULT '[]',           -- [{ field, direction }]
    group_by    VARCHAR(50),
    layout      VARCHAR(10) NOT NULL DEFAULT 'list',   -- 'list' | 'board'

    shared      BOOLEAN NOT NULL DEFAULT false,
    sort_order  FLOAT   NOT NULL DEFAULT 0,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ
);
CREATE INDEX idx_custom_views_organization ON custom_views(organization_id);
CREATE INDEX idx_custom_views_team ON custom_views(team_id);
CREATE INDEX idx_custom_views_creator ON custom_views(creator_id);
```

> Ownership today is "creator only" (`creator_id` + `shared` flag). A separate
> `owner_id` / transfer-of-ownership flow is a design target, not shipped.

### 2.18 Favorites 📋

> **Not yet in Prisma.** Favorites / sidebar pinning is planned; no table exists.

```sql
CREATE TABLE favorites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL,  -- 'issue', 'project', 'cycle', 'customView', 'document', 'label', 'folder', 'predefinedView'
    title           VARCHAR(255) NOT NULL,
    sort_order      FLOAT NOT NULL DEFAULT 0,
    icon            VARCHAR(255),
    color           VARCHAR(7),

    -- Folder support
    parent_id       UUID REFERENCES favorites(id) ON DELETE CASCADE,
    folder_name     VARCHAR(255),

    -- Polymorphic target (at most one non-null)
    issue_id        UUID REFERENCES issues(id) ON DELETE CASCADE,
    project_id      UUID,
    cycle_id        UUID,
    custom_view_id  UUID,
    team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
    label_id        UUID,
    initiative_id   UUID,

    -- For predefined views
    predefined_view_type VARCHAR(50),
    predefined_view_team_id UUID REFERENCES teams(id),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_favorites_owner ON favorites(owner_id);
CREATE INDEX idx_favorites_parent ON favorites(parent_id);
```

### 2.19 Documents ✅

Shipped in Sprint 35-36 (PR #28) as a workspace-wide rich-text documents
system with nested hierarchy. `content` stores the editor output as a string
(HTML today; markdown is fine too — the service treats it as an opaque
payload). No YJS / collaborative editing yet.

```sql
CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    team_id         UUID REFERENCES teams(id) ON DELETE SET NULL,
    project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
    creator_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    parent_id       UUID REFERENCES documents(id) ON DELETE SET NULL,

    title           VARCHAR(255) NOT NULL,
    content         TEXT,         -- editor output (opaque string)
    icon            VARCHAR(255),
    sort_order      FLOAT NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_documents_organization ON documents(organization_id);
CREATE INDEX idx_documents_team ON documents(team_id);
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_documents_parent ON documents(parent_id);
```

> **Historical note:** a `content_data JSONB` column was created alongside
> `content` as a forward-looking slot for structured TipTap JSON, but nothing
> ever read or wrote it. It was dropped in migration
> `20260421000000_drop_document_content_data`.

> **Design targets not yet implemented:** `slug_id`, per-document color, YJS
> `content_state` (`BYTEA`) for real-time collab, issue / cycle / initiative
> associations, `trashed` / `hidden_at`, separate `updated_by_id`.

### 2.20 Issue Templates ⚠️

Only issue templates are implemented; project / document templates remain a
design target. The real table is team-scoped (no workspace-level templates)
and stores the prefilled issue payload as JSONB.

```sql
CREATE TABLE issue_templates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    creator_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    name          VARCHAR(255) NOT NULL,
    description   TEXT,
    template_data JSONB NOT NULL DEFAULT '{}',  -- { title, description, priority, labelIds, ... }
    is_default    BOOLEAN NOT NULL DEFAULT false,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at   TIMESTAMPTZ
);
CREATE INDEX idx_issue_templates_team ON issue_templates(team_id);
CREATE INDEX idx_issue_templates_creator ON issue_templates(creator_id);
```

> A generic polymorphic `templates` table (with `type`, `has_form_fields`, etc.)
> remains a design target for when project / document templates ship.

### 2.21 Webhooks ✅

> **Shipped (2026-05-05).** Outbound HTTP webhooks with HMAC SHA-256
> signing. Each enabled subscription that lists a fired event in its
> `events` array gets a `webhook_deliveries` row; the WS server's
> 30-second sweep retries any pending deliveries whose `next_attempt_at`
> has passed (exponential backoff: 30s, 2m, 10m, 30m, 2h; max 5 attempts).
> A webhook auto-disables after `consecutive_failures >= 20`.

```sql
CREATE TABLE webhooks (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name                 VARCHAR(255) NOT NULL,
    url                  VARCHAR(2000) NOT NULL,
    events               TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    signing_secret       TEXT NOT NULL,
    enabled              BOOLEAN NOT NULL DEFAULT true,
    team_id              UUID,  -- null = org-wide; otherwise scoped to one team

    last_delivery_at     TIMESTAMPTZ,
    last_success_at      TIMESTAMPTZ,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,

    created_by_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL,
    archived_at          TIMESTAMPTZ
);
CREATE INDEX idx_webhooks_organization_id ON webhooks(organization_id);
CREATE INDEX idx_webhooks_organization_id_enabled ON webhooks(organization_id, enabled);

CREATE TABLE webhook_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id      UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event           VARCHAR(50) NOT NULL,
    payload         JSONB NOT NULL,
    status          VARCHAR(10) NOT NULL DEFAULT 'pending',  -- 'pending' | 'success' | 'failed'
    attempts        INTEGER NOT NULL DEFAULT 0,
    response_status INTEGER,
    response_body   TEXT,
    error_message   TEXT,
    next_attempt_at TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_webhook_deliveries_webhook_id_created_at
  ON webhook_deliveries(webhook_id, created_at);
CREATE INDEX idx_webhook_deliveries_status_next_attempt_at
  ON webhook_deliveries(status, next_attempt_at);
```

**Signing.** Body is signed with `HMAC_SHA256(payload, signing_secret)`,
hex-encoded, sent as `X-Bilinear-Signature: sha256=<hex>`. The receiver
verifies with `verifySignature` (helper exported from
`webhook.service.ts`).

**SSRF protection.** Webhook URLs are validated at create time AND
re-validated against the resolved IP at delivery time (mitigates DNS
rebinding). Private/loopback ranges are rejected unless
`ALLOW_PRIVATE_WEBHOOK_URLS=1` is explicitly set.

**Concurrency.** `processDelivery` claims a row via `updateMany` on
`status='pending'` before sending; concurrent runners (e.g. multiple WS
replicas) see `count=0` and bail. Auto-disable uses an atomic
conditional update so a successful delivery cannot be raced into a
disabled state.

**Webhooks are NOT synced via the org-wide sync stream** — only org
admins can manage them, so the GraphQL `webhooks` query is fetched on
demand by the settings page rather than mirrored into IndexedDB.

**Event surface (`WEBHOOK_EVENTS`):**
`issue.created`, `issue.updated`, `issue.archived`, `issue.deleted`,
`comment.created`, `comment.updated`, `project.created`,
`project.updated`, `cycle.created`, `cycle.completed`,
`initiative.created`, `initiative.updated`.

### 2.22 Sync Actions (Delta Sync)

```sql
CREATE TABLE sync_actions (
    id              BIGSERIAL PRIMARY KEY,  -- monotonically increasing
    organization_id UUID NOT NULL REFERENCES organizations(id),
    action          CHAR(1) NOT NULL,  -- 'I', 'U', 'D', 'A'
    model_name      VARCHAR(50) NOT NULL,
    model_id        UUID NOT NULL,
    data            JSONB,  -- null for deletes

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Statement-time timestamp populated by the
    -- `sync_action_set_committed_at` BEFORE INSERT trigger. Delta-sync
    -- orders by `committed_at` and waits a small safety window so an
    -- earlier-id row whose transaction commits late can't be skipped.
    committed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_actions_org ON sync_actions(organization_id, id);
CREATE INDEX idx_sync_actions_org_committed ON sync_actions(organization_id, committed_at, id);
CREATE INDEX idx_sync_actions_model ON sync_actions(model_name, model_id);

-- Partition by organization for scale (optional)
-- Prune old entries (>30 days) via background job
```

> **Ordering invariant.** BIGSERIAL `id` values are assigned at INSERT
> but transactions commit out of order. Delta-sync MUST order by
> `(committed_at, id)` and exclude rows newer than
> `now() - SyncService.COMMITTED_WATERMARK_LAG_MS` (500ms today). Reading
> by `id` alone permanently skips rows whose commit lands after a faster
> later-id row. See `SyncService.getDeltaSyncActions`.

### 2.22a Action codes

| Code | Meaning  | Notes                                                              |
| ---- | -------- | ------------------------------------------------------------------ |
| `I`  | Insert   | First time the client should see this row                          |
| `U`  | Update   | Replace existing pool row by id                                    |
| `D`  | Delete   | Hard delete — remove from pool                                     |
| `A`  | Archive  | Soft delete — upsert with `archivedAt` populated; row stays in the pool so references can still resolve to a name (UI consumers filter by `archivedAt`) |

### 2.23 Auth Tokens

```sql
CREATE TABLE auth_tokens (
    id              UUID PRIMARY KEY,  -- client-generated UUID (pre-generated before JWT signing)
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL,  -- 'refresh', 'api_key', 'magic_link'
    token_hash      TEXT NOT NULL,  -- SHA-256 of the raw token; never store plaintext
    -- For magic_link: hash of the 6-digit code sent in email
    -- For refresh: hash of the signed JWT
    -- For api_key: hash of the key string
    code            VARCHAR(6),    -- raw magic link code (kept briefly for verification; null for non-magic-link tokens)
    label           VARCHAR(255),  -- for API keys (user-visible name)

    ip_address      VARCHAR(45),   -- IPv4 or IPv6
    user_agent      TEXT,

    expires_at      TIMESTAMPTZ NOT NULL,
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);
CREATE INDEX idx_auth_tokens_hash ON auth_tokens(token_hash);
```

> **Implementation note:** Raw codes and tokens are never stored in the database. All lookups use SHA-256 hashes (`token_hash`). For magic links, the 6-digit code is generated with `crypto.randomInt`, hashed, stored, and the raw code is only ever in the email. The `id` is pre-generated as a UUID so the JWT can be signed and the record created in a single write (no two-step update).

### 2.24 Audit Log 📋

> **Not yet in Prisma.** Enterprise audit log is a design target; today the
> closest thing is `sync_actions` (§2.22), which records every mutation but
> scoped to change-replication, not compliance.

```sql
CREATE TABLE audit_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    actor_id        UUID REFERENCES users(id),
    type            VARCHAR(100) NOT NULL,  -- e.g., 'issue.create', 'member.invite'
    metadata        JSONB NOT NULL DEFAULT '{}',

    ip_address      INET,
    country_code    VARCHAR(2),
    user_agent      TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org ON audit_entries(organization_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_entries(actor_id);
CREATE INDEX idx_audit_type ON audit_entries(type);
```

### 2.25 Files

```sql
-- Tracks uploaded files attached to issues or projects.
-- Currently, file content is stored externally (S3-compatible); this table holds metadata only.
CREATE TABLE files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id    UUID REFERENCES issues(id) ON DELETE CASCADE,
    project_id  UUID,  -- FK to projects (not yet enforced via constraint)
    uploader_id UUID,  -- FK to users
    name        VARCHAR(500) NOT NULL,
    key         VARCHAR(1000) NOT NULL,  -- storage key / path
    size        INT NOT NULL,            -- bytes
    mime_type   VARCHAR(255) NOT NULL,
    url         TEXT,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_files_issue ON files(issue_id);
CREATE INDEX idx_files_project ON files(project_id);
CREATE INDEX idx_files_uploader ON files(uploader_id);
```

### 2.26 Team Member Roles

> Paired with `team_memberships` (§2.2). Membership says *who* is on a team;
> this table says *what* they can do. GraphQL surfaces the effective value as
> `TeamMembership.role: TeamMemberRole!`; rows missing here default to
> `member` at the resolver layer.

```sql
-- Stores explicit per-team roles for team members.
-- Role values: 'admin', 'member', 'guest'
-- Complements TeamMembership.is_owner; guest enforcement is planned but not yet active.
CREATE TABLE team_member_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL DEFAULT 'member',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(team_id, user_id)
);
CREATE INDEX idx_team_member_roles_team ON team_member_roles(team_id);
CREATE INDEX idx_team_member_roles_user ON team_member_roles(user_id);
```

### 2.27 Custom Fields

```sql
-- Team-scoped definitions. Values live in a separate table (custom_field_values)
-- keyed by (issue_id, definition_id) so filter/sort stay indexable.
CREATE TYPE custom_field_type AS ENUM (
    'text', 'number', 'date',
    'select', 'multi_select',
    'url', 'checkbox'
);

CREATE TABLE custom_field_definitions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    type        custom_field_type NOT NULL,
    description TEXT,
    required    BOOLEAN NOT NULL DEFAULT FALSE,
    -- For select / multi_select: JSONB array of { value, label, color? }.
    -- NULL for other types; service layer rejects options on non-select types.
    options     JSONB,
    sort_order  DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ
);
CREATE INDEX idx_custom_field_definitions_team ON custom_field_definitions(team_id);

CREATE TABLE custom_field_values (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id       UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    definition_id  UUID NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
    -- JSONB shape by type:
    --   text / url       → string
    --   number           → number
    --   date             → ISO date string
    --   checkbox         → boolean
    --   select           → option value string
    --   multi_select     → array of option value strings
    value          JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(issue_id, definition_id)
);
CREATE INDEX idx_custom_field_values_issue ON custom_field_values(issue_id);
CREATE INDEX idx_custom_field_values_definition ON custom_field_values(definition_id);
```

**Validation** is enforced at the service layer (`CustomFieldService`):

- Max 20 active definitions per team
- `select` / `multi_select` types require at least one option; option values must be unique per field
- Non-select types reject options
- Value type and allowed-option membership are validated before upsert

### 2.28 Public Roadmaps

Shipped in Sprint 53-54 (PR #28). One row per organization; `enabled`
gates the public `/r/:slug` page. A SHA-256 password hash guards private
roadmaps; null means open to the public.

```sql
CREATE TABLE public_roadmaps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    slug            VARCHAR(63) NOT NULL UNIQUE,
    enabled         BOOLEAN NOT NULL DEFAULT false,
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    password_hash   TEXT,          -- nullable; null = public, non-null = password-gated
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_public_roadmaps_slug ON public_roadmaps(slug);
```

Per-project exposure is controlled by `projects.roadmap_visible` (§2.9). The
public endpoint joins the two: roadmap row must be `enabled`, project row must
have `roadmap_visible = true` and not be archived / trashed.

### 2.29 GitHub Integration ✅

Shipped 2026-05-17. One OAuth connection per org. Linked pull requests are
stored per-issue and updated by the inbound webhook.

```sql
-- One OAuth connection per workspace. Stores the access token used for
-- GitHub API calls and the webhook secret used to validate inbound events.
CREATE TABLE github_integrations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    access_token     VARCHAR(500) NOT NULL,  -- GitHub OAuth access token
    github_login     VARCHAR(255) NOT NULL,  -- GitHub user or org login
    github_user_id   INTEGER NOT NULL,       -- GitHub numeric user ID
    webhook_secret   VARCHAR(255) NOT NULL,  -- HMAC secret for X-Hub-Signature-256 validation
    created_by_id    UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pull requests linked to issues. One row per (integration, PR, issue) triple.
-- Upserted by POST /api/integrations/github/webhook on pull_request events.
-- state: 'open' | 'closed' | 'merged'
CREATE TABLE github_pull_requests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES organizations(id),
    issue_id         UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    integration_id   UUID NOT NULL REFERENCES github_integrations(id) ON DELETE CASCADE,
    pr_number        INTEGER NOT NULL,
    title            VARCHAR(500) NOT NULL,
    url              VARCHAR(1000) NOT NULL,
    state            VARCHAR(20) NOT NULL,   -- open | closed | merged
    draft            BOOLEAN NOT NULL DEFAULT false,
    head_branch      VARCHAR(500) NOT NULL,
    repo_full_name   VARCHAR(500) NOT NULL,  -- e.g. "acme/backend"
    author_login     VARCHAR(255) NOT NULL,
    merged_at        TIMESTAMPTZ,
    closed_at        TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT github_pull_requests_pr_issue_uniq UNIQUE (integration_id, pr_number, repo_full_name, issue_id)
);
CREATE INDEX github_pull_requests_issue_id_idx ON github_pull_requests (issue_id);
CREATE INDEX github_pull_requests_org_id_idx   ON github_pull_requests (organization_id);
```

**Webhook URL format:** `POST /api/integrations/github/webhook?org=<urlKey>`

The `org` query parameter identifies the workspace. GitHub signs each request
with `X-Hub-Signature-256: sha256=<hex>`; the handler re-computes HMAC-SHA256
over the raw body and rejects mismatches with 401.

**PR auto-linking:** the webhook handler extracts issue identifiers (e.g.
`ENG-123`) from the PR title and head branch via regex `/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g`,
looks them up against `issues.identifier` for the org, and upserts a
`github_pull_requests` row per match.

**Auto-close on merge:** when a PR merges, matched issues whose current state
category is not `completed` or `canceled` are transitioned to the team's first
`completed` workflow state.

See PATTERNS.md §41.

---

## 3. Entity Relationship Summary

Only shipped relationships are shown here. 📋 tables from §2 are omitted.

```
organizations 1──* teams
organizations 1──* users (via organization_members)
organizations 1──* projects
organizations 1──* cycles
organizations 1──* issue_labels
organizations 1──* custom_views
organizations 1──* documents
organizations 1──1 public_roadmaps
organizations 1──* notifications
organizations 1──* sync_actions

teams 1──* issues
teams 1──* workflow_states
teams 1──* cycles
teams 1──* team_memberships
teams 1──* team_member_roles
teams 1──* issue_templates
teams 1──* custom_field_definitions
teams 0..1──* documents
teams *──* projects (via project_teams)
teams 0..1──* teams (parent/child)

issues *──1 workflow_states (state)
issues *──0..1 users (assignee / creator / snoozed_by)
issues *──0..1 projects
issues *──0..1 project_milestones
issues *──0..1 cycles
issues *──0..1 issues (parent)
issues *──* issue_labels (via issue_label_assignments)
issues 1──* comments
issues 1──* files
issues 1──* issue_relations
issues 1──* issue_activities
issues 1──* notifications
issues 1──* custom_field_values
issues 1──* notification_subscriptions

comments 1──* comment_reactions
comments 0..1──* comments (parent → replies)

custom_field_definitions 1──* custom_field_values

projects 1──* project_milestones
projects 1──* project_updates
projects *──* users (via project_members)
projects 0..1──* documents

documents 0..1──* documents (parent/child)

users 1──* notifications
users 1──* notification_subscriptions
users 1──* auth_tokens
users 1──* custom_views (creator)
users 1──* issue_templates (creator)
users 1──* documents (creator)
users 1──* github_integrations (creator)

organizations 1──1 github_integrations
organizations 1──* github_pull_requests

issues 1──* github_pull_requests

github_integrations 1──* github_pull_requests
```

---

## 4. Migration Strategy

### Prisma 7 Configuration

Prisma 7 no longer accepts a `url` property in the `datasource` block of `schema.prisma`. The database URL is configured in two places:

- **`prisma.config.ts`** (project root) — provides `DATABASE_URL` for CLI commands (`migrate`, `generate`, `studio`)
- **`src/server/lib/prisma.ts`** — instantiates `PrismaClient` with `new PrismaPg({ connectionString })` driver adapter

After any schema change, regenerate the client:

```bash
yarn prisma generate     # rebuilds src/generated/prisma/ (gitignored)
yarn prisma migrate dev  # applies new migration
```

### Migration Files

Migrations use date-based names. The pre-release incremental history was
consolidated into a single baseline migration; new features ship as
additive migrations on top of it.

```
prisma/
├── schema.prisma
├── prisma.config.ts            -- CLI datasource url (Prisma 7)
└── migrations/
    ├── 20260407000000_init/                        -- consolidated baseline: all pre-Sprint-23 tables,
    │                                               --   the FTS GIN index, and the partial unique index
    │                                               --   on teams(organization_id, key) WHERE archived_at IS NULL
    ├── 20260416120000_custom_fields/               -- custom_field_definitions, custom_field_values,
    │                                               --   custom_field_type enum (Sprint 23-24)
    ├── 20260417000001_documents/                   -- documents table w/ parent hierarchy (Sprint 35-36)
    ├── 20260417000002_public_roadmaps/             -- public_roadmaps + projects.roadmap_visible (Sprint 53-54)
    ├── 20260421000000_drop_document_content_data/  -- remove unused document content_data column
    ├── 20260422000000_auth_token_family/           -- auth_tokens family/chain columns for refresh rotation
    ├── 20260505000000_initiatives_webhooks/        -- initiatives, initiative_projects, webhooks,
    │                                               --   webhook_deliveries (2026-05-05 sprints)
    ├── 20260512000000_sync_action_committed_at/    -- sync_actions.committed_at + BEFORE INSERT trigger
    ├── 20260512100000_db_hardening_constraints/    -- check constraints, partial indexes, enum guards
    └── 20260517000000_github_integration_email_notifications/
                                                    -- github_integrations, github_pull_requests,
                                                    --   users.email_notifications_enabled (2026-05-17)
```

Tables tagged 📋 in §1.1 (Favorites, Attachments as linked resources, Audit Log)
are **design targets** — kept in §2 as the canonical design reference for when
those sprints land.
