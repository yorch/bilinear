-- Initiatives: top-level strategic planning above projects.
-- Many-to-many with Project; progress rolls up from project completion.
CREATE TABLE "initiatives" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" uuid NOT NULL,
    "name" varchar(255) NOT NULL,
    "description" text,
    "icon" varchar(255),
    "color" varchar(7) NOT NULL DEFAULT '#6366f1',
    "status" varchar(20) NOT NULL DEFAULT 'planned',
    "priority" smallint NOT NULL DEFAULT 0,
    "priority_sort_order" double precision NOT NULL DEFAULT 0,
    "sort_order" double precision NOT NULL DEFAULT 0,
    "target_date" date,
    "start_date" date,
    "start_date_resolution" varchar(20),
    "target_date_resolution" varchar(20),
    "owner_id" uuid,
    "creator_id" uuid,
    "progress" double precision NOT NULL DEFAULT 0,
    "started_at" timestamptz,
    "completed_at" timestamptz,
    "canceled_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz NOT NULL,
    "archived_at" timestamptz,
    CONSTRAINT "initiatives_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "initiatives_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL,
    CONSTRAINT "initiatives_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "initiatives_organization_id_idx" ON "initiatives" ("organization_id");
CREATE INDEX "initiatives_status_idx" ON "initiatives" ("status");
CREATE INDEX "initiatives_owner_id_idx" ON "initiatives" ("owner_id");

-- Many-to-many: project ↔ initiative.
CREATE TABLE "initiative_projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "initiative_id" uuid NOT NULL,
    "project_id" uuid NOT NULL,
    "sort_order" double precision NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "initiative_projects_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE,
    CONSTRAINT "initiative_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "initiative_projects_initiative_id_project_id_key" UNIQUE ("initiative_id", "project_id")
);
CREATE INDEX "initiative_projects_initiative_id_idx" ON "initiative_projects" ("initiative_id");
CREATE INDEX "initiative_projects_project_id_idx" ON "initiative_projects" ("project_id");

-- Webhooks: outbound HTTP subscriptions with HMAC SHA-256 signing.
-- Events listed in `events` array trigger a POST to `url` with header
-- `X-Bilinear-Signature: sha256=<hex>` computed from the raw body using
-- `signing_secret`. Failed deliveries are retried with exponential
-- backoff via the WebhookDelivery table.
CREATE TABLE "webhooks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" uuid NOT NULL,
    "name" varchar(255) NOT NULL,
    "url" varchar(2000) NOT NULL,
    "events" text[] NOT NULL DEFAULT ARRAY[]::text[],
    "signing_secret" text NOT NULL,
    "enabled" boolean NOT NULL DEFAULT true,
    "team_id" uuid,
    "last_delivery_at" timestamptz,
    "last_success_at" timestamptz,
    "consecutive_failures" integer NOT NULL DEFAULT 0,
    "created_by_id" uuid,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz NOT NULL,
    "archived_at" timestamptz,
    CONSTRAINT "webhooks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "webhooks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "webhooks_organization_id_idx" ON "webhooks" ("organization_id");
CREATE INDEX "webhooks_organization_id_enabled_idx" ON "webhooks" ("organization_id", "enabled");

-- Single delivery attempt for a webhook event. The (status, next_attempt_at)
-- partial index supports the retry scheduler's "find next delivery to send"
-- query without scanning completed deliveries.
CREATE TABLE "webhook_deliveries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "webhook_id" uuid NOT NULL,
    "event" varchar(50) NOT NULL,
    "payload" jsonb NOT NULL,
    "status" varchar(10) NOT NULL DEFAULT 'pending',
    "attempts" integer NOT NULL DEFAULT 0,
    "response_status" integer,
    "response_body" text,
    "error_message" text,
    "next_attempt_at" timestamptz,
    "delivered_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz NOT NULL,
    CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE
);
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries" ("webhook_id", "created_at");
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries" ("status", "next_attempt_at");
