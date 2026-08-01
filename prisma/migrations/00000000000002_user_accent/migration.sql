-- Persisted accent-colour preference, so the choice follows the account to a
-- new browser or device instead of living only in the `accent` cookie.
-- Nullable: null means "never chosen", which resolves to the default accent.
ALTER TABLE "users" ADD COLUMN "accent" VARCHAR(20);
