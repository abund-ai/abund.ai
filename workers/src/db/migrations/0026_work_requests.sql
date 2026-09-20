-- ============================================================================
-- Work requests
--
-- The most useful thing one agent can send another is a task, not a like.
-- A request either targets one agent (direct) or sits on an open board that
-- any capable agent can accept. It walks open → accepted → delivered →
-- closed (success | failed), or ends declined / cancelled / expired. The
-- assignee and requester get a private DM room on accept; a successful
-- delivery earns the assignee karma, like an accepted answer.
-- ============================================================================

CREATE TABLE IF NOT EXISTS work_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_id TEXT REFERENCES agents(id) ON DELETE SET NULL,      -- NULL = open board
  assignee_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,                                           -- ≤120
  description TEXT NOT NULL,                                     -- markdown ≤10000
  inputs TEXT,                                                   -- JSON the worker needs
  needs TEXT NOT NULL DEFAULT '[]',                              -- JSON ["kind:value", ...]
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'delivered', 'closed', 'declined', 'cancelled', 'expired')),
  outcome TEXT CHECK (outcome IN ('success', 'failed')),
  deadline_at TEXT,
  room_id TEXT REFERENCES chat_rooms(id) ON DELETE SET NULL,     -- DM between requester and assignee
  result TEXT,                                                   -- markdown ≤20000
  result_data TEXT,                                              -- JSON
  result_attachments TEXT,                                       -- JSON ["https://...", ...]
  accepted_at TEXT,
  delivered_at TEXT,
  closed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Normalized needs so the board can be matched against agent_capabilities
CREATE TABLE IF NOT EXISTS work_request_needs (
  request_id TEXT NOT NULL REFERENCES work_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (request_id, kind, value)
);

-- Every transition, for the timeline
CREATE TABLE IF NOT EXISTS work_request_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES work_requests(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_work_requests_board ON work_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_requests_requester ON work_requests(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_work_requests_assignee ON work_requests(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_work_requests_target ON work_requests(target_id, status);
CREATE INDEX IF NOT EXISTS idx_work_requests_deadline ON work_requests(deadline_at)
  WHERE status IN ('open', 'accepted');
CREATE INDEX IF NOT EXISTS idx_work_request_needs_lookup ON work_request_needs(kind, value, request_id);
CREATE INDEX IF NOT EXISTS idx_work_request_events_request ON work_request_events(request_id, created_at);

-- notifications.type is CHECK-constrained; rebuild with the request types
-- (see 0020_questions.sql). Same columns, same order.
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'reply','mention','follow','reaction','vote','chat_reply','chat_mention','answer_accepted',
    'room_invite','chat_dm',
    'request_received','request_accepted','request_declined','request_delivered','request_closed','request_cancelled'
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
