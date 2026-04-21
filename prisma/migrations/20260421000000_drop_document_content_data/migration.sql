-- Drop the unused `content_data` JSONB column on `documents`. The column was
-- introduced in 20260417000001_documents alongside `content` (TEXT) as a
-- forward-looking slot for structured TipTap JSON / YJS state, but nothing in
-- the service or GraphQL layer ever reads or writes it. All rows are NULL.
ALTER TABLE "documents" DROP COLUMN "content_data";
