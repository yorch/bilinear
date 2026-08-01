# Database Schema Design

## Issue Tracker — Linear Rebuild

**Version:** 1.6
**Date:** 2026-05-21
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
| 2.18 Favorites            | ✅      | Shipped 2026-05-21 — `favorites`, see §2.18                                                           |
| 2.19 Documents            | ✅      | Parent hierarchy, editor output in `content` TEXT; no YJS yet                                         |
| 2.20 Issue Templates      | ⚠️      | Real model is issue-only (not polymorphic)                                                            |
| 2.21 Webhooks             | ✅      | Shipped 2026-05-05 — `webhooks` + `webhook_deliveries`                                                |
| 2.22 Sync Actions         | ✅      |                                                                                                       |
| 2.23 Auth Tokens          | ✅      |                                                                                                       |
| 2.24 Audit Log            | ✅      | Shipped 2026-06-06 — see §2.34 for the actual `audit_log_entries` schema                              |
| 2.25 Files                | ✅      |                                                                                                       |
| 2.26 Team Member Roles    | ✅      | Enforcement helper `requireTeamMemberNotGuest` shipped 2026-05-21                                     |
| 2.27 Custom Fields        | ✅      | Workspace-scope (team_id nullable) shipped 2026-05-21                                                 |
| 2.28 Public Roadmaps      | ✅      |                                                                                                       |
| 2.29 GitHub Integration   | ✅      | Shipped 2026-05-17 — `github_integrations` + `github_pull_requests`                                   |
| 2.30 Issue Reactions      | ✅      | Shipped 2026-05-18 — `issue_reactions`, mirrors §2.15                                                 |
| 2.31 Initiative Updates   | ✅      | Shipped 2026-05-18 — `initiative_updates`, mirrors §2.11                                              |
| 2.32 Sub-Initiatives      | ✅      | Shipped 2026-05-21 — `initiatives.parent_id` self-relation, max depth 5                               |
| 2.33 Automation Rules     | ✅      | Shipped 2026-05-24 — `automation_rules` with JSONB conditions/actions; no separate log table           |
| 2.34 Audit Log Entries    | ✅      | Shipped 2026-06-06 — `audit_log_entries` append-only table, see §2.34                                 |
| 2.35 SAML Configurations  | ✅      | Shipped 2026-06-06 — `saml_configurations` one-per-org, see §2.35                                     |
| 2.36 SCIM Tokens          | ✅      | Shipped 2026-06-06 — `scim_tokens` bearer auth for SCIM provisioning, see §2.36                       |

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
    github_id       VARCHAR(255),  -- numeric GitHub user id, stored as string

    -- Notification preferences
    email_notifications_enabled  BOOLEAN NOT NULL DEFAULT true,

    -- Persisted UI/email language preference (app locale, e.g. 'en'/'es').
    -- Written by userUpdateLocale when the user switches language; null = never
    -- set -> transactional emails fall back to the app default locale. Distinct
    -- from the browser `locale` cookie, which drives the UI but never reaches
    -- server-side email rendering. See PATTERNS.md §75.1.
    locale          VARCHAR(10),

    -- iCal cycle feed token (32-byte random hex, rotated via userCalendarFeedTokenRotate)
    calendar_feed_token          VARCHAR(64) UNIQUE,

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
    -- Snooze (mutations shipped 2026-05-21): list/board views hide
    -- snoozed issues until now() >= snoozed_until_at. No background
    -- worker — wakeup is a function of read-time comparison.
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
> computed as the mean of associated projects' progress AND child initiative
> progress (added 2026-05-21); recompute fires on project create/archive/delete,
> on project status/progress changes, and propagates up the parent chain.
> Sub-initiatives via `parent_id` shipped 2026-05-21 (see §2.32).

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
    parent_id              UUID REFERENCES initiatives(id) ON DELETE SET NULL,  -- sub-initiatives, max depth 5

    progress               FLOAT NOT NULL DEFAULT 0,  -- 0..1, recomputed from linked projects + child initiatives

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
-- Reactions on issues shipped 2026-05-18 — see §2.30 (issue_reactions).
-- Reactions on project updates remain deferred.
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

### 2.18 Favorites ✅

> **Shipped 2026-05-21** — squashed into baseline migration `00000000000000_init`.

```sql
CREATE TABLE favorites (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- Issue | Project | Initiative | CustomView | Cycle | Document | Team
    entity_type     VARCHAR(20) NOT NULL,
    entity_id       UUID NOT NULL,
    sort_order      DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX favorites_user_entity_uniq
  ON favorites(user_id, entity_type, entity_id);
CREATE INDEX favorites_user_id_idx ON favorites(user_id);
CREATE INDEX favorites_organization_id_idx ON favorites(organization_id);
```

The simpler shape replaces the earlier polymorphic-fields proposal: instead
of one nullable FK per target type, a single `(entity_type, entity_id)` pair
identifies the target. The resolver layer dispatches per-type to fetch the
row (see `src/server/graphql/resolvers/favorite.ts`); broken references
(deleted entity / cross-org) resolve to `null` and are skipped silently in
the sidebar.

Folders (one level of nesting) are intentionally deferred — Linear's
"folder" support adds non-trivial drag-drop complexity that's not worth the
schema churn until users ask for it. When added, a `parent_id` self-FK
will suffice and `entity_type = 'Folder'` rows will hold the folder name.

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
> ever read or wrote it. It was dropped before the baseline migration was
> consolidated, so it does not appear in `00000000000000_init`.

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

Definitions are scoped either to a single team (`team_id` non-null) or to
the whole workspace (`team_id` null, `organization_id` non-null —
shipped 2026-05-21). Workspace-scoped definitions surface on every team
in the org; only org owners/admins can create/edit them. Values live in
a separate table (`custom_field_values`) keyed by
`(issue_id, definition_id)` so filter/sort stay indexable.

```sql
CREATE TYPE custom_field_type AS ENUM (
    'text', 'number', 'date',
    'select', 'multi_select',
    'url', 'checkbox'
);

CREATE TABLE custom_field_definitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Null = workspace-scoped (applies to every team in organization_id).
    team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
    -- Denormalised from team.organization_id for team-scoped rows; required
    -- for workspace-scoped rows so the tenant filter is a single column.
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    type            custom_field_type NOT NULL,
    description     TEXT,
    required        BOOLEAN NOT NULL DEFAULT FALSE,
    -- For select / multi_select: JSONB array of { value, label, color? }.
    -- NULL for other types; service layer rejects options on non-select types.
    options         JSONB,
    sort_order      DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_custom_field_definitions_team ON custom_field_definitions(team_id);
CREATE INDEX idx_custom_field_definitions_organization ON custom_field_definitions(organization_id);

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
- Max 30 active workspace-scoped (`team_id IS NULL`) definitions per org
- `select` / `multi_select` types require at least one option; option values must be unique per field
- Non-select types reject options
- Value type and allowed-option membership are validated before upsert
- Workspace-scoped create/edit requires `OrganizationMember.role IN ('owner', 'admin')`

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

### 2.30 Issue Reactions ✅

Emoji reactions on issues. Mirrors §2.15 (Comment Reactions) one-for-one — same
normalized shape, same unique tuple semantics, FK CASCADE on both sides.

```sql
CREATE TABLE issue_reactions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id   UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(issue_id, user_id, emoji)
);
CREATE INDEX idx_issue_reactions_issue ON issue_reactions(issue_id);
CREATE INDEX idx_issue_reactions_user  ON issue_reactions(user_id);
```

The unused `Issue.reaction_data` JSONB column is kept in place for backwards
compatibility but no longer written or read. See PATTERNS.md §42.

### 2.31 Initiative Updates ✅

Status reports posted against an initiative — same shape as §2.11 (Project
Updates), without the `diff` / `diffMarkdown` audit columns that ProjectUpdate
inherited from earlier project-snapshot work. Soft-delete via `archived_at`.

```sql
CREATE TABLE initiative_updates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id),
    body          TEXT NOT NULL,
    body_data     JSONB NOT NULL,
    health        VARCHAR(20) NOT NULL,  -- onTrack | atRisk | offTrack
    edited_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at   TIMESTAMPTZ
);
CREATE INDEX idx_initiative_updates_initiative ON initiative_updates(initiative_id);
```

Resolver enforces author-only edit / delete (`existing.userId === ctx.userId`).
Soft-delete emits a `'D'` SyncAction with null payload, matching ProjectUpdate
delete semantics. See PATTERNS.md §43.

### 2.32 Sub-initiatives ✅

> **Shipped 2026-05-21** — squashed into baseline migration `00000000000000_init`.

A single nullable self-FK on `initiatives.parent_id` enables hierarchical
strategic trees. The progress rollup in §2.13 averages direct projects AND
non-archived child initiatives equally (i.e. one child counts the same as
one direct project), and propagates one level up the parent chain after
each recompute — recursion terminates naturally when a level reports
"no change".

```sql
ALTER TABLE initiatives ADD COLUMN parent_id UUID;
CREATE INDEX initiatives_parent_id_idx ON initiatives(parent_id);
ALTER TABLE initiatives ADD CONSTRAINT initiatives_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES initiatives(id) ON DELETE SET NULL;
```

**Service-layer invariants** (enforced in `InitiativeService.assertParent`
AcceptsChild`):

- max depth = 5 (constant `MAX_INITIATIVE_DEPTH`)
- no cycles: a re-parent that would put the initiative under one of its
  own descendants throws `InitiativeInvalidParentError`
- cross-org rejected: parent must belong to the same `organization_id`

`ON DELETE SET NULL` is intentional: deleting a parent re-roots its
children rather than cascading the delete — losing strategic tree branches
on accidental parent deletion is too destructive.

### 2.33 Automation Rules ✅

> **Shipped 2026-05-24** — squashed into baseline migration `00000000000000_init`.

Rules engine with JSONB-embedded conditions and actions; no separate
condition/action rows. Conditions and actions are stored as typed JSON
arrays evaluated at trigger time by `AutomationService`.

```sql
CREATE TABLE automation_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,  -- NULL = workspace-wide rule

  name            VARCHAR(255) NOT NULL,
  description     TEXT,

  trigger_type    VARCHAR(50) NOT NULL,
  trigger_config  JSONB NOT NULL DEFAULT '{}',

  -- JSON array of condition objects: { field, operator, value }
  conditions      JSONB,

  -- JSON array of action objects: { type, config }
  actions         JSONB NOT NULL DEFAULT '[]',

  enabled         BOOLEAN NOT NULL DEFAULT true,
  sort_order      FLOAT NOT NULL DEFAULT 0,

  -- Aggregate run stats stored on the rule; no separate log table
  last_run_at     TIMESTAMPTZ,
  run_count       INTEGER NOT NULL DEFAULT 0,

  created_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL,
  archived_at     TIMESTAMPTZ
);

CREATE INDEX automation_rules_org_enabled_idx ON automation_rules(organization_id, enabled);
CREATE INDEX automation_rules_team_enabled_idx ON automation_rules(team_id, enabled);
CREATE INDEX automation_rules_trigger_type_idx ON automation_rules(trigger_type);
```

**Trigger types** (string constant in `AutomationService`):

| Trigger | Fires when |
|---------|-----------|
| `issue_created` | New issue is created |
| `issue_state_changed` | Issue workflow state changes |
| `issue_priority_changed` | Issue priority changes |
| `issue_assignee_changed` | Issue assignee changes |
| `comment_created` | Comment is posted on an issue |

**Condition fields**: `assigneeId`, `labelId`, `priority`, `stateCategory`, `stateId`, `teamId`

**Action types**: `set_state`, `set_assignee`, `set_priority`, `add_label`, `post_comment`

**Design notes:**

- `team_id IS NULL` = workspace-wide rule (applies to all teams in the org). Org admins only.
- `trigger_config` holds trigger-specific parameters (e.g. which state the issue must transition *to*).
- `conditions` is a nullable array — if null the rule fires unconditionally on the trigger.
- Rule execution runs inline in the mutation path; a BullMQ `automation-dispatch` queue is planned but not yet wired (Sprint 39-40 note).
- No separate audit log table — `last_run_at` + `run_count` on the rule are the only telemetry. Full execution logs are a future §2.24-style addition.
- SyncAction is emitted with `modelName: 'AutomationRule'` on every create/update/archive so the client store stays in sync.

### 2.9a Project progress history columns

The four JSONB history columns on `projects` — `completed_issue_count_history`,
`issue_count_history`, `completed_scope_history`, `scope_history` — landed
empty in §2.9 (`@default("[]")`). `ProjectService.recordProgressSnapshotIfStale`
is the writer; it runs lazily on every `Project.progressHistory` read and
no-ops when the latest entry's `t` is today's UTC date. Each entry has the
shape `{ t: 'YYYY-MM-DD', v: <number> }`; once stamped, the day's value is
fixed (no intra-day overwrite — sparkline shows day-resolution trend).

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

**While the app is unreleased there are exactly two migrations, and that is
deliberate.** Anything Prisma's schema DSL can express is folded back into a
regenerated `00000000000000_init` rather than stacking an additive migration on
top; only DDL Prisma *cannot* express gets its own file. There is no deployed
database whose history would be invalidated, so a two-file baseline stays far
easier to read than a growing chain of one-line `ALTER`s.

```
prisma/
├── schema.prisma
├── prisma.config.ts                              -- CLI datasource url (Prisma 7)
└── migrations/
    ├── 00000000000000_init/                      -- consolidated baseline, generated
    │                                             --   verbatim from schema.prisma:
    │                                             --   every table, column, FK, enum,
    │                                             --   and schema-expressible index
    └── 00000000000001_custom_constraints_and_triggers/
                                                  -- hand-written DDL Prisma can't express:
                                                  --   partial/expression indexes (incl. the
                                                  --   teams(org, key) WHERE archived_at IS
                                                  --   NULL unique), the FTS GIN index and
                                                  --   trigger, the sync_actions committed_at
                                                  --   trigger, check constraints, and the
                                                  --   String[] NOT NULL guards
```

**Regenerating the baseline** (no database required — it diffs an empty
datamodel against the schema file):

```bash
yarn prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script \
  > prisma/migrations/00000000000000_init/migration.sql
```

> Prisma 7 renamed `--to-schema-datamodel` to `--to-schema`; the old flag now
> exits non-zero with a usage dump rather than a helpful alias error.

**Verifying the pair** against a throwaway Postgres before merging a schema
change — this is the check `prisma migrate diff` alone cannot do, because it is
blind to everything in the custom file:

```bash
docker run -d --name mig-verify -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=bilinear \
  -p 55432:5432 postgres:17-alpine
export DATABASE_URL="postgresql://postgres:pg@127.0.0.1:55432/bilinear?schema=public"
yarn prisma migrate deploy                     # both migrations apply cleanly
yarn prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --exit-code                                  # must print "empty migration", exit 0
yarn db:seed                                   # schema is actually usable
```

Then confirm the custom objects exist, since a no-op custom migration would pass
every check above:

```sql
SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexdef ILIKE '%WHERE%';
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;
```

> **Note:** `yarn db:push` re-applies schema.prisma but silently drops all custom DDL
> (partial indexes, FTS triggers, check constraints) that lives in
> `00000000000001_custom_constraints_and_triggers`. Use `yarn db:migrate` or
> `yarn db:reset` for local development; `db:push` is safe only for rapid
> schema prototyping before any custom migration SQL is needed.

Tables tagged 📋 in §1.1 (Favorites, Attachments as linked resources, Audit Log)
are **design targets** — kept in §2 as the canonical design reference for when
those sprints land.

### 2.34 Audit Log Entries ✅

Append-only table for security-relevant event records. Never updated or soft-deleted.

```sql
CREATE TABLE audit_log_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(100) NOT NULL,       -- e.g. 'auth.login', 'team.deleted'
    resource_type   VARCHAR(50),                 -- e.g. 'Issue', 'Team'
    resource_id     VARCHAR(36),                 -- UUID of the affected row
    metadata        JSONB,                       -- event-specific payload
    ip_address      VARCHAR(45),                 -- IPv4 or IPv6
    user_agent      VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- no updated_at — append-only
);

CREATE INDEX idx_audit_log_org_created
    ON audit_log_entries (organization_id, created_at DESC);
```

Key properties:
- Written fire-and-forget via `AuditLogService.log()` — errors are swallowed so audit failure never breaks the main request.
- `user_id` is nullable for system-originated events.
- Queried via `auditLogs(filter)` GraphQL query; owner/admin only.
- Settings page at `/(workspace)/[workspace]/settings/audit-log`.

### 2.35 SAML Configurations ✅

One-per-organization SAML 2.0 SP configuration.

```sql
CREATE TABLE saml_configurations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    idp_metadata_url VARCHAR(1000),
    idp_metadata_xml TEXT,
    idp_sso_url      VARCHAR(1000) NOT NULL DEFAULT '',
    idp_entity_id    VARCHAR(500) NOT NULL DEFAULT '',
    idp_cert         TEXT NOT NULL DEFAULT '',     -- PEM certificate
    email_attribute  VARCHAR(255) NOT NULL DEFAULT 'email',
    name_attribute   VARCHAR(255) NOT NULL DEFAULT 'name',
    jit_provisioning BOOLEAN NOT NULL DEFAULT TRUE,
    sso_enforced     BOOLEAN NOT NULL DEFAULT FALSE,
    enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Key properties:
- UNIQUE on `organization_id` — one config per org.
- `enabled` controls whether SSO is active. `sso_enforced` (future) would require SSO-only login.
- Service: `SamlService` in `src/server/services/saml.service.ts`.
- Routes: `GET /api/auth/saml/metadata`, `GET /api/auth/saml/initiate`, `POST /api/auth/saml/callback`.

### 2.36 SCIM Tokens ✅

Bearer tokens for SCIM 2.0 provisioning API authentication.

```sql
CREATE TABLE scim_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token_hash      VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hex of plaintext
    label           VARCHAR(255) NOT NULL,
    created_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,                  -- soft-revoke
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Key properties:
- Plaintext token is 64-char hex (`crypto.randomBytes(32).toString('hex')`), shown once at creation.
- Only `token_hash` (SHA-256) is stored — plaintext is unrecoverable after creation.
- Revoked via `revokedAt` timestamp — `authenticateScimToken` rejects revoked tokens.
- SCIM base URL: `<APP_URL>/api/scim/v2`.
- Service: `ScimService` in `src/server/services/scim.service.ts`.

### 2.37 Platform Admin ✅

Cross-tenant operator layer (see PATTERNS.md §74). Adds a global privilege flag, org suspension state, and a platform-level audit trail.

```sql
-- global operator flag (no role tier above org owner)
ALTER TABLE users ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- org suspension, distinct from soft-delete (archived_at)
ALTER TABLE organizations ADD COLUMN suspended_at      TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN suspended_reason  TEXT;

-- write-once audit trail for cross-tenant actions (not org-scoped)
CREATE TABLE platform_audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,  -- nullable: trail survives admin deletion
    action      VARCHAR(64) NOT NULL,       -- tenant.suspended, user.impersonated, …
    target_type VARCHAR(32),                -- 'Organization' | 'User'
    target_id   UUID,
    metadata    JSONB,
    ip_address  VARCHAR(45),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON platform_audit_logs (created_at);
CREATE INDEX ON platform_audit_logs (actor_id);
```

Key properties:
- `is_platform_admin` is bootstrapped to `true` for the first user in an empty DB (`UserService.findOrCreate`), then managed via the `/admin` console. Never revocable below one admin (last-admin guard).
- `suspended_at` locks members out (enforced in `extractAuthContext`) without deleting data; `archived_at` is the soft-delete used by "delete tenant".
- `platform_audit_logs` is deliberately org-agnostic — its actor operates above any tenant. Written best-effort by `PlatformAdminService.recordAudit` and the impersonation routes.
- Service: `PlatformAdminService` in `src/server/services/platform-admin.service.ts`.

### 2.38 Org-scoped API keys ✅

Binds `auth_tokens` rows of type `api_key` to the organization they were
created in (see PATTERNS.md §77). Migration:
`00000000000003_auth_token_organization`.

```sql
ALTER TABLE auth_tokens ADD COLUMN organization_id UUID;
ALTER TABLE auth_tokens
  ADD CONSTRAINT auth_tokens_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX auth_tokens_organization_id_idx ON auth_tokens (organization_id);
```

Key properties:
- Written for `api_key` **and** `refresh` rows — both are credentials bound
  to one tenant. For an API key it is the workspace the key acts on; for a
  refresh token it is the workspace the session belongs to, read back on
  rotation so a switched multi-org session isn't dragged to a different org
  the next time its access token expires. `magic_link` rows never set it:
  they identify a user before any org is chosen.
- Nullable by necessity, not by preference: rows predating the column carry
  no org. `extractAuthContext` resolves those to a null `orgId` and lets
  `requireAuth` reject them rather than substituting a guess — the previous
  behavior (the creator's oldest membership) pointed a multi-org user's key
  at the wrong tenant.
- `ON DELETE CASCADE` matches every other organization-owned table: dropping
  an org takes its API keys with it instead of leaving rows that authenticate
  into nothing.
- The membership re-check in `extractAuthContext` applies to API-key requests
  too, so revoking someone's org membership also disarms the keys they
  created there — without needing to find and revoke each key.

### 2.39 Organization Invites ✅

Pending invitations to join an organization (see PATTERNS.md §78). Migration:
`00000000000004_organization_invites`.

```sql
CREATE TABLE organization_invites (
    id              UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,   -- lowercased at write time
    role            VARCHAR(20) NOT NULL DEFAULT 'member',
    token_hash      VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256(raw token)
    invited_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ,             -- non-null = spent (single use)
    accepted_by_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON organization_invites (organization_id);
CREATE INDEX ON organization_invites (organization_id, email);
```

Key properties:
- Only the token *hash* is stored; the raw token exists solely in the
  invitation email. Same treatment as `auth_tokens` magic-link codes and
  `scim_tokens`.
- **No UNIQUE on `(organization_id, email)`** — re-inviting after a revoked
  or expired invitation is ordinary, and a partial unique index (pending rows
  only) can't be expressed in Prisma. `OrganizationInviteService.create`
  revokes any outstanding invitation for the pair in the same transaction
  instead. The `(organization_id, email)` index serves that lookup; it is not
  a constraint.
- `invited_by_id`/`accepted_by_id` are `SET NULL` so deleting a user never
  erases the invitation record — same reasoning as
  `platform_audit_logs.actor_id`.
- Acceptance is single-use and claimed atomically via an `updateMany` scoped
  to `accepted_at IS NULL`, and requires the accepting session's email to
  match `email`.
- 7-day expiry (`INVITE_EXPIRY_DAYS`), 200 outstanding invitations per org
  (`MAX_PENDING_INVITES`) as a mail-relay blast-radius bound.

