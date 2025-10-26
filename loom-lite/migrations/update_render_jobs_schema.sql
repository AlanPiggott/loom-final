-- Update render_jobs table to include campaign_id if it doesn't exist
-- This ensures compatibility with the API

-- Add campaign_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name='render_jobs'
        AND column_name='campaign_id'
    ) THEN
        ALTER TABLE render_jobs
        ADD COLUMN campaign_id UUID NOT NULL
        REFERENCES campaigns(id) ON DELETE CASCADE;

        -- Create index for better query performance
        CREATE INDEX idx_render_jobs_campaign_id
        ON render_jobs(campaign_id);
    END IF;
END $$;

-- Ensure scenes table tracks entry metadata for CSV-driven campaigns
ALTER TABLE scenes
ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS csv_column TEXT;

UPDATE scenes
SET entry_type = 'manual'
WHERE entry_type IS NULL;

-- Ensure campaigns store lead CSV metadata
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS lead_csv_url TEXT,
ADD COLUMN IF NOT EXISTS lead_csv_path TEXT,
ADD COLUMN IF NOT EXISTS lead_csv_filename TEXT,
ADD COLUMN IF NOT EXISTS lead_row_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS csv_headers TEXT[];

-- Ensure renders and render_jobs track lead row indices
ALTER TABLE renders
ADD COLUMN IF NOT EXISTS lead_row_index INTEGER,
ADD COLUMN IF NOT EXISTS lead_identifier TEXT;

ALTER TABLE render_jobs
ADD COLUMN IF NOT EXISTS lead_row_index INTEGER;

-- Update the claim_render_job function to use the campaign_id directly
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

-- Instructions:
-- 1. Go to your Supabase Dashboard
-- 2. Navigate to SQL Editor
-- 3. Paste and run this script
-- This will:
-- - Add campaign_id column to render_jobs if missing
-- - Update the claim function to use campaign_id directly from render_jobs
-- - Create proper foreign key relationships
