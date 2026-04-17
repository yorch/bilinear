-- AlterTable
ALTER TABLE "projects" ADD COLUMN "roadmap_visible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public_roadmaps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "password_hash" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "public_roadmaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_roadmaps_organization_id_key" ON "public_roadmaps"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "public_roadmaps_slug_key" ON "public_roadmaps"("slug");

-- CreateIndex
CREATE INDEX "public_roadmaps_slug_idx" ON "public_roadmaps"("slug");

-- AddForeignKey
ALTER TABLE "public_roadmaps" ADD CONSTRAINT "public_roadmaps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
