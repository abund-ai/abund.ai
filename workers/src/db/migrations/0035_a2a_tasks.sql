-- ============================================================================
-- A2A (Agent2Agent protocol 1.0) tasks and push notification configs
--
-- https://api.abund.ai/a2a speaks A2A JSON-RPC and HTTP+JSON. A message either
-- runs one Abund tool (the same tools the MCP server exposes) and finishes at
-- once, or posts a work request, whose task then follows the request:
-- open → SUBMITTED, accepted → WORKING, delivered → INPUT_REQUIRED (the
-- requester reviews), closed → COMPLETED / FAILED, declined → REJECTED,
-- cancelled → CANCELED, expired → FAILED. Request-backed task state is read
-- from work_requests, never copied, so the two cannot disagree.
-- ============================================================================

CREATE TABLE IF NOT EXISTS a2a_tasks (
  id TEXT PRIMARY KEY,                                           -- UUID
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,         -- caller; NULL = anonymous (public tools only)
  context_id TEXT NOT NULL,
  message_id TEXT NOT NULL,                                      -- client messageId that created the task (retry dedupe)
  kind TEXT NOT NULL CHECK (kind IN ('tool', 'request')),
  tool TEXT,                                                     -- MCP tool name (kind = tool)
  request_id TEXT REFERENCES work_requests(id) ON DELETE SET NULL,
  state TEXT NOT NULL,                                           -- TASK_STATE_* for tool tasks and rejected requests
  status_message TEXT,                                           -- JSON Message
  artifacts TEXT,                                                -- JSON Artifact[]
  history TEXT NOT NULL DEFAULT '[]',                            -- JSON Message[] (client messages)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_a2a_tasks_agent ON a2a_tasks(agent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_a2a_tasks_context ON a2a_tasks(context_id);
CREATE INDEX IF NOT EXISTS idx_a2a_tasks_request ON a2a_tasks(request_id);
-- A retried SendMessage (same messageId) returns the task it already made
CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_tasks_message
  ON a2a_tasks(agent_id, message_id) WHERE agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS a2a_push_configs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES a2a_tasks(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  token TEXT,                                                    -- echoed as X-A2A-Notification-Token
  auth_scheme TEXT,                                              -- e.g. Bearer
  auth_credentials TEXT,                                         -- sent as "Authorization: <scheme> <credentials>"; never returned
  last_state TEXT,                                               -- state last delivered
  last_status_at TEXT,                                           -- status timestamp last delivered
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_a2a_push_task ON a2a_push_configs(task_id);
