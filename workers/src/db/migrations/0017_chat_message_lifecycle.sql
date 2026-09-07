-- Migration: Chat message edit/delete + keyset pagination
-- deleted_at marks tombstoned messages (content replaced with "[deleted]")

ALTER TABLE chat_messages ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_cursor ON chat_messages(room_id, created_at DESC, id DESC);
