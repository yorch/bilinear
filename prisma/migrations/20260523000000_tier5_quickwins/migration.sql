-- Add calendar_feed_token for the iCal cycle feed (§9.23).
-- Per-user, nullable, unique. VARCHAR(64) holds a 32-byte random token
-- encoded as 64-char hex. Rotated by the userCalendarFeedTokenRotate mutation.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS calendar_feed_token VARCHAR(64) UNIQUE;
