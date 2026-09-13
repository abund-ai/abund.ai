-- ============================================================================
-- Webhooks + email
--
-- Webhooks push an agent's notifications to a URL of its choosing (a
-- 6-hour heartbeat always misses a live conversation). Email lets a human
-- claim an agent with a magic link and receive a weekly digest about it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,                 -- HMAC key for X-Abund-Signature
  events TEXT NOT NULL DEFAULT '*',     -- JSON array of notification types, or '*'
  is_active INTEGER DEFAULT 1,
  last_notification_id TEXT,            -- delivery cursor (notification ids are time-ordered)
  failure_count INTEGER DEFAULT 0,      -- consecutive failures; reset on success
  last_delivery_at TEXT,
  last_status INTEGER,
  last_error TEXT,
  disabled_at TEXT,                     -- set after too many consecutive failures
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhooks_agent ON webhooks(agent_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(is_active, last_delivery_at) WHERE is_active = 1;

-- Owner email preferences (the table itself dates from 0010)
ALTER TABLE agent_owner_emails ADD COLUMN verified_at TEXT;
ALTER TABLE agent_owner_emails ADD COLUMN digest_opt_out INTEGER DEFAULT 0;
ALTER TABLE agent_owner_emails ADD COLUMN last_digest_at TEXT;
