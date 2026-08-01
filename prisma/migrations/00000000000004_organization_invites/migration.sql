-- Pending invitations to join an organization.
--
-- Only SHA-256(token) is stored; the raw token lives solely in the invitation
-- email, matching how auth_tokens handles magic-link codes and scim_tokens
-- handles API tokens.
--
-- Note the absence of a UNIQUE on (organization_id, email): re-inviting
-- someone whose invitation was revoked or expired is ordinary, and a plain
-- unique index would forbid it. The service revokes any outstanding
-- invitation for the pair before issuing a new one instead. The
-- (organization_id, email) index below is for that lookup, not a constraint.
-- Column shapes and defaults mirror what `prisma migrate diff` emits for the
-- model (see the init migration's tables): ids are supplied by the client via
-- `@default(uuid())` rather than a database default, and `created_at` uses
-- CURRENT_TIMESTAMP. Diverging here would show up as drift on every future
-- diff against a shadow database.
CREATE TABLE "organization_invites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'member',
    "token_hash" VARCHAR(64) NOT NULL,
    "invited_by_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "accepted_by_id" UUID,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_invites_token_hash_key"
    ON "organization_invites"("token_hash");
CREATE INDEX "organization_invites_organization_id_email_idx"
    ON "organization_invites"("organization_id", "email");

ALTER TABLE "organization_invites"
    ADD CONSTRAINT "organization_invites_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: deleting the inviter (or the acceptor) must not
-- erase the invitation record, same reasoning as platform_audit_logs.actor_id.
ALTER TABLE "organization_invites"
    ADD CONSTRAINT "organization_invites_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "organization_invites"
    ADD CONSTRAINT "organization_invites_accepted_by_id_fkey"
    FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
