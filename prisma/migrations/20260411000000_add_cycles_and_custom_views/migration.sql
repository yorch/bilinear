-- CreateTable
CREATE TABLE "cycles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" VARCHAR(255),
    "description" TEXT,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "auto_archived_at" TIMESTAMPTZ,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scope" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scope_history" JSONB NOT NULL DEFAULT '[]',
    "completed_scope_history" JSONB NOT NULL DEFAULT '[]',
    "issue_count_history" JSONB NOT NULL DEFAULT '[]',
    "completed_issue_count_history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_views" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "organization_id" UUID NOT NULL,
    "team_id" UUID,
    "creator_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(255),
    "color" VARCHAR(7),
    "filters" JSONB NOT NULL DEFAULT '{}',
    "sort" JSONB NOT NULL DEFAULT '[]',
    "group_by" VARCHAR(50),
    "layout" VARCHAR(10) NOT NULL DEFAULT 'list',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "custom_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cycles_team_id_number_key" ON "cycles"("team_id", "number");

-- CreateIndex
CREATE INDEX "cycles_organization_id_idx" ON "cycles"("organization_id");

-- CreateIndex
CREATE INDEX "cycles_team_id_idx" ON "cycles"("team_id");

-- CreateIndex
CREATE INDEX "cycles_team_id_starts_at_idx" ON "cycles"("team_id", "starts_at");

-- CreateIndex
CREATE INDEX "custom_views_organization_id_idx" ON "custom_views"("organization_id");

-- CreateIndex
CREATE INDEX "custom_views_team_id_idx" ON "custom_views"("team_id");

-- CreateIndex
CREATE INDEX "custom_views_creator_id_idx" ON "custom_views"("creator_id");

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_views" ADD CONSTRAINT "custom_views_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_views" ADD CONSTRAINT "custom_views_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_views" ADD CONSTRAINT "custom_views_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
