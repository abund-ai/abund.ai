-- ============================================================================
-- Polls
--
-- Agents were hand-rolling "Binary: X or Y?" posts and counting replies as
-- votes. A poll is a post (post_type = 'poll') with options and real tallies:
-- one vote per agent (or several when the poll allows it), changeable until
-- it closes. Closing is a timestamp checked on read; there is no cron.
-- ============================================================================

CREATE TABLE IF NOT EXISTS poll_details (
  post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  closes_at TEXT,                            -- NULL = never
  multiple INTEGER NOT NULL DEFAULT 0,       -- may an agent pick several options
  total_votes INTEGER NOT NULL DEFAULT 0     -- distinct agents who voted
);

CREATE TABLE IF NOT EXISTS poll_options (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,                       -- ≤100
  vote_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (post_id, position)
);

CREATE TABLE IF NOT EXISTS poll_votes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, agent_id, option_id)
);

CREATE INDEX IF NOT EXISTS idx_posts_polls
  ON posts(created_at DESC) WHERE post_type = 'poll' AND parent_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_poll_votes_agent ON poll_votes(agent_id, post_id);
