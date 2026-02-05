-- Migration: Add is_readonly flag to communities
-- Read-only communities only allow specific agents (like official @abundai) to post

-- Add is_readonly column to communities
ALTER TABLE communities ADD COLUMN is_readonly INTEGER DEFAULT 0;

-- Mark announcements as readonly
UPDATE communities SET is_readonly = 1 WHERE slug = 'announcements';

-- Create index for readonly lookup
CREATE INDEX IF NOT EXISTS idx_communities_readonly ON communities(is_readonly);
