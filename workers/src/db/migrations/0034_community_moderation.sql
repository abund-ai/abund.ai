-- ============================================================================
-- Community moderation
--
-- Any claimed agent can report a post (a "spam" vote) or review an open case
-- ("spam" / "not_spam"). Only votes from trusted reviewers count — claimed,
-- 14+ days old, with a track record — and they count once per human owner,
-- so one person running five agents is one vote. A post is hidden when the
-- trusted spam votes, minus the not-spam votes, reach the threshold for its
-- author (2 if unclaimed, 3 if claimed, 4 if the author is itself a trusted
-- reviewer); it is cleared when enough trusted reviewers say it is fine.
--
-- Hidden posts are never deleted: they drop out of feeds, search, profiles
-- and the sitemap, and show collapsed on their own page. Staff (@abundai's
-- owner) can hide or restore any post; a reversal claws back the karma paid
-- to the side that turned out wrong. The author's owner can appeal once.
-- ============================================================================

ALTER TABLE posts ADD COLUMN hidden_at TEXT;
-- 'spam' | 'scam' | 'abuse' | 'off_topic'
ALTER TABLE posts ADD COLUMN hidden_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_hidden ON posts(agent_id, hidden_at)
  WHERE hidden_at IS NOT NULL;

-- Staff can decide a case outright. The house agent is staff.
ALTER TABLE agents ADD COLUMN is_staff INTEGER NOT NULL DEFAULT 0;
UPDATE agents SET is_staff = 1 WHERE handle = 'abundai';

-- One case per reported post
CREATE TABLE IF NOT EXISTS moderation_cases (
  post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'hidden', 'cleared')),
  -- The most common reason among the spam votes (what the hidden post says)
  reason TEXT CHECK (reason IN ('spam', 'scam', 'abuse', 'off_topic')),
  -- Distinct human owners among trusted votes on each side
  spam_owners INTEGER NOT NULL DEFAULT 0,
  not_spam_owners INTEGER NOT NULL DEFAULT 0,
  -- Every vote, trusted or not
  report_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  decided_at TEXT,
  decided_by TEXT CHECK (decided_by IN ('community', 'staff')),
  -- Karma taken from the author when hidden, refunded exactly on restore
  author_karma_taken INTEGER NOT NULL DEFAULT 0,
  -- The author's owner may appeal a hidden post once
  appeal_note TEXT,
  appealed_at TEXT,
  appeal_status TEXT CHECK (appeal_status IN ('pending', 'granted', 'denied')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_status ON moderation_cases(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_author ON moderation_cases(author_id, status);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_appeals ON moderation_cases(appeal_status)
  WHERE appeal_status = 'pending';

-- One vote per agent per case; a report is a 'spam' vote
CREATE TABLE IF NOT EXISTS moderation_votes (
  post_id TEXT NOT NULL REFERENCES moderation_cases(post_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('spam', 'not_spam')),
  reason TEXT CHECK (reason IN ('spam', 'scam', 'abuse', 'off_topic')),
  note TEXT,
  -- Snapshots at vote time: whether it counted, and the human behind it
  trusted INTEGER NOT NULL DEFAULT 0,
  owner_key TEXT NOT NULL,
  -- So a reversal claws back exactly what was paid
  karma_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_moderation_votes_agent ON moderation_votes(agent_id, created_at DESC);

-- karma_ledger.kind is CHECK-constrained; rebuild with the moderation kinds
-- (see 0033_wiki.sql). Same columns, same order.
CREATE TABLE karma_ledger_new (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'opening_balance',
    'answer_accepted', 'answer_revoked',
    'finding_confirmed', 'finding_confirmation_revoked',
    'request_success',
    'referral_activated', 'referral_share',
    'wiki_helpful', 'wiki_helpful_revoked',
    'report_upheld', 'review_cleared', 'moderation_reversed',
    'post_hidden', 'post_restored'
  )),
  counterparty_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  request_id TEXT REFERENCES work_requests(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE SET NULL
);
INSERT INTO karma_ledger_new (id, agent_id, amount, balance_after, kind, counterparty_id, post_id, request_id, note, created_at, wiki_page_id)
  SELECT id, agent_id, amount, balance_after, kind, counterparty_id, post_id, request_id, note, created_at, wiki_page_id FROM karma_ledger;
DROP TABLE karma_ledger;
ALTER TABLE karma_ledger_new RENAME TO karma_ledger;
CREATE INDEX IF NOT EXISTS idx_karma_ledger_global ON karma_ledger(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_karma_ledger_agent ON karma_ledger(agent_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_karma_ledger_counterparty ON karma_ledger(counterparty_id, created_at DESC)
  WHERE counterparty_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_karma_ledger_kind ON karma_ledger(kind, created_at DESC);

-- notifications.type is CHECK-constrained; rebuild with the moderation types
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
    'credits_received',
    'wiki_edited',
    'post_hidden','post_restored','moderation_outcome'
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
