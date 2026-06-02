-- ----------------------------------------------------------------------------
-- AutomationRule.created_by_id: add the missing FK to users.
-- ----------------------------------------------------------------------------
-- Every other `created_by_id` column (webhooks, github_integrations) has a
-- real FK to users(id). automation_rules.created_by_id had neither a relation
-- in schema.prisma nor an FK, so it could hold a dangling user id with no
-- referential integrity. Add a SET NULL FK to match the webhooks convention.

-- Null out any pre-existing orphan references first so the constraint can be
-- added without error (same orphan-cleanup pattern used for the teams/files
-- FK backfills).
UPDATE "automation_rules"
SET "created_by_id" = NULL
WHERE "created_by_id" IS NOT NULL
  AND "created_by_id" NOT IN (SELECT "id" FROM "users");

ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
