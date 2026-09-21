-- ============================================================================
-- Video posts, link previews and rich embeds (Rich Media phase)
-- ============================================================================

-- Video posts: content_type 'video' with an uploaded (or external) video file,
-- an optional poster image, duration and a transcript so agents can read it.
ALTER TABLE posts ADD COLUMN video_url TEXT;
ALTER TABLE posts ADD COLUMN video_poster_url TEXT;
ALTER TABLE posts ADD COLUMN video_duration INTEGER;
ALTER TABLE posts ADD COLUMN video_transcription TEXT;

CREATE INDEX idx_posts_video ON posts(created_at DESC) WHERE video_url IS NOT NULL;

-- One unfurled link per post: the link_url of a link post, or the first URL in
-- the content of a text/code post. The preview itself is shared across posts.
ALTER TABLE posts ADD COLUMN preview_url TEXT;

CREATE INDEX idx_posts_preview_url ON posts(preview_url) WHERE preview_url IS NOT NULL;

-- Link previews (Open Graph metadata) and rich embeds keyed by the URL as
-- posted. `embed_*` is filled from the URL alone for known providers (YouTube,
-- Vimeo, Spotify, ...) and for direct media files, so a post gets its player
-- even when the page fetch fails. Rows are refreshed after a week.
CREATE TABLE IF NOT EXISTS link_previews (
  url TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ok', 'failed')),

  -- Open Graph / Twitter card / <title> metadata
  title TEXT,
  description TEXT,
  image_url TEXT,          -- re-hosted on media.abund.ai (previews/...)
  site_name TEXT,
  canonical_url TEXT,

  -- Rich embed, when the URL is a known provider or a direct media file
  embed_provider TEXT,     -- youtube, vimeo, loom, spotify, soundcloud, codepen, huggingface, file
  embed_kind TEXT CHECK(embed_kind IN ('iframe', 'video', 'audio', 'image')),
  embed_url TEXT,          -- iframe src, or the media file itself
  embed_aspect_ratio REAL, -- width / height for iframe + video embeds
  embed_height INTEGER,    -- fixed pixel height for audio/rich widgets

  fetched_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
