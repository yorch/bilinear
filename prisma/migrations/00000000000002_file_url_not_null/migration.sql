-- `File.url` is required by every writer (`FileService.createFile` types it as a
-- non-optional string) and the GraphQL SDL has always exposed it as `String!`,
-- but the column was created nullable. A NULL there does not just null the one
-- field: `Issue.files` is `[File!]!`, so it nulls the File, then the Issue, then
-- `IssueConnection.nodes` — taking down the whole `issues` response.
--
-- Applied as a forward migration rather than by editing the init migration,
-- which would fail the `prisma migrate deploy` checksum (P3006) on any database
-- that has already applied it.
ALTER TABLE "files" ALTER COLUMN "url" SET NOT NULL;
