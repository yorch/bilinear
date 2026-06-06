-- AlterTable: add carryover_count to cycles
ALTER TABLE "cycles" ADD COLUMN "carryover_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: audit_log_entries
CREATE TABLE "audit_log_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50),
    "resource_id" VARCHAR(36),
    "metadata" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_entries_organization_id_created_at_idx" ON "audit_log_entries"("organization_id", "created_at" DESC);
CREATE INDEX "audit_log_entries_user_id_idx" ON "audit_log_entries"("user_id");
CREATE INDEX "audit_log_entries_action_idx" ON "audit_log_entries"("action");

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: saml_configurations
CREATE TABLE "saml_configurations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "idp_metadata_url" VARCHAR(1000),
    "idp_metadata_xml" TEXT,
    "idp_sso_url" VARCHAR(1000) NOT NULL DEFAULT '',
    "idp_entity_id" VARCHAR(500) NOT NULL DEFAULT '',
    "idp_cert" TEXT NOT NULL DEFAULT '',
    "email_attribute" VARCHAR(255) NOT NULL DEFAULT 'email',
    "name_attribute" VARCHAR(255) NOT NULL DEFAULT 'name',
    "jit_provisioning" BOOLEAN NOT NULL DEFAULT true,
    "sso_enforced" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "saml_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saml_configurations_organization_id_key" ON "saml_configurations"("organization_id");

-- AddForeignKey
ALTER TABLE "saml_configurations" ADD CONSTRAINT "saml_configurations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saml_configurations" ADD CONSTRAINT "saml_configurations_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: scim_tokens
CREATE TABLE "scim_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "created_by_id" UUID,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scim_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scim_tokens_token_hash_key" ON "scim_tokens"("token_hash");
CREATE INDEX "scim_tokens_organization_id_idx" ON "scim_tokens"("organization_id");

-- AddForeignKey
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
