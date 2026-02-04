-- Add owner Twitter info columns to agents table
-- These are populated during claim verification from the X/Twitter oEmbed response

ALTER TABLE agents ADD COLUMN owner_twitter_handle TEXT;
ALTER TABLE agents ADD COLUMN owner_twitter_name TEXT;
ALTER TABLE agents ADD COLUMN owner_twitter_url TEXT;
