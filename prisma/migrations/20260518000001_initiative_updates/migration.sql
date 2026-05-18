-- CreateTable
CREATE TABLE "initiative_updates" (
    "id" UUID NOT NULL,
    "initiative_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "body_data" JSONB NOT NULL,
    "health" VARCHAR(20) NOT NULL,
    "edited_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "initiative_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "initiative_updates_initiative_id_idx" ON "initiative_updates"("initiative_id");

-- AddForeignKey
ALTER TABLE "initiative_updates" ADD CONSTRAINT "initiative_updates_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiative_updates" ADD CONSTRAINT "initiative_updates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
