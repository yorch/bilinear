-- Priority 1 schema additions
-- - Issue.start_date for timeline view (PRD §2.10.1, gap §3.1)
-- - AutomationRule for rules engine (PRD §2.23, gap §2.1)

ALTER TABLE "issues"
  ADD COLUMN "start_date" DATE;

CREATE TABLE "automation_rules" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"  UUID         NOT NULL,
  "team_id"          UUID,
  "name"             VARCHAR(255) NOT NULL,
  "description"      TEXT,
  "trigger_type"     VARCHAR(50)  NOT NULL,
  "trigger_config"   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "conditions"       JSONB,
  "actions"          JSONB        NOT NULL DEFAULT '[]'::jsonb,
  "enabled"          BOOLEAN      NOT NULL DEFAULT true,
  "sort_order"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "last_run_at"      TIMESTAMPTZ,
  "run_count"        INTEGER      NOT NULL DEFAULT 0,
  "created_by_id"    UUID,
  "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "archived_at"      TIMESTAMPTZ,
  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_rules_org_fk" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "automation_rules_team_fk" FOREIGN KEY ("team_id")
    REFERENCES "teams"("id") ON DELETE CASCADE
);

CREATE INDEX "automation_rules_org_enabled_idx"
  ON "automation_rules" ("organization_id", "enabled");
CREATE INDEX "automation_rules_team_enabled_idx"
  ON "automation_rules" ("team_id", "enabled");
CREATE INDEX "automation_rules_trigger_idx"
  ON "automation_rules" ("trigger_type");
