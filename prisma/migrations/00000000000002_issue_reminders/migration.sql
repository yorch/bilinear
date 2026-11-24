-- ----------------------------------------------------------------------------
-- Issue reminders: a private per-user "remind me about this issue at <time>".
--
-- Additive on top of the baseline ONLY because the dev database already holds
-- the baseline; everything here is expressible in the Prisma DSL, so fold it
-- into a regenerated `00000000000000_init` before the first release (see
-- docs/DATABASE_SCHEMA.md section 4). Do NOT apply the xid8 DROP INDEX that
-- `migrate diff` also proposes.
-- ----------------------------------------------------------------------------

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'REMINDER';

-- CreateTable
CREATE TABLE "issue_reminders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "remind_at" TIMESTAMPTZ NOT NULL,
    "fired_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "issue_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issue_reminders_remind_at_fired_at_idx" ON "issue_reminders"("remind_at", "fired_at");

-- CreateIndex
CREATE INDEX "issue_reminders_user_id_fired_at_idx" ON "issue_reminders"("user_id", "fired_at");

-- CreateIndex
CREATE INDEX "issue_reminders_organization_id_idx" ON "issue_reminders"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "issue_reminders_issue_user_uniq" ON "issue_reminders"("issue_id", "user_id");

-- AddForeignKey
ALTER TABLE "issue_reminders" ADD CONSTRAINT "issue_reminders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_reminders" ADD CONSTRAINT "issue_reminders_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_reminders" ADD CONSTRAINT "issue_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
