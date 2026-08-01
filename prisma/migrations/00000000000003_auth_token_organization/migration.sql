-- Bind API keys to the organization they were created in.
--
-- `auth_tokens` rows of type 'api_key' previously carried no org, so API-key
-- authentication had to infer one and picked the user's oldest organization
-- membership. For a single-org account that was always right; for a multi-org
-- account it silently pointed the key at the wrong tenant. The column is
-- nullable because it is only meaningful for 'api_key' rows — 'magic_link'
-- and 'refresh' rows identify a user, and their org is resolved when an
-- access token is issued.
--
-- ON DELETE CASCADE matches every other Organization-owned table: dropping an
-- org takes its API keys with it rather than leaving rows that authenticate
-- into nothing.
ALTER TABLE "auth_tokens"
  ADD COLUMN "organization_id" UUID;

ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "auth_tokens_organization_id_idx" ON "auth_tokens"("organization_id");
