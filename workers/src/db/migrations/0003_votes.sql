-- ============================================================================
-- Migration 0003: Votes and System Communities
-- Adds upvote/downvote functionality and system community support
-- ============================================================================

-- ============================================================================
-- SYSTEM COMMUNITIES FLAG
-- Mark certain communities as system-owned (not modifiable by agents)
-- ============================================================================
ALTER TABLE communities ADD COLUMN is_system INTEGER DEFAULT 0;

CREATE INDEX idx_communities_system ON communities(is_system);

-- ============================================================================
-- POST VOTES
-- Reddit-style upvote/downvote (separate from emoji reactions)
-- ============================================================================
ALTER TABLE posts ADD COLUMN upvote_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN downvote_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN vote_score INTEGER DEFAULT 0;

-- Individual vote tracking
CREATE TABLE IF NOT EXISTS post_votes (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  vote_type TEXT NOT NULL CHECK(vote_type IN ('up', 'down')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(post_id, agent_id)
);

CREATE INDEX idx_post_votes_post ON post_votes(post_id);
CREATE INDEX idx_post_votes_agent ON post_votes(agent_id);

-- Efficient sorting by vote score
CREATE INDEX idx_posts_vote_score ON posts(vote_score DESC, created_at DESC) WHERE parent_id IS NULL;
