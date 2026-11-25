-- Forward migration for changes that shipped on 2026-11-25 (PRs #167, #168).
--
-- Why this file exists instead of another regenerated baseline: the database
-- deployed on 2026-10-12 had already recorded both baseline migrations as
-- applied. Squashing these objects into `00000000000000_init` (as the project
-- did while unreleased) changed that file without renaming it, so
-- `prisma migrate deploy` reported "No pending migrations" and never created
-- them. This migration is the additive fix; from here on the chain only grows.
--
-- The trigram index at the bottom is DDL Prisma cannot express, so it is
-- hand-written here for the same reason it lives in the custom migration.

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'REMINDER';

-- AlterTable
ALTER TABLE "webhook_deliveries" ADD COLUMN     "error_code" VARCHAR(40),
ADD COLUMN     "error_params" JSONB;

-- CreateTable
CREATE TABLE "organization_url_key_aliases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "url_key" VARCHAR(63) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_url_key_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_reminders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "remind_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "issue_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_url_key_aliases_url_key_key" ON "organization_url_key_aliases"("url_key");

-- CreateIndex
CREATE INDEX "organization_url_key_aliases_organization_id_idx" ON "organization_url_key_aliases"("organization_id");

-- CreateIndex
CREATE INDEX "issue_reminders_remind_at_idx" ON "issue_reminders"("remind_at");

-- CreateIndex
CREATE INDEX "issue_reminders_user_id_idx" ON "issue_reminders"("user_id");

-- CreateIndex
CREATE INDEX "issue_reminders_organization_id_idx" ON "issue_reminders"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "issue_reminders_issue_user_uniq" ON "issue_reminders"("issue_id", "user_id");

-- AddForeignKey
ALTER TABLE "organization_url_key_aliases" ADD CONSTRAINT "organization_url_key_aliases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_reminders" ADD CONSTRAINT "issue_reminders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_reminders" ADD CONSTRAINT "issue_reminders_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_reminders" ADD CONSTRAINT "issue_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trigram index on issues.title: duplicate suggestions for no-space scripts
-- ---------------------------------------------------------------------------
-- The 'english' FTS configuration cannot segment Chinese, Japanese or Thai: a
-- whole clause becomes one token, so FTS only matches an identical run of
-- characters. DuplicateSuggestionService falls back to pg_trgm similarity
-- (`title % $source`, ranked by similarity()) for those titles; this index
-- serves the % operator. pg_trgm is a trusted extension (PG13+), so the
-- database owner can create it. Prisma can declare neither the extension nor a
-- gin_trgm_ops opclass.
--
-- Guarded because a database built from the 2026-11-25 baseline+ custom pair
-- already has both objects; this migration must be a no-op there, not an error.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_issues_title_trgm
  ON issues
  USING GIN (title gin_trgm_ops);
