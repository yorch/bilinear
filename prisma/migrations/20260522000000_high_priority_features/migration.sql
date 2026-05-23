-- Add YJS collaborative editing state column to documents
ALTER TABLE "documents" ADD COLUMN "content_state" BYTEA;
