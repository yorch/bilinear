-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug_id" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT,
    "icon" VARCHAR(255),
    "color" VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    "status_type" VARCHAR(20) NOT NULL DEFAULT 'planned',
    "status_name" VARCHAR(255),
    "health" VARCHAR(20),
    "health_updated_at" TIMESTAMPTZ,
    "priority" SMALLINT NOT NULL DEFAULT 0,
    "priority_sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scope" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "start_date" DATE,
    "target_date" DATE,
    "start_date_resolution" VARCHAR(20),
    "target_date_resolution" VARCHAR(20),
    "lead_id" UUID,
    "creator_id" UUID,
    "completed_issue_count_history" JSONB NOT NULL DEFAULT '[]',
    "completed_scope_history" JSONB NOT NULL DEFAULT '[]',
    "issue_count_history" JSONB NOT NULL DEFAULT '[]',
    "scope_history" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "canceled_at" TIMESTAMPTZ,
    "auto_archived_at" TIMESTAMPTZ,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "project_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "target_date" DATE,
    "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "body_data" JSONB NOT NULL,
    "health" VARCHAR(20) NOT NULL,
    "diff" JSONB,
    "diff_markdown" TEXT,
    "edited_at" TIMESTAMPTZ,
    "reaction_data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "project_updates_pkey" PRIMARY KEY ("id")
);

-- Add project_milestone_id column to issues
ALTER TABLE "issues" ADD COLUMN "project_milestone_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_id_key" ON "projects"("slug_id");
CREATE INDEX "idx_projects_org" ON "projects"("organization_id");
CREATE INDEX "idx_projects_status" ON "projects"("status_type");
CREATE INDEX "idx_projects_lead" ON "projects"("lead_id");

CREATE UNIQUE INDEX "project_teams_project_id_team_id_key" ON "project_teams"("project_id", "team_id");
CREATE INDEX "idx_project_teams_project" ON "project_teams"("project_id");
CREATE INDEX "idx_project_teams_team" ON "project_teams"("team_id");

CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");
CREATE INDEX "idx_project_members_project" ON "project_members"("project_id");
CREATE INDEX "idx_project_members_user" ON "project_members"("user_id");

CREATE INDEX "idx_project_milestones_project" ON "project_milestones"("project_id");

CREATE INDEX "idx_project_updates_project" ON "project_updates"("project_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Add FK constraints for issue -> project and issue -> project_milestone
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_milestone_id_fkey" FOREIGN KEY ("project_milestone_id") REFERENCES "project_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
