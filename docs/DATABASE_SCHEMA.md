# Database Schema Design

## Issue Tracker — Linear Rebuild

**Version:** 1.0
**Date:** April 2026
**Database:** PostgreSQL 18

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

-- Team membership
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
```

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
CREATE TABLE comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    body            TEXT NOT NULL,
    body_data       JSONB,  -- ProseMirror document JSON

    -- Polymorphic parent
    issue_id        UUID REFERENCES issues(id) ON DELETE CASCADE,
    project_id      UUID,  -- FK to projects
    project_update_id UUID,

    -- Author (one of these)
    user_id         UUID REFERENCES users(id),
    bot_actor       JSONB,

    -- Threading
    parent_id       UUID REFERENCES comments(id) ON DELETE SET NULL,

    -- Resolution
    resolved_at     TIMESTAMPTZ,
    resolving_user_id UUID REFERENCES users(id),
    resolving_comment_id UUID REFERENCES comments(id),

    -- Quote
    quoted_text     TEXT,

    -- Reactions
    reaction_data   JSONB NOT NULL DEFAULT '{}',

    edited_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_comments_issue ON comments(issue_id);
CREATE INDEX idx_comments_project ON comments(project_id);
CREATE INDEX idx_comments_user ON comments(user_id);
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

### 2.8 Issue History (Activity Log)

```sql
CREATE TABLE issue_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id        UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    actor_id        UUID REFERENCES users(id),
    bot_actor       JSONB,

    -- Change tracking (from/to pairs)
    from_state_id       UUID REFERENCES workflow_states(id),
    to_state_id         UUID REFERENCES workflow_states(id),
    from_assignee_id    UUID REFERENCES users(id),
    to_assignee_id      UUID REFERENCES users(id),
    from_priority       SMALLINT,
    to_priority         SMALLINT,
    from_estimate       FLOAT,
    to_estimate         FLOAT,
    from_due_date       DATE,
    to_due_date         DATE,
    from_title          TEXT,
    to_title            TEXT,
    from_project_id     UUID,
    to_project_id       UUID,
    from_cycle_id       UUID,
    to_cycle_id         UUID,
    from_parent_id      UUID,
    to_parent_id        UUID,
    from_team_id        UUID REFERENCES teams(id),
    to_team_id          UUID REFERENCES teams(id),

    added_label_ids     UUID[],
    removed_label_ids   UUID[],

    -- Metadata
    archived        BOOLEAN,
    auto_archived   BOOLEAN,
    auto_closed     BOOLEAN,
    trashed         BOOLEAN,
    relation_changes JSONB,
    attachment_id   UUID,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_issue_history_issue ON issue_history(issue_id);
CREATE INDEX idx_issue_history_created ON issue_history(issue_id, created_at);
```

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
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name            VARCHAR(255),
    number          INT NOT NULL,
    description     TEXT,

    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ,

    -- Progress
    progress        FLOAT NOT NULL DEFAULT 0,
    scope           FLOAT NOT NULL DEFAULT 0,

    -- History (for charts)
    completed_issue_count_history JSONB NOT NULL DEFAULT '[]',
    completed_scope_history       JSONB NOT NULL DEFAULT '[]',
    issue_count_history           JSONB NOT NULL DEFAULT '[]',
    scope_history                 JSONB NOT NULL DEFAULT '[]',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_cycles_team ON cycles(team_id);
CREATE INDEX idx_cycles_dates ON cycles(team_id, starts_at, ends_at);

ALTER TABLE issues ADD CONSTRAINT fk_issues_cycle
    FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL;
```

### 2.13 Initiatives

```sql
CREATE TABLE initiatives (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name            VARCHAR(255) NOT NULL,
    slug_id         VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT,
    content         TEXT,
    icon            VARCHAR(255),
    color           VARCHAR(7),

    status          VARCHAR(20) NOT NULL DEFAULT 'planned',  -- 'planned', 'active', 'completed'
    health          VARCHAR(20),
    target_date     DATE,
    target_date_resolution VARCHAR(20),

    owner_id        UUID REFERENCES users(id),
    creator_id      UUID REFERENCES users(id),

    -- Hierarchy
    parent_id       UUID REFERENCES initiatives(id) ON DELETE SET NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_initiatives_org ON initiatives(organization_id);
CREATE INDEX idx_initiatives_parent ON initiatives(parent_id);

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

### 2.14 Attachments

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

### 2.15 Reactions

```sql
CREATE TABLE reactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emoji           VARCHAR(32) NOT NULL,
    user_id         UUID REFERENCES users(id),

    -- Polymorphic target (exactly one should be non-null)
    comment_id      UUID REFERENCES comments(id) ON DELETE CASCADE,
    issue_id        UUID REFERENCES issues(id) ON DELETE CASCADE,
    project_update_id UUID REFERENCES project_updates(id) ON DELETE CASCADE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reactions_comment ON reactions(comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX idx_reactions_issue ON reactions(issue_id) WHERE issue_id IS NOT NULL;
```

### 2.16 Notifications

```sql
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL,  -- 'issueAssignment', 'issueMention', 'issueComment', 'projectUpdate', etc.

    -- Polymorphic source
    issue_id        UUID REFERENCES issues(id) ON DELETE CASCADE,
    comment_id      UUID REFERENCES comments(id) ON DELETE CASCADE,
    project_id      UUID,
    project_update_id UUID,

    actor_id        UUID REFERENCES users(id),

    -- State
    read_at         TIMESTAMPTZ,
    snoozed_until_at TIMESTAMPTZ,

    -- Email tracking
    emailed_at      TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_created ON notifications(user_id, created_at DESC);

-- Notification subscriptions
CREATE TABLE notification_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Polymorphic target
    issue_id        UUID REFERENCES issues(id) ON DELETE CASCADE,
    project_id      UUID,
    team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
    custom_view_id  UUID,

    -- Settings
    notification_types TEXT[] NOT NULL DEFAULT '{}',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_subs_user ON notification_subscriptions(user_id);
CREATE INDEX idx_notif_subs_issue ON notification_subscriptions(issue_id) WHERE issue_id IS NOT NULL;
```

### 2.17 Custom Views

```sql
CREATE TABLE custom_views (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    team_id         UUID REFERENCES teams(id),  -- null = workspace-level
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    icon            VARCHAR(255),
    color           VARCHAR(7),

    -- View config
    filter_data     JSONB NOT NULL DEFAULT '{}',
    display_type    VARCHAR(20) NOT NULL DEFAULT 'list',  -- 'list', 'board', 'timeline'
    group_by        VARCHAR(50),
    sort_by         JSONB,
    columns         TEXT[],

    -- Ownership
    creator_id      UUID NOT NULL REFERENCES users(id),
    owner_id        UUID NOT NULL REFERENCES users(id),
    shared          BOOLEAN NOT NULL DEFAULT false,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_custom_views_org ON custom_views(organization_id);
CREATE INDEX idx_custom_views_team ON custom_views(team_id);
CREATE INDEX idx_custom_views_creator ON custom_views(creator_id);
```

### 2.18 Favorites

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

### 2.19 Documents

```sql
CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    title           VARCHAR(500) NOT NULL,
    slug_id         VARCHAR(255) NOT NULL UNIQUE,
    content         TEXT,
    content_state   BYTEA,  -- YJS state for collaborative editing
    icon            VARCHAR(255),
    color           VARCHAR(7),

    creator_id      UUID REFERENCES users(id),
    updated_by_id   UUID REFERENCES users(id),

    -- Polymorphic association
    project_id      UUID,
    initiative_id   UUID,
    issue_id        UUID REFERENCES issues(id) ON DELETE SET NULL,
    cycle_id        UUID,
    team_id         UUID REFERENCES teams(id) ON DELETE SET NULL,

    sort_order      FLOAT NOT NULL DEFAULT 0,
    trashed         BOOLEAN NOT NULL DEFAULT false,
    hidden_at       TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_documents_org ON documents(organization_id);
CREATE INDEX idx_documents_project ON documents(project_id);
```

### 2.20 Templates

```sql
CREATE TABLE templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    team_id         UUID REFERENCES teams(id),  -- null = workspace-level
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(50) NOT NULL,  -- 'issue', 'project', 'document'
    description     TEXT,
    icon            VARCHAR(255),
    color           VARCHAR(7),

    template_data   JSONB NOT NULL DEFAULT '{}',
    has_form_fields BOOLEAN NOT NULL DEFAULT false,

    creator_id      UUID REFERENCES users(id),
    last_updated_by_id UUID REFERENCES users(id),
    last_applied_at TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_templates_org ON templates(organization_id);
CREATE INDEX idx_templates_team ON templates(team_id);
```

### 2.21 Webhooks

```sql
CREATE TABLE webhooks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    team_id         UUID REFERENCES teams(id),
    url             TEXT NOT NULL,
    label           VARCHAR(255),
    secret          TEXT NOT NULL,  -- HMAC signing key
    enabled         BOOLEAN NOT NULL DEFAULT true,
    all_public_teams BOOLEAN NOT NULL DEFAULT false,
    resource_types  TEXT[] NOT NULL DEFAULT '{}',

    creator_id      UUID REFERENCES users(id),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_webhooks_org ON webhooks(organization_id);
```

### 2.22 Sync Actions (Delta Sync)

```sql
CREATE TABLE sync_actions (
    id              BIGSERIAL PRIMARY KEY,  -- monotonically increasing
    organization_id UUID NOT NULL REFERENCES organizations(id),
    action          CHAR(1) NOT NULL,  -- 'I', 'U', 'D', 'A'
    model_name      VARCHAR(50) NOT NULL,
    model_id        UUID NOT NULL,
    data            JSONB,  -- null for deletes

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_actions_org ON sync_actions(organization_id, id);
CREATE INDEX idx_sync_actions_model ON sync_actions(model_name, model_id);

-- Partition by organization for scale (optional)
-- Prune old entries (>30 days) via background job
```

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

### 2.24 Audit Log

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

---

## 3. Entity Relationship Summary

```
organizations 1──* teams
organizations 1──* users (via organization_members)
organizations 1──* projects
organizations 1──* initiatives
organizations 1──* issue_labels
organizations 1──* templates
organizations 1──* custom_views
organizations 1──* webhooks

teams 1──* issues
teams 1──* workflow_states
teams 1──* cycles
teams 1──* team_memberships
teams *──* projects (via project_teams)
teams 0..1──* teams (parent/child)

issues *──1 workflow_states (state)
issues *──0..1 users (assignee)
issues *──0..1 projects
issues *──0..1 cycles
issues *──0..1 issues (parent)
issues *──* issue_labels (via issue_label_assignments)
issues 1──* comments
issues 1──* attachments
issues 1──* issue_relations
issues 1──* issue_history
issues 1──* notifications

projects 1──* project_milestones
projects 1──* project_updates
projects *──* users (via project_members)

initiatives *──* projects (via initiative_projects)
initiatives 0..1──* initiatives (parent/child)

users 1──* favorites
users 1──* notifications
users 1──* auth_tokens
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

> **Note:** The `Team` model in `prisma/schema.prisma` is a minimal stub (Sprint 1-2) with only `id`, `organizationId`, `name`, `key`, and lifecycle fields. The full `teams` table definition in section 2.2 above represents the Sprint 3-4 target. Additional columns will be added via Prisma migrations in Sprint 3-4.

### Migration Files

Use Prisma migrations for schema management:

```
prisma/
├── schema.prisma
└── migrations/
    ├── 0001_create_organizations/migration.sql
    ├── 0002_create_users/migration.sql
    ├── 0003_create_teams/migration.sql
    ├── 0004_create_workflow_states/migration.sql
    ├── 0005_create_issues/migration.sql
    ├── 0006_create_labels/migration.sql
    ├── 0007_create_comments/migration.sql
    ├── 0008_create_relations/migration.sql
    ├── 0009_create_history/migration.sql
    ├── 0010_create_projects/migration.sql
    ├── 0011_create_milestones/migration.sql
    ├── 0012_create_project_updates/migration.sql
    ├── 0013_create_cycles/migration.sql
    ├── 0014_create_initiatives/migration.sql
    ├── 0015_create_attachments/migration.sql
    ├── 0016_create_reactions/migration.sql
    ├── 0017_create_notifications/migration.sql
    ├── 0018_create_custom_views/migration.sql
    ├── 0019_create_favorites/migration.sql
    ├── 0020_create_documents/migration.sql
    ├── 0021_create_templates/migration.sql
    ├── 0022_create_webhooks/migration.sql
    ├── 0023_create_sync_actions/migration.sql
    ├── 0024_create_auth_tokens/migration.sql
    ├── 0025_create_audit_entries/migration.sql
    └── 0026_add_foreign_keys/migration.sql
```
