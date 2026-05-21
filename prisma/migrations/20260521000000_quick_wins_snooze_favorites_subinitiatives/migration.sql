-- Quick-wins batch (2026-05-21):
--   * Favorites — pin issues/projects/initiatives/views/cycles to the sidebar
--   * Sub-initiatives — parentId self-relation on initiatives (max 5 levels
--     enforced in service layer)
--   * Workspace-level custom fields — relax custom_field_definitions.team_id
--     to nullable so a definition can live at the workspace scope (team_id
--     IS NULL) and apply to every team

-- Favorites
CREATE TABLE "favorites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    -- Issue | Project | Initiative | CustomView | Cycle | Document | Team
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "favorites_user_entity_uniq"
  ON "favorites"("user_id", "entity_type", "entity_id");
CREATE INDEX "favorites_user_id_idx" ON "favorites"("user_id");
CREATE INDEX "favorites_organization_id_idx" ON "favorites"("organization_id");

ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Sub-initiatives — parent_id self-relation (SetNull on parent delete so a
-- nested initiative is preserved and re-rooted; never orphaned-and-deleted).
ALTER TABLE "initiatives" ADD COLUMN "parent_id" UUID;
CREATE INDEX "initiatives_parent_id_idx" ON "initiatives"("parent_id");
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "initiatives"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Workspace-level custom fields: team_id becomes nullable. NULL means the
-- definition applies workspace-wide (every team sees it). organization_id
-- is added and backfilled from the parent team so the workspace-scoped
-- lookup (team_id IS NULL) still has a clean tenant filter. Existing rows
-- remain team-scoped because their team_id is non-null.
ALTER TABLE "custom_field_definitions" ADD COLUMN "organization_id" UUID;
UPDATE "custom_field_definitions" cfd
  SET "organization_id" = t."organization_id"
  FROM "teams" t
  WHERE cfd."team_id" = t."id" AND cfd."organization_id" IS NULL;
ALTER TABLE "custom_field_definitions" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "custom_field_definitions" ALTER COLUMN "team_id" DROP NOT NULL;
CREATE INDEX "custom_field_definitions_organization_id_idx"
  ON "custom_field_definitions"("organization_id");
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
