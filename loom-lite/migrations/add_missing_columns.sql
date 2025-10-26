-- Add missing columns to campaigns, render_jobs, and renders tables
-- This migration adds timestamp, CSV metadata, and worker tracking columns needed by the worker

-- Add CSV metadata columns to campaigns table
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS lead_csv_url TEXT,
ADD COLUMN IF NOT EXISTS lead_csv_path TEXT,
ADD COLUMN IF NOT EXISTS lead_csv_filename TEXT,
ADD COLUMN IF NOT EXISTS lead_row_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS csv_headers TEXT[];

-- Add columns to render_jobs table
ALTER TABLE render_jobs
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS lead_row_index INTEGER;

-- Add columns to renders table
ALTER TABLE renders
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS lead_row_index INTEGER,
ADD COLUMN IF NOT EXISTS lead_identifier TEXT;

-- Add CSV metadata columns to scenes table
ALTER TABLE scenes
ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS csv_column TEXT;

UPDATE scenes
SET entry_type = 'manual'
WHERE entry_type IS NULL;

-- Create or replace function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for render_jobs
DROP TRIGGER IF EXISTS update_render_jobs_updated_at ON render_jobs;
CREATE TRIGGER update_render_jobs_updated_at
BEFORE UPDATE ON render_jobs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for renders
DROP TRIGGER IF EXISTS update_renders_updated_at ON renders;
CREATE TRIGGER update_renders_updated_at
BEFORE UPDATE ON renders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Update the claim_render_job function to work with the new columns
DROP FUNCTION IF EXISTS claim_render_job();
CREATE OR REPLACE FUNCTION claim_render_job()
RETURNS TABLE(
  job_id UUID,
  render_id UUID,
  campaign_id UUID,
  campaign_name TEXT,
  scenes JSONB,
  facecam_url TEXT,
  lead_csv_url TEXT,
  lead_row_index INTEGER,
  output_settings JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id UUID;
  v_render_id UUID;
  v_campaign_id UUID;
BEGIN
  -- Atomically select and lock the oldest queued job
  SELECT j.id, j.render_id, j.campaign_id
  INTO v_job_id, v_render_id, v_campaign_id
  FROM render_jobs j
  WHERE j.state = 'queued'
  ORDER BY j.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  -- If no job found, return empty result
  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  -- Update the job state to running
  UPDATE render_jobs
  SET
    state = 'running',
    started_at = NOW(),
    updated_at = NOW()
  WHERE id = v_job_id;

  -- Update the render status to recording
  UPDATE renders
  SET
    status = 'recording',
    progress = 5,
    updated_at = NOW()
  WHERE id = v_render_id;

  -- Return job details with scenes and campaign info
  RETURN QUERY
  SELECT
    v_job_id as job_id,
    v_render_id as render_id,
    c.id as campaign_id,
    c.name as campaign_name,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'url', s.url,
          'duration_sec', s.duration_sec,
          'order_index', s.order_index,
          'entry_type', s.entry_type,
          'csv_column', s.csv_column
        ) ORDER BY s.order_index
      )
      FROM scenes s
      WHERE s.campaign_id = c.id
    ) as scenes,
    c.facecam_url,
    c.lead_csv_url,
    j.lead_row_index,
    jsonb_build_object(
      'width', COALESCE(c.output_width, 1920),
      'height', COALESCE(c.output_height, 1080),
      'fps', COALESCE(c.output_fps, 60),
      'facecam', jsonb_build_object(
        'pip', jsonb_build_object(
          'width', 320,
          'margin', 24,
          'corner', 'bottom-right'
        ),
        'endPadMode', 'freeze'
      )
    ) as output_settings
  FROM campaigns c
  JOIN render_jobs j ON j.id = v_job_id
  WHERE c.id = v_campaign_id;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION claim_render_job() TO service_role;

-- Instructions:
-- 1. Go to your Supabase Dashboard
-- 2. Navigate to SQL Editor
-- 3. Create a new query
-- 4. Paste this entire script
-- 5. Click "Run"
--
-- This will add all missing columns and update the claim function to work properly.
