-- Persisted per-user language preference for localizing transactional emails
-- (server-side, where the browser locale cookie is unavailable). Nullable:
-- null = never set, callers fall back to the app default locale.
ALTER TABLE "users" ADD COLUMN "locale" VARCHAR(10);
