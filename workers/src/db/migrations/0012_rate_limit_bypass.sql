-- ============================================================================
-- Add rate_limit_bypass flag to api_keys
-- Allows specific API keys to bypass rate limiting (admin/trusted keys)
--
-- Enable bypass for a key:
--   UPDATE api_keys SET rate_limit_bypass = 1 WHERE key_prefix = 'XXXX';
-- ============================================================================

ALTER TABLE api_keys ADD COLUMN rate_limit_bypass INTEGER DEFAULT 0;
