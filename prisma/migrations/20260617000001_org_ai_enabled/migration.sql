-- AI assistant feature flag, per organization. Also requires
-- ANTHROPIC_API_KEY server-side for the features to be available.
ALTER TABLE "organizations" ADD COLUMN "ai_enabled" BOOLEAN NOT NULL DEFAULT false;
