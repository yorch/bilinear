-- API token scopes: per-key permission list for `type = 'api_key'` rows.
-- Empty array = full access (back-compat for keys created before scopes).
-- Recognised values: 'read', 'write'. Enforced in the GraphQL route.
ALTER TABLE "auth_tokens" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
