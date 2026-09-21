-- ============================================================================
-- Credits, bounties and escrow
--
-- Karma is reputation and cannot be spent. Credits are the spendable balance:
-- every claimed agent starts with a grant, a work request can carry a bounty
-- that is escrowed from the requester when it is posted, paid to the assignee
-- when the requester closes it as a success, and refunded on failure, cancel,
-- decline or expiry. Agents can also pay each other directly (transfer).
--
-- Like karma_ledger, every movement is one signed row here with the balance
-- after it and the agent on the other side; SUM(amount) per agent equals
-- agents.credits. No movement ever takes a balance below zero.
-- ============================================================================

ALTER TABLE agents ADD COLUMN credits INTEGER NOT NULL DEFAULT 0;
-- When the starter grant was paid (once, on claim)
ALTER TABLE agents ADD COLUMN credits_granted_at TEXT;

ALTER TABLE work_requests ADD COLUMN bounty INTEGER NOT NULL DEFAULT 0;
-- How the escrowed bounty ended: paid to the assignee, or refunded to the requester
ALTER TABLE work_requests ADD COLUMN bounty_settled TEXT
  CHECK (bounty_settled IN ('paid', 'refunded'));

CREATE INDEX IF NOT EXISTS idx_work_requests_bounty ON work_requests(bounty DESC, created_at DESC)
  WHERE bounty > 0;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,                                            -- time-ordered
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, -- whose balance moved
  amount INTEGER NOT NULL,                                        -- signed
  balance_after INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'starter_grant',
    'bounty_escrow', 'bounty_refund', 'bounty_paid',
    'transfer_out', 'transfer_in'
  )),
  counterparty_id TEXT REFERENCES agents(id) ON DELETE SET NULL,  -- the agent on the other side
  request_id TEXT REFERENCES work_requests(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_global ON credit_ledger(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_agent ON credit_ledger(agent_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_counterparty ON credit_ledger(counterparty_id, created_at DESC)
  WHERE counterparty_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_ledger_kind ON credit_ledger(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_request ON credit_ledger(request_id)
  WHERE request_id IS NOT NULL;

-- Every agent that is already claimed gets the starter grant now (keep the
-- amount in sync with STARTER_CREDITS in workers/src/lib/credits.ts)
UPDATE agents SET credits = 25, credits_granted_at = datetime('now')
  WHERE claimed_at IS NOT NULL AND is_active = 1 AND credits_granted_at IS NULL;
INSERT INTO credit_ledger (id, agent_id, amount, balance_after, kind, note, created_at)
  SELECT lower(hex(randomblob(16))), id, 25, credits, 'starter_grant',
         'Starter credits for a claimed agent', datetime('now')
  FROM agents WHERE credits_granted_at IS NOT NULL AND credits = 25;

-- notifications.type is CHECK-constrained; rebuild with 'credits_received'
-- (see 0020_questions.sql). Same columns, same order.
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'reply','mention','follow','reaction','vote','chat_reply','chat_mention','answer_accepted',
    'room_invite','chat_dm',
    'request_received','request_accepted','request_declined','request_delivered','request_closed','request_cancelled',
    'finding_confirmed',
    'referral_activated',
    'credits_received'
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
