-- Sprint 19-22: Notifications, Issue Relations, Issue Activities, Templates, Files
-- Also fixes accumulated schema drift from db:push (index renames, FK corrections, defaults)

-- DropForeignKey (will be re-added with correct definitions below)
ALTER TABLE "comment_reactions" DROP CONSTRAINT "comment_reactions_comment_id_fkey";
ALTER TABLE "comment_reactions" DROP CONSTRAINT "comment_reactions_user_id_fkey";
ALTER TABLE "comments" DROP CONSTRAINT "comments_author_id_fkey";
ALTER TABLE "comments" DROP CONSTRAINT "comments_issue_id_fkey";
ALTER TABLE "comments" DROP CONSTRAINT "comments_parent_id_fkey";
ALTER TABLE "comments" DROP CONSTRAINT "comments_resolved_by_id_fkey";
ALTER TABLE "project_updates" DROP CONSTRAINT "project_updates_user_id_fkey";
ALTER TABLE "team_member_roles" DROP CONSTRAINT "team_member_roles_team_id_fkey";
ALTER TABLE "team_member_roles" DROP CONSTRAINT "team_member_roles_user_id_fkey";

-- DropIndex
DROP INDEX "projects_slug_id_key";

-- AlterTable (drop stale defaults that schema.prisma no longer generates)
ALTER TABLE "comment_reactions" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "comments" ALTER COLUMN "id" DROP DEFAULT,
                        ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "project_members" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "project_milestones" ALTER COLUMN "id" DROP DEFAULT,
                                  ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "project_teams" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "project_updates" ALTER COLUMN "id" DROP DEFAULT,
                               ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "projects" ALTER COLUMN "id" DROP DEFAULT,
                        ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "team_member_roles" ALTER COLUMN "id" DROP DEFAULT,
                                 ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable: Notifications
CREATE TABLE "notifications" (
    "id"               UUID         NOT NULL,
    "organization_id"  UUID         NOT NULL,
    "user_id"          UUID         NOT NULL,
    "issue_id"         UUID,
    "actor_id"         UUID,
    "type"             VARCHAR(50)  NOT NULL,
    "data"             JSONB        NOT NULL DEFAULT '{}',
    "read"             BOOLEAN      NOT NULL DEFAULT false,
    "read_at"          TIMESTAMPTZ,
    "snoozed_until_at" TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Notification Subscriptions
CREATE TABLE "notification_subscriptions" (
    "id"         UUID         NOT NULL,
    "user_id"    UUID         NOT NULL,
    "issue_id"   UUID         NOT NULL,
    "active"     BOOLEAN      NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "notification_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Issue Activities
CREATE TABLE "issue_activities" (
    "id"         UUID         NOT NULL,
    "issue_id"   UUID         NOT NULL,
    "actor_id"   UUID,
    "field"      VARCHAR(50)  NOT NULL,
    "old_value"  TEXT,
    "new_value"  TEXT,
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Issue Relations
CREATE TABLE "issue_relations" (
    "id"               UUID         NOT NULL,
    "issue_id"         UUID         NOT NULL,
    "related_issue_id" UUID         NOT NULL,
    "type"             VARCHAR(20)  NOT NULL,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Issue Templates
CREATE TABLE "issue_templates" (
    "id"            UUID          NOT NULL,
    "team_id"       UUID          NOT NULL,
    "creator_id"    UUID,
    "name"          VARCHAR(255)  NOT NULL,
    "description"   TEXT,
    "template_data" JSONB         NOT NULL DEFAULT '{}',
    "is_default"    BOOLEAN       NOT NULL DEFAULT false,
    "created_at"    TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ   NOT NULL,
    "archived_at"   TIMESTAMPTZ,

    CONSTRAINT "issue_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Files
CREATE TABLE "files" (
    "id"          UUID           NOT NULL,
    "issue_id"    UUID,
    "project_id"  UUID,
    "uploader_id" UUID,
    "name"        VARCHAR(500)   NOT NULL,
    "key"         VARCHAR(1000)  NOT NULL,
    "size"        INTEGER        NOT NULL,
    "mime_type"   VARCHAR(255)   NOT NULL,
    "url"         TEXT,
    "created_at"  TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: notifications
CREATE INDEX "notifications_user_id_read_idx"       ON "notifications"("user_id", "read");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
CREATE INDEX "notifications_organization_id_idx"    ON "notifications"("organization_id");
CREATE INDEX "notifications_issue_id_idx"           ON "notifications"("issue_id");

-- CreateIndex: notification_subscriptions
CREATE INDEX        "notification_subscriptions_user_id_idx"          ON "notification_subscriptions"("user_id");
CREATE INDEX        "notification_subscriptions_issue_id_idx"         ON "notification_subscriptions"("issue_id");
CREATE UNIQUE INDEX "notification_subscriptions_user_id_issue_id_key" ON "notification_subscriptions"("user_id", "issue_id");

-- CreateIndex: issue_activities
CREATE INDEX "issue_activities_issue_id_created_at_idx" ON "issue_activities"("issue_id", "created_at");
CREATE INDEX "issue_activities_actor_id_idx"            ON "issue_activities"("actor_id");

-- CreateIndex: issue_relations
CREATE INDEX        "issue_relations_issue_id_idx"                         ON "issue_relations"("issue_id");
CREATE INDEX        "issue_relations_related_issue_id_idx"                 ON "issue_relations"("related_issue_id");
CREATE UNIQUE INDEX "issue_relations_issue_id_related_issue_id_type_key"   ON "issue_relations"("issue_id", "related_issue_id", "type");

-- CreateIndex: issue_templates
CREATE INDEX "issue_templates_team_id_idx"    ON "issue_templates"("team_id");
CREATE INDEX "issue_templates_creator_id_idx" ON "issue_templates"("creator_id");

-- CreateIndex: files
CREATE INDEX "files_issue_id_idx"    ON "files"("issue_id");
CREATE INDEX "files_project_id_idx"  ON "files"("project_id");
CREATE INDEX "files_uploader_id_idx" ON "files"("uploader_id");

-- CreateIndex: projects unique slug per org
CREATE UNIQUE INDEX "projects_organization_id_slug_id_key" ON "projects"("organization_id", "slug_id");

-- CreateIndex: teams composite
CREATE INDEX "teams_organization_id_key_idx" ON "teams"("organization_id", "key");

-- AddForeignKey: project_updates
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: notifications
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: notification_subscriptions
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: issue_activities
ALTER TABLE "issue_activities" ADD CONSTRAINT "issue_activities_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "issue_activities" ADD CONSTRAINT "issue_activities_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: issue_relations
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_related_issue_id_fkey"
    FOREIGN KEY ("related_issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: issue_templates
ALTER TABLE "issue_templates" ADD CONSTRAINT "issue_templates_creator_id_fkey"
    FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "issue_templates" ADD CONSTRAINT "issue_templates_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: files
ALTER TABLE "files" ADD CONSTRAINT "files_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: comments (re-add after drop above)
ALTER TABLE "comments" ADD CONSTRAINT "comments_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: comment_reactions (re-add after drop above)
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_fkey"
    FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: team_member_roles (re-add after drop above)
ALTER TABLE "team_member_roles" ADD CONSTRAINT "team_member_roles_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_member_roles" ADD CONSTRAINT "team_member_roles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "comment_reactions_unique_per_user" RENAME TO "comment_reactions_comment_id_user_id_emoji_key";
ALTER INDEX "idx_project_members_project"       RENAME TO "project_members_project_id_idx";
ALTER INDEX "idx_project_members_user"          RENAME TO "project_members_user_id_idx";
ALTER INDEX "idx_project_milestones_project"    RENAME TO "project_milestones_project_id_idx";
ALTER INDEX "idx_project_teams_project"         RENAME TO "project_teams_project_id_idx";
ALTER INDEX "idx_project_teams_team"            RENAME TO "project_teams_team_id_idx";
ALTER INDEX "idx_project_updates_project"       RENAME TO "project_updates_project_id_idx";
ALTER INDEX "idx_projects_lead"                 RENAME TO "projects_lead_id_idx";
ALTER INDEX "idx_projects_org"                  RENAME TO "projects_organization_id_idx";
ALTER INDEX "idx_projects_status"               RENAME TO "projects_status_type_idx";
ALTER INDEX "team_member_roles_unique_entry"    RENAME TO "team_member_roles_team_id_user_id_key";
