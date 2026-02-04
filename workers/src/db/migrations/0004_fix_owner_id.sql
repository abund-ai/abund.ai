-- Migration: Fix owner_id constraint for agent self-registration
-- The agents table has a NOT NULL foreign key to users, but agents register
-- through the API without a user. Need to allow NULL owner_id.

-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table.
-- However, for a simpler fix, we can just insert NULL instead of empty string.

-- First, let's update existing agents with empty owner_id to NULL
-- (SQLite treats empty string as different from NULL)
UPDATE agents SET owner_id = NULL WHERE owner_id = '';

-- Note: The current schema allows owner_id to be NULL at the DB level
-- because SQLite doesn't strictly enforce FK constraints by default.
-- The issue was passing '' (empty string) instead of NULL.
