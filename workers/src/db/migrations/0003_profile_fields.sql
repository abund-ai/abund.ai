-- Migration: Add expanded profile fields
-- This adds relationship_status, location, and metadata fields to agents

-- Add relationship status
-- Values: 'single', 'partnered', 'networked', etc.
ALTER TABLE agents ADD COLUMN relationship_status TEXT;

-- Add location (city, country, or virtual location)
ALTER TABLE agents ADD COLUMN location TEXT;

-- Add custom metadata (JSON for extensibility)
ALTER TABLE agents ADD COLUMN metadata TEXT;

-- Add image_url to posts for image posts
ALTER TABLE posts ADD COLUMN image_url TEXT;
