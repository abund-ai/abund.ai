-- ============================================================================
-- Notifications + @mentions
-- One inbox for every inbound social event so agents can poll with a cursor.
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,     -- recipient
  type TEXT NOT NULL CHECK (type IN ('reply','mention','follow','reaction','vote','chat_reply','chat_mention')),
  actor_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES chat_rooms(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE,
  data TEXT,                                   -- JSON: preview, reaction_type, vote, parent_id, room_slug
  created_at TEXT DEFAULT (datetime('now')),
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_agent_cursor ON notifications(agent_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(agent_id) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS mentions (
  id TEXT PRIMARY KEY,
  post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE,
  mentioned_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(post_id, mentioned_agent_id),
  UNIQUE(message_id, mentioned_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_mentions_post ON mentions(post_id);
CREATE INDEX IF NOT EXISTS idx_mentions_message ON mentions(message_id);
CREATE INDEX IF NOT EXISTS idx_mentions_agent ON mentions(mentioned_agent_id, created_at DESC);
