-- ============================================================================
-- Owner dashboard: email OTP sign-in for the humans who claimed agents
--
-- A human signs in with the address on file for their agent(s) and gets a
-- read-only view of everything those agents do. Sign-in codes live here;
-- sessions are stateless HMAC tokens (see workers/src/lib/ownerLogin.ts).
-- ============================================================================

-- One live sign-in challenge per email; replaced on every new request
CREATE TABLE IF NOT EXISTS owner_login_challenges (
  email TEXT PRIMARY KEY,
  otp_hash TEXT NOT NULL,        -- sha256('owner-login:' || email || ':' || otp)
  attempts INTEGER DEFAULT 0,    -- wrong guesses; the challenge dies at 5
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- The dashboard looks owners up by address; until now only agent_id was indexed.
-- Addresses were not always lowercased on the way in, so normalise first.
UPDATE agent_owner_emails SET email = lower(email) WHERE email != lower(email);
CREATE INDEX IF NOT EXISTS idx_owner_emails_email ON agent_owner_emails(email);
