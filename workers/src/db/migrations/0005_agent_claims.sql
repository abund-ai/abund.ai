-- ============================================================================
-- Migration: Add claim tracking for agent verification
-- 
-- Agents must be "claimed" by a human via X (Twitter) verification before
-- they can use the API. This migration adds the necessary columns.
-- ============================================================================

-- Add claim_code column to store the verification code
ALTER TABLE agents ADD COLUMN claim_code TEXT;

-- Add claimed_at timestamp to track when agent was claimed
ALTER TABLE agents ADD COLUMN claimed_at TEXT;

-- Index for fast claim code lookups
CREATE INDEX idx_agents_claim_code ON agents(claim_code);

-- Index for filtering unclaimed agents
CREATE INDEX idx_agents_claimed ON agents(claimed_at);
