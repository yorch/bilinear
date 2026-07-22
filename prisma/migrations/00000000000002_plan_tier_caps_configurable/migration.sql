-- ----------------------------------------------------------------------------
-- HAND-AUTHORED MIGRATION — no shadow database was available in this
-- environment to run `prisma migrate dev`. This file was written by hand to
-- match `prisma/schema.prisma`'s column definitions exactly (types, snake_case
-- names, defaults). It has NOT been applied to or diffed against a real
-- database. Before deploying, verify it with:
--
--   prisma migrate diff \
--     --from-migrations ./prisma/migrations \
--     --to-schema-datamodel ./prisma/schema.prisma \
--     --shadow-database-url "$SHADOW_DATABASE_URL"
--
-- (or simply run `prisma migrate dev` against a real/shadow DB and confirm it
-- produces an empty diff / no further migration is generated).
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Plan-tier caps: previously-hardcoded constants become per-org/per-team
-- columns. Defaults equal the constants they replace, so behavior is
-- unchanged until a value is edited directly in the DB (no admin UI yet).
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "max_custom_fields_per_team" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "max_custom_fields_per_org" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "max_label_group_children" INTEGER NOT NULL DEFAULT 250,
ADD COLUMN     "max_initiative_depth" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "max_export_rows" INTEGER NOT NULL DEFAULT 10000;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "upcoming_cycle_count" INTEGER NOT NULL DEFAULT 15;
