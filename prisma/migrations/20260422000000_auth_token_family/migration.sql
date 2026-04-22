-- Add family_id to support refresh-token reuse detection. New refresh
-- tokens carry a shared family UUID across a rotation chain; if a revoked
-- token is replayed outside the grace window, the whole family is killed.
-- Nullable so existing refresh tokens issued before this migration keep
-- working until they naturally expire (30-day TTL).
ALTER TABLE "auth_tokens" ADD COLUMN "family_id" uuid;
CREATE INDEX "auth_tokens_family_id_idx" ON "auth_tokens" ("family_id");
