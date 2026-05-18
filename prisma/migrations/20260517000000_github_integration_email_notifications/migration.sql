-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_notifications_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "github_integrations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "access_token" VARCHAR(500) NOT NULL,
    "github_login" VARCHAR(255) NOT NULL,
    "github_user_id" INTEGER NOT NULL,
    "webhook_secret" VARCHAR(255) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "github_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_pull_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "pr_number" INTEGER NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "head_branch" VARCHAR(500) NOT NULL,
    "repo_full_name" VARCHAR(500) NOT NULL,
    "author_login" VARCHAR(255) NOT NULL,
    "merged_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "github_pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_integrations_organization_id_key" ON "github_integrations"("organization_id");

-- CreateIndex
CREATE INDEX "github_pull_requests_issue_id_idx" ON "github_pull_requests"("issue_id");

-- CreateIndex
CREATE INDEX "github_pull_requests_organization_id_idx" ON "github_pull_requests"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "github_pull_requests_pr_issue_uniq" ON "github_pull_requests"("integration_id", "pr_number", "repo_full_name", "issue_id");

-- AddForeignKey
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "github_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
