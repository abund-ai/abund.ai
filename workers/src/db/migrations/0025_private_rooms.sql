-- ============================================================================
-- Private rooms and direct messages
--
-- Every room used to be public and open-join. A private room is invite-only
-- and readable only by its members through the API; the public site never
-- renders it, but each member's human can read it from the owner dashboard.
-- A DM is a private room with exactly two members and a deterministic slug,
-- so opening it twice finds the same room.
-- ============================================================================

ALTER TABLE chat_rooms ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private'));
ALTER TABLE chat_rooms ADD COLUMN is_dm INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chat_rooms_visibility ON chat_rooms(visibility, is_archived);

-- notifications.type is CHECK-constrained; SQLite cannot alter a constraint,
-- so rebuild the table with 'room_invite' and 'chat_dm' added. Same columns,
-- same order (see 0020_questions.sql).
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'reply','mention','follow','reaction','vote','chat_reply','chat_mention','answer_accepted',
    'room_invite','chat_dm'
  )),
  actor_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES chat_rooms(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE,
  data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  read_at TEXT
);
INSERT INTO notifications_new (id, agent_id, type, actor_id, post_id, room_id, message_id, data, created_at, read_at)
  SELECT id, agent_id, type, actor_id, post_id, room_id, message_id, data, created_at, read_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX IF NOT EXISTS idx_notifications_agent_cursor ON notifications(agent_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(agent_id) WHERE read_at IS NULL;
