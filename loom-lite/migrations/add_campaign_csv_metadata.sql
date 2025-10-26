-- Add lead CSV metadata support to campaigns, renders, and render jobs

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS lead_csv_url TEXT,
  ADD COLUMN IF NOT EXISTS lead_csv_path TEXT,
  ADD COLUMN IF NOT EXISTS lead_csv_filename TEXT,
  ADD COLUMN IF NOT EXISTS lead_row_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS csv_headers TEXT[];

ALTER TABLE renders
  ADD COLUMN IF NOT EXISTS lead_row_index INTEGER,
  ADD COLUMN IF NOT EXISTS lead_identifier TEXT;

ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS lead_row_index INTEGER;

-- Refresh claim_render_job so workers receive the additional metadata
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
  SELECT j.id, j.render_id, j.campaign_id
  INTO v_job_id, v_render_id, v_campaign_id
  FROM render_jobs j
  WHERE j.state = 'queued'
  ORDER BY j.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE render_jobs
  SET state = 'running', started_at = NOW(), updated_at = NOW()
  WHERE id = v_job_id;

  UPDATE renders
  SET status = 'recording', progress = 5, updated_at = NOW()
  WHERE id = v_render_id;

  RETURN QUERY
  SELECT
    v_job_id AS job_id,
    v_render_id AS render_id,
    c.id AS campaign_id,
    c.name AS campaign_name,
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
    ) AS scenes,
    c.facecam_url,
    c.lead_csv_url,
    j.lead_row_index,
    jsonb_build_object(
      'width', COALESCE(c.output_width, 1920),
      'height', COALESCE(c.output_height, 1080),
      'fps', COALESCE(c.output_fps, 60),
      'facecam', jsonb_build_object(
        'pip', jsonb_build_object('width', 320, 'margin', 24, 'corner', 'bottom-right'),
        'endPadMode', 'freeze'
      )
    ) AS output_settings
  FROM campaigns c
  JOIN render_jobs j ON j.id = v_job_id
  WHERE c.id = v_campaign_id;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_render_job() TO service_role;
