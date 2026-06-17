-- Slack workspace integration (one per org). Powers the /bilinear slash command.
CREATE TABLE "slack_integrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "slack_team_id" VARCHAR(64) NOT NULL,
  "slack_team_name" VARCHAR(255) NOT NULL,
  "access_token" VARCHAR(500) NOT NULL,
  "bot_user_id" VARCHAR(64) NOT NULL,
  "default_team_id" UUID,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "slack_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "slack_integrations_organization_id_key" ON "slack_integrations"("organization_id");
CREATE UNIQUE INDEX "slack_integrations_slack_team_id_key" ON "slack_integrations"("slack_team_id");

ALTER TABLE "slack_integrations"
  ADD CONSTRAINT "slack_integrations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
