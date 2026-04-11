-- Sprint 27-28: Comments & Reactions
-- Sprint 29-30: Team Member Roles

-- Comments table
CREATE TABLE "comments" (
    "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
    "issue_id"       UUID         NOT NULL,
    "author_id"      UUID         NOT NULL,
    "body"           TEXT         NOT NULL,
    "body_data"      JSONB,
    "parent_id"      UUID,
    "resolved_at"    TIMESTAMPTZ,
    "resolved_by_id" UUID,
    "edited_at"      TIMESTAMPTZ,
    "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "archived_at"    TIMESTAMPTZ,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "comments"
    ADD CONSTRAINT "comments_issue_id_fkey"
        FOREIGN KEY ("issue_id")  REFERENCES "issues"("id")   ON DELETE CASCADE,
    ADD CONSTRAINT "comments_author_id_fkey"
        FOREIGN KEY ("author_id") REFERENCES "users"("id")    ON DELETE CASCADE,
    ADD CONSTRAINT "comments_parent_id_fkey"
        FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE SET NULL,
    ADD CONSTRAINT "comments_resolved_by_id_fkey"
        FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX "comments_issue_id_created_at_idx" ON "comments"("issue_id", "created_at");
CREATE INDEX "comments_author_id_idx"           ON "comments"("author_id");
CREATE INDEX "comments_parent_id_idx"           ON "comments"("parent_id");

-- Comment reactions table
CREATE TABLE "comment_reactions" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "comment_id" UUID        NOT NULL,
    "user_id"    UUID        NOT NULL,
    "emoji"      VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "comment_reactions_pkey"           PRIMARY KEY ("id"),
    CONSTRAINT "comment_reactions_unique_per_user" UNIQUE ("comment_id", "user_id", "emoji")
);

ALTER TABLE "comment_reactions"
    ADD CONSTRAINT "comment_reactions_comment_id_fkey"
        FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE,
    ADD CONSTRAINT "comment_reactions_user_id_fkey"
        FOREIGN KEY ("user_id")    REFERENCES "users"("id")    ON DELETE CASCADE;

CREATE INDEX "comment_reactions_comment_id_idx" ON "comment_reactions"("comment_id");
CREATE INDEX "comment_reactions_user_id_idx"    ON "comment_reactions"("user_id");

-- Team member roles table (extends TeamMembership with fine-grained role)
CREATE TABLE "team_member_roles" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "team_id"    UUID        NOT NULL,
    "user_id"    UUID        NOT NULL,
    "role"       VARCHAR(20) NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "team_member_roles_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "team_member_roles_unique_entry" UNIQUE ("team_id", "user_id")
);

ALTER TABLE "team_member_roles"
    ADD CONSTRAINT "team_member_roles_team_id_fkey"
        FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE,
    ADD CONSTRAINT "team_member_roles_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE INDEX "team_member_roles_team_id_idx" ON "team_member_roles"("team_id");
CREATE INDEX "team_member_roles_user_id_idx" ON "team_member_roles"("user_id");
