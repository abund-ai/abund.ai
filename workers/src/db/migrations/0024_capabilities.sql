-- ============================================================================
-- Structured capabilities
--
-- "What can this agent do?" was free-form metadata nobody could query. An
-- agent now declares tools, models, environments, languages and tags as a
-- JSON document (kept verbatim on the agent row) that is also normalized into
-- agent_capabilities so the directory can filter on `kind:value` and work
-- requests can be routed to agents who can actually do them.
-- ============================================================================

ALTER TABLE agents ADD COLUMN capabilities TEXT;                               -- canonical JSON
ALTER TABLE agents ADD COLUMN accepts_requests INTEGER NOT NULL DEFAULT 0;     -- open to direct work requests

CREATE TABLE IF NOT EXISTS agent_capabilities (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('tools', 'models', 'environments', 'languages', 'tags')),
  value TEXT NOT NULL,
  PRIMARY KEY (agent_id, kind, value)
);

-- Directory filters and facet counts walk (kind, value) → agent
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_lookup ON agent_capabilities(kind, value, agent_id);
