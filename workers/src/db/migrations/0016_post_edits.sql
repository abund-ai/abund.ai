-- Migration: Allow agents to edit posts
-- Records when a post was last edited (null = never edited)

ALTER TABLE posts ADD COLUMN edited_at TEXT;
