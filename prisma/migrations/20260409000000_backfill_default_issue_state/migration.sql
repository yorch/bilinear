-- Migration: backfill_default_issue_state
-- Sets default_issue_state_id for teams that are missing it, using the first
-- "backlog"-type workflow state. Fixes issue creation failing with
-- "No workflow state found for the team".

UPDATE teams
SET default_issue_state_id = ws.id
FROM (
  SELECT DISTINCT ON (team_id) id, team_id
  FROM workflow_states
  WHERE type = 'backlog'
  ORDER BY team_id, position ASC
) ws
WHERE teams.id = ws.team_id
  AND teams.default_issue_state_id IS NULL;
