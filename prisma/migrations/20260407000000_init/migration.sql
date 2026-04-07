-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "url_key" VARCHAR(63) NOT NULL,
    "logo_url" TEXT,
    "data_region" VARCHAR(2) NOT NULL DEFAULT 'US',
    "roadmap_enabled" BOOLEAN NOT NULL DEFAULT false,
    "customers_enabled" BOOLEAN NOT NULL DEFAULT false,
    "initiatives_enabled" BOOLEAN NOT NULL DEFAULT false,
    "security_settings" JSONB NOT NULL DEFAULT '{}',
    "auth_settings" JSONB NOT NULL DEFAULT '{}',
    "theme_settings" JSONB,
    "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "initials" VARCHAR(4) NOT NULL,
    "avatar_url" TEXT,
    "avatar_bg_color" VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen" TIMESTAMPTZ,
    "timezone" VARCHAR(63),
    "status_emoji" VARCHAR(32),
    "status_label" VARCHAR(255),
    "status_until_at" TIMESTAMPTZ,
    "password_hash" TEXT,
    "google_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "token_hash" TEXT NOT NULL,
    "code" VARCHAR(6),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "label" VARCHAR(255),
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "key" VARCHAR(10) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(255),
    "color" VARCHAR(7),
    "private" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" UUID,
    "timezone" VARCHAR(63) NOT NULL DEFAULT 'UTC',
    "cycles_enabled" BOOLEAN NOT NULL DEFAULT false,
    "cycle_duration" INTEGER DEFAULT 2,
    "cycle_cooldown_time" INTEGER DEFAULT 0,
    "cycle_start_day" INTEGER DEFAULT 1,
    "cycle_lock_to_active" BOOLEAN NOT NULL DEFAULT false,
    "cycle_auto_assign_started" BOOLEAN NOT NULL DEFAULT false,
    "cycle_auto_assign_completed" BOOLEAN NOT NULL DEFAULT false,
    "auto_close_period" INTEGER,
    "auto_close_state_id" UUID,
    "auto_archive_period" INTEGER,
    "auto_close_child_issues" BOOLEAN NOT NULL DEFAULT false,
    "auto_close_parent_issues" BOOLEAN NOT NULL DEFAULT false,
    "issue_estimation_type" VARCHAR(20) NOT NULL DEFAULT 'notUsed',
    "issue_estimation_extended" BOOLEAN NOT NULL DEFAULT false,
    "issue_estimation_allow_zero" BOOLEAN NOT NULL DEFAULT false,
    "default_issue_estimate" DOUBLE PRECISION,
    "default_issue_state_id" UUID,
    "triage_enabled" BOOLEAN NOT NULL DEFAULT false,
    "issue_count" INTEGER NOT NULL DEFAULT 0,
    "join_by_default" BOOLEAN NOT NULL DEFAULT false,
    "retired_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_states" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "description" TEXT,
    "type" VARCHAR(20) NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "identifier" VARCHAR(20) NOT NULL,
    "previous_identifiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" VARCHAR(1000) NOT NULL,
    "description" TEXT,
    "description_state" BYTEA,
    "priority" SMALLINT NOT NULL DEFAULT 0,
    "estimate" DOUBLE PRECISION,
    "due_date" DATE,
    "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priority_sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sub_issue_sort_order" DOUBLE PRECISION,
    "state_id" UUID NOT NULL,
    "assignee_id" UUID,
    "creator_id" UUID,
    "parent_id" UUID,
    "project_id" UUID,
    "cycle_id" UUID,
    "branch_name" VARCHAR(500),
    "sla_breaches_at" TIMESTAMPTZ,
    "sla_high_risk_at" TIMESTAMPTZ,
    "sla_medium_risk_at" TIMESTAMPTZ,
    "sla_started_at" TIMESTAMPTZ,
    "sla_type" VARCHAR(50),
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "canceled_at" TIMESTAMPTZ,
    "auto_archived_at" TIMESTAMPTZ,
    "auto_closed_at" TIMESTAMPTZ,
    "started_triage_at" TIMESTAMPTZ,
    "triaged_at" TIMESTAMPTZ,
    "added_to_cycle_at" TIMESTAMPTZ,
    "added_to_project_at" TIMESTAMPTZ,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "snoozed_by_id" UUID,
    "snoozed_until_at" TIMESTAMPTZ,
    "reaction_data" JSONB NOT NULL DEFAULT '{}',
    "customer_ticket_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_labels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "team_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "description" TEXT,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" UUID,
    "creator_id" UUID,
    "last_applied_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "issue_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_actions" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "action" VARCHAR(1) NOT NULL,
    "model_name" VARCHAR(50) NOT NULL,
    "model_id" UUID NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_label_assignments" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_label_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_url_key_key" ON "organizations"("url_key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_idx" ON "organization_members"("organization_id");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_idx" ON "auth_tokens"("user_id");

-- CreateIndex
CREATE INDEX "auth_tokens_token_hash_idx" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "teams_organization_id_idx" ON "teams"("organization_id");

-- CreateIndex
CREATE INDEX "teams_parent_id_idx" ON "teams"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organization_id_key_key" ON "teams"("organization_id", "key");

-- CreateIndex
CREATE INDEX "team_memberships_team_id_idx" ON "team_memberships"("team_id");

-- CreateIndex
CREATE INDEX "team_memberships_user_id_idx" ON "team_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_memberships_team_id_user_id_key" ON "team_memberships"("team_id", "user_id");

-- CreateIndex
CREATE INDEX "workflow_states_team_id_idx" ON "workflow_states"("team_id");

-- CreateIndex
CREATE INDEX "workflow_states_team_id_type_idx" ON "workflow_states"("team_id", "type");

-- CreateIndex
CREATE INDEX "issues_organization_id_idx" ON "issues"("organization_id");

-- CreateIndex
CREATE INDEX "issues_team_id_idx" ON "issues"("team_id");

-- CreateIndex
CREATE INDEX "issues_state_id_idx" ON "issues"("state_id");

-- CreateIndex
CREATE INDEX "issues_assignee_id_idx" ON "issues"("assignee_id");

-- CreateIndex
CREATE INDEX "issues_project_id_idx" ON "issues"("project_id");

-- CreateIndex
CREATE INDEX "issues_cycle_id_idx" ON "issues"("cycle_id");

-- CreateIndex
CREATE INDEX "issues_parent_id_idx" ON "issues"("parent_id");

-- CreateIndex
CREATE INDEX "issues_identifier_idx" ON "issues"("identifier");

-- CreateIndex
CREATE INDEX "issues_team_id_priority_idx" ON "issues"("team_id", "priority");

-- CreateIndex
CREATE INDEX "issues_team_id_created_at_idx" ON "issues"("team_id", "created_at");

-- CreateIndex
CREATE INDEX "issues_updated_at_idx" ON "issues"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "issues_team_id_number_key" ON "issues"("team_id", "number");

-- CreateIndex
CREATE INDEX "issue_labels_organization_id_idx" ON "issue_labels"("organization_id");

-- CreateIndex
CREATE INDEX "issue_labels_team_id_idx" ON "issue_labels"("team_id");

-- CreateIndex
CREATE INDEX "issue_labels_parent_id_idx" ON "issue_labels"("parent_id");

-- CreateIndex
CREATE INDEX "sync_actions_organization_id_id_idx" ON "sync_actions"("organization_id", "id");

-- CreateIndex
CREATE INDEX "sync_actions_created_at_idx" ON "sync_actions"("created_at");

-- CreateIndex
CREATE INDEX "issue_label_assignments_issue_id_idx" ON "issue_label_assignments"("issue_id");

-- CreateIndex
CREATE INDEX "issue_label_assignments_label_id_idx" ON "issue_label_assignments"("label_id");

-- CreateIndex
CREATE UNIQUE INDEX "issue_label_assignments_issue_id_label_id_key" ON "issue_label_assignments"("issue_id", "label_id");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_snoozed_by_id_fkey" FOREIGN KEY ("snoozed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "issue_labels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_actions" ADD CONSTRAINT "sync_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_label_assignments" ADD CONSTRAINT "issue_label_assignments_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_label_assignments" ADD CONSTRAINT "issue_label_assignments_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "issue_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
