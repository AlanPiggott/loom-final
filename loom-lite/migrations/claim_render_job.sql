-- Function: claim_render_job()
-- Purpose: Atomically claim the oldest queued render job for processing
-- Returns: Job details including render_id, campaign_id, and scenes
--
-- This function uses FOR UPDATE SKIP LOCKED to ensure only one worker
-- can claim a specific job, preventing race conditions in multi-worker setups

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
  SELECT j.id, j.render_id
  INTO v_job_id, v_render_id
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

  -- Get campaign_id from renders table
  SELECT r.campaign_id
  INTO v_campaign_id
  FROM renders r
  WHERE r.id = v_render_id;

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

-- Grant execute permission to service role (worker will use service key)
GRANT EXECUTE ON FUNCTION claim_render_job() TO service_role;

-- Optional: Create an index on render_jobs for better performance
CREATE INDEX IF NOT EXISTS idx_render_jobs_state_created
ON render_jobs(state, created_at)
WHERE state = 'queued';

-- Instructions for running this migration:
-- 1. Go to your Supabase dashboard
-- 2. Navigate to SQL Editor
-- 3. Create a new query
-- 4. Paste this entire SQL script
-- 5. Run the query
--
-- Note: If your campaigns table doesn't have facecam_url or output settings columns,
-- you may need to adjust this function to match your actual schema.
-- The function assumes:
-- - campaigns table exists with: id, name, user_id
-- - scenes table exists with: id, campaign_id, url, duration_sec, order_index
-- - renders table exists with: id, campaign_id, status, progress
-- - render_jobs table exists with: id, render_id, state, created_at, started_at
