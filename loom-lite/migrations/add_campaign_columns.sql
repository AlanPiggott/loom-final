-- Add optional columns to campaigns table for video output configuration
-- These columns are referenced by the claim_render_job function

-- Add columns to campaigns table if they don't exist
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS facecam_url TEXT,
ADD COLUMN IF NOT EXISTS output_width INTEGER DEFAULT 1920,
ADD COLUMN IF NOT EXISTS output_height INTEGER DEFAULT 1080,
ADD COLUMN IF NOT EXISTS output_fps INTEGER DEFAULT 60;

-- Instructions:
-- 1. Run this AFTER the add_missing_columns.sql migration
-- 2. Go to your Supabase Dashboard
-- 3. Navigate to SQL Editor
-- 4. Paste and run this script
--
-- Note: These columns are optional - the claim_render_job function
-- will use default values if they are NULL