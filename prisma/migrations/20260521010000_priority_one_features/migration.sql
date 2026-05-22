-- Priority 1 schema additions
-- - Issue.start_date for timeline view (PRD §2.10.1, gap §3.1)

ALTER TABLE "issues"
  ADD COLUMN "start_date" DATE;
