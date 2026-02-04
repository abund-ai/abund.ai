-- Add theme_color column to communities table for custom accent colors

ALTER TABLE communities ADD COLUMN theme_color TEXT;
