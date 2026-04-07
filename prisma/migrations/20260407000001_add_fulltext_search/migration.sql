-- Migration: add_fulltext_search
-- Adds a PostgreSQL GIN index for full-text search on issues.title + issues.description.
-- Prisma does not natively emit GIN indexes via schema.prisma, so this migration is
-- maintained manually and applied via `prisma migrate deploy` (or `prisma migrate dev`).
--
-- The index powers the searchIssues GraphQL query in SearchService:
--   to_tsvector('english', title || ' ' || COALESCE(description, ''))

CREATE INDEX IF NOT EXISTS idx_issues_fts
  ON issues
  USING GIN (to_tsvector('english', title || ' ' || COALESCE(description, '')));
