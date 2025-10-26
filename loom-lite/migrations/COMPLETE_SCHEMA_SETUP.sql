-- ============================================================================
-- COMPLETE DATABASE SCHEMA SETUP FOR LOOM-LITE
-- ============================================================================
-- This migration sets up the complete database schema required for the worker.
-- It can be run on new or existing databases - it checks for existing columns
-- and only adds what's missing.
--
-- RUN THIS IN SUPABASE SQL EDITOR TO FIX ALL DATABASE ISSUES
-- ============================================================================

-- ============================================================================
-- 1. CAMPAIGNS TABLE - Add missing columns
-- ============================================================================

-- Add facecam_url column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='campaigns' AND column_name='facecam_url'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN facecam_url TEXT;
    END IF;
END $$;

-- Add output configuration columns if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='campaigns' AND column_name='output_width'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN output_width INTEGER DEFAULT 1920;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='campaigns' AND column_name='output_height'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN output_height INTEGER DEFAULT 1080;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='campaigns' AND column_name='output_fps'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN output_fps INTEGER DEFAULT 60;
    END IF;
END $$;

-- Add lead CSV metadata columns if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='campaigns' AND column_name='lead_csv_url'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN lead_csv_url TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='campaigns' AND column_name='lead_csv_path'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN lead_csv_path TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='campaigns' AND column_name='lead_csv_filename'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN lead_csv_filename TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='campaigns' AND column_name='lead_row_count'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN lead_row_count INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='campaigns' AND column_name='csv_headers'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN csv_headers TEXT[];
    END IF;
END $$;

-- ============================================================================
-- 2. RENDERS TABLE - Add missing columns
-- ============================================================================

-- Add updated_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='renders' AND column_name='updated_at'
    ) THEN
        ALTER TABLE renders ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- Add completed_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='renders' AND column_name='completed_at'
    ) THEN
        ALTER TABLE renders ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add error_message column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='renders' AND column_name='error_message'
    ) THEN
        ALTER TABLE renders ADD COLUMN error_message TEXT;
    END IF;
END $$;

-- Add lead row metadata columns to renders table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='renders' AND column_name='lead_row_index'
    ) THEN
        ALTER TABLE renders ADD COLUMN lead_row_index INTEGER;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='renders' AND column_name='lead_identifier'
    ) THEN
        ALTER TABLE renders ADD COLUMN lead_identifier TEXT;
    END IF;
END $$;

-- ============================================================================
-- 3. RENDER_JOBS TABLE - Add missing columns
-- ============================================================================

-- Add campaign_id column if it doesn't exist (with foreign key)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='render_jobs' AND column_name='campaign_id'
    ) THEN
        ALTER TABLE render_jobs ADD COLUMN campaign_id UUID;

        -- Add foreign key constraint if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name='render_jobs_campaign_id_fkey'
        ) THEN
            ALTER TABLE render_jobs
            ADD CONSTRAINT render_jobs_campaign_id_fkey
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
        END IF;

        -- Create index for better performance
        CREATE INDEX IF NOT EXISTS idx_render_jobs_campaign_id
        ON render_jobs(campaign_id);
    END IF;
END $$;

-- Add updated_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='render_jobs' AND column_name='updated_at'
    ) THEN
        ALTER TABLE render_jobs ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- Add started_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='render_jobs' AND column_name='started_at'
    ) THEN
        ALTER TABLE render_jobs ADD COLUMN started_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add completed_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='render_jobs' AND column_name='completed_at'
    ) THEN
        ALTER TABLE render_jobs ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add error_message column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='render_jobs' AND column_name='error_message'
    ) THEN
        ALTER TABLE render_jobs ADD COLUMN error_message TEXT;
    END IF;
END $$;

-- Add lead row index to render_jobs table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='render_jobs' AND column_name='lead_row_index'
    ) THEN
        ALTER TABLE render_jobs ADD COLUMN lead_row_index INTEGER;
    END IF;
END $$;

-- ============================================================================
-- 4. SCENES TABLE - Add metadata columns
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='scenes' AND column_name='entry_type'
    ) THEN
        ALTER TABLE scenes ADD COLUMN entry_type TEXT DEFAULT 'manual';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='scenes' AND column_name='csv_column'
    ) THEN
        ALTER TABLE scenes ADD COLUMN csv_column TEXT;
    END IF;
END $$;

UPDATE scenes
SET entry_type = 'manual'
WHERE entry_type IS NULL;

-- ============================================================================
-- 5. CREATE TRIGGERS FOR AUTO-UPDATING updated_at
-- ============================================================================

-- Create or replace the trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for renders table
DROP TRIGGER IF EXISTS update_renders_updated_at ON renders;
CREATE TRIGGER update_renders_updated_at
BEFORE UPDATE ON renders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for render_jobs table
DROP TRIGGER IF EXISTS update_render_jobs_updated_at ON render_jobs;
CREATE TRIGGER update_render_jobs_updated_at
BEFORE UPDATE ON render_jobs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for campaigns table (if updated_at exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='campaigns' AND column_name='updated_at'
    ) THEN
        DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns;
        CREATE TRIGGER update_campaigns_updated_at
        BEFORE UPDATE ON campaigns
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ============================================================================
-- 6. CREATE OR REPLACE THE claim_render_job FUNCTION
-- ============================================================================

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

  -- Update the job state to running with timestamps
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

-- Grant execute permission to service role (worker uses service key)
GRANT EXECUTE ON FUNCTION claim_render_job() TO service_role;
-- Also grant to authenticated role for testing
GRANT EXECUTE ON FUNCTION claim_render_job() TO authenticated;

-- ============================================================================
-- 7. CREATE INDEXES FOR BETTER PERFORMANCE
-- ============================================================================

-- Index for render_jobs state queries
CREATE INDEX IF NOT EXISTS idx_render_jobs_state_created
ON render_jobs(state, created_at)
WHERE state = 'queued';

-- Index for renders status queries
CREATE INDEX IF NOT EXISTS idx_renders_status
ON renders(status);

-- Index for renders by campaign
CREATE INDEX IF NOT EXISTS idx_renders_campaign_id
ON renders(campaign_id);

-- ============================================================================
-- 8. VERIFY THE SCHEMA
-- ============================================================================

-- Show the final table structures
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Schema setup complete! Tables now have:';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'campaigns table columns:';
    RAISE NOTICE '  - facecam_url (TEXT)';
    RAISE NOTICE '  - output_width (INTEGER, default 1920)';
    RAISE NOTICE '  - output_height (INTEGER, default 1080)';
    RAISE NOTICE '  - output_fps (INTEGER, default 60)';
    RAISE NOTICE '';
    RAISE NOTICE 'renders table columns:';
    RAISE NOTICE '  - updated_at (TIMESTAMP WITH TIME ZONE)';
    RAISE NOTICE '  - completed_at (TIMESTAMP WITH TIME ZONE)';
    RAISE NOTICE '  - error_message (TEXT)';
    RAISE NOTICE '';
    RAISE NOTICE 'render_jobs table columns:';
    RAISE NOTICE '  - campaign_id (UUID)';
    RAISE NOTICE '  - updated_at (TIMESTAMP WITH TIME ZONE)';
    RAISE NOTICE '  - started_at (TIMESTAMP WITH TIME ZONE)';
    RAISE NOTICE '  - completed_at (TIMESTAMP WITH TIME ZONE)';
    RAISE NOTICE '  - error_message (TEXT)';
    RAISE NOTICE '';
    RAISE NOTICE 'Functions:';
    RAISE NOTICE '  - claim_render_job() - Ready for worker';
    RAISE NOTICE '  - update_updated_at_column() - Trigger function';
    RAISE NOTICE '';
    RAISE NOTICE 'Triggers:';
    RAISE NOTICE '  - update_renders_updated_at';
    RAISE NOTICE '  - update_render_jobs_updated_at';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Database is ready for the worker!';
END $$;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
-- To verify everything worked, you can run these queries:
--
-- Check render_jobs columns:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'render_jobs' ORDER BY ordinal_position;
--
-- Check renders columns:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'renders' ORDER BY ordinal_position;
--
-- Check campaigns columns:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'campaigns' ORDER BY ordinal_position;
--
-- Test the claim function:
-- SELECT * FROM claim_render_job();
