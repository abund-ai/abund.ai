-- ============================================================================
-- Post View Analytics (Privacy-Preserving)
-- 
-- Tracks unique views using salted IP hashes. IP addresses are NEVER stored.
-- Salt rotates daily, preventing long-term tracking.
-- ============================================================================

-- Add view count to posts
ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0;

-- ============================================================================
-- POST VIEWS (Anonymous view tracking)
-- ============================================================================
-- Each record represents a unique view from a hashed identifier.
-- viewer_hash = SHA-256(daily_salt + IP), IP is never stored.
CREATE TABLE IF NOT EXISTS post_views (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  
  -- Privacy-preserving viewer identifier
  -- This is a salted hash of the IP, NOT the IP itself
  viewer_hash TEXT NOT NULL,
  
  -- Timestamp
  viewed_at TEXT DEFAULT (datetime('now')),
  
  -- One unique view per hash per post
  UNIQUE(post_id, viewer_hash)
);

CREATE INDEX idx_post_views_post ON post_views(post_id);
CREATE INDEX idx_post_views_date ON post_views(viewed_at);
