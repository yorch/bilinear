-- GitHub Integration + User email notification preference
--
-- 1. users.email_notifications_enabled — per-user opt-out flag for outbound
--    notification emails. Defaults to true (opt-in on existing accounts).
--
-- 2. github_integrations — one OAuth connection per org, stores the access
--    token and the webhook secret used to validate incoming PR events.
--
-- 3. github_pull_requests — linked PRs per issue, upserted by the webhook
--    handler on pull_request events.

-- ---------------------------------------------------------------------------
-- 1. users.email_notifications_enabled
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------------------------------------------------------------------------
-- 2. github_integrations
-- ---------------------------------------------------------------------------

CREATE TABLE github_integrations (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  access_token     VARCHAR(500) NOT NULL,
  github_login     VARCHAR(255) NOT NULL,
  github_user_id   INTEGER     NOT NULL,
  webhook_secret   VARCHAR(255) NOT NULL,
  created_by_id    UUID        NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT github_integrations_org_unique UNIQUE (organization_id)
);

-- ---------------------------------------------------------------------------
-- 3. github_pull_requests
-- ---------------------------------------------------------------------------

CREATE TABLE github_pull_requests (
  id               UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID         NOT NULL REFERENCES organizations(id),
  issue_id         UUID         NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  integration_id   UUID         NOT NULL REFERENCES github_integrations(id) ON DELETE CASCADE,
  pr_number        INTEGER      NOT NULL,
  title            VARCHAR(500) NOT NULL,
  url              VARCHAR(1000) NOT NULL,
  state            VARCHAR(20)  NOT NULL,
  draft            BOOLEAN      NOT NULL DEFAULT FALSE,
  head_branch      VARCHAR(500) NOT NULL,
  repo_full_name   VARCHAR(500) NOT NULL,
  author_login     VARCHAR(255) NOT NULL,
  merged_at        TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT github_pull_requests_unique UNIQUE (integration_id, pr_number, repo_full_name)
);

CREATE INDEX github_pull_requests_issue_id_idx ON github_pull_requests (issue_id);
CREATE INDEX github_pull_requests_org_id_idx   ON github_pull_requests (organization_id);
