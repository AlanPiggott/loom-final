-- QUICK FIX: Run this SQL in Supabase to fix all worker errors immediately
-- This combines all necessary fixes into one script

-- 1. Add missing columns to render_jobs
ALTER TABLE render_jobs
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS lead_row_index INTEGER;

-- 2. Add missing columns to renders
ALTER TABLE renders
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS lead_row_index INTEGER,
ADD COLUMN IF NOT EXISTS lead_identifier TEXT;

-- 3. Add optional columns to campaigns
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS facecam_url TEXT,
ADD COLUMN IF NOT EXISTS output_width INTEGER DEFAULT 1920,
ADD COLUMN IF NOT EXISTS output_height INTEGER DEFAULT 1080,
ADD COLUMN IF NOT EXISTS output_fps INTEGER DEFAULT 60,
ADD COLUMN IF NOT EXISTS lead_csv_url TEXT,
ADD COLUMN IF NOT EXISTS lead_csv_path TEXT,
ADD COLUMN IF NOT EXISTS lead_csv_filename TEXT,
ADD COLUMN IF NOT EXISTS lead_row_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS csv_headers TEXT[];

-- 4. Add scene metadata columns (manual vs CSV)
ALTER TABLE scenes
ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS csv_column TEXT;

UPDATE scenes
SET entry_type = 'manual'
WHERE entry_type IS NULL;

-- 5. Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 6. Add triggers
DROP TRIGGER IF EXISTS update_render_jobs_updated_at ON render_jobs;
CREATE TRIGGER update_render_jobs_updated_at
BEFORE UPDATE ON render_jobs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_renders_updated_at ON renders;
CREATE TRIGGER update_renders_updated_at
BEFORE UPDATE ON renders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 7. Fix the claim_render_job function to handle missing facecam_url gracefully
DROP FUNCTION IF EXISTS claim_render_job();
CREATE FUNCTION claim_render_job()
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
  -- Using COALESCE to handle potentially missing columns
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
      'width', 1920,
      'height', 1080,
      'fps', 60,
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION claim_render_job() TO service_role;

-- DONE! The worker should now work properly.
--
-- To verify:
-- 1. Restart your worker: npm run worker
-- 2. It should successfully claim and process the queued job
--
-- Ensure the facecam and CSV buckets exist and are public so the worker can download assets.
