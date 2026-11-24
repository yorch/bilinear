-- ----------------------------------------------------------------------------
-- Workspace URL-key aliases: the previous keys of a renamed workspace stay
-- reserved for it and redirect to the current key.
--
-- Additive on top of the baseline ONLY because the dev database already holds
-- the baseline; everything here is expressible in the Prisma DSL, so fold it
-- into a regenerated `00000000000000_init` before the first release. Do NOT
-- apply the xid8 DROP INDEX that `migrate diff` also proposes.
-- ----------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "organization_url_key_aliases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "url_key" VARCHAR(63) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_url_key_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_url_key_aliases_url_key_key" ON "organization_url_key_aliases"("url_key");

-- CreateIndex
CREATE INDEX "organization_url_key_aliases_organization_id_idx" ON "organization_url_key_aliases"("organization_id");

-- AddForeignKey
ALTER TABLE "organization_url_key_aliases" ADD CONSTRAINT "organization_url_key_aliases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
