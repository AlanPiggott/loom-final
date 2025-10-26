-- Fix Row Level Security for render_jobs table
-- This allows users to create render jobs for their own campaigns

-- Enable RLS on render_jobs if not already enabled
ALTER TABLE render_jobs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can insert render jobs for their campaigns" ON render_jobs;
DROP POLICY IF EXISTS "Users can view their own render jobs" ON render_jobs;
DROP POLICY IF EXISTS "Service role has full access to render jobs" ON render_jobs;

-- Policy 1: Users can create render jobs for renders they own
CREATE POLICY "Users can insert render jobs for their campaigns"
ON render_jobs FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM renders r
    JOIN campaigns c ON r.campaign_id = c.id
    WHERE r.id = render_jobs.render_id
    AND c.user_id = auth.uid()
  )
);

-- Policy 2: Users can view render jobs for their campaigns
CREATE POLICY "Users can view their own render jobs"
ON render_jobs FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM renders r
    JOIN campaigns c ON r.campaign_id = c.id
    WHERE r.id = render_jobs.render_id
    AND c.user_id = auth.uid()
  )
);

-- Policy 3: Service role (worker) has full access
CREATE POLICY "Service role has full access to render jobs"
ON render_jobs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Also ensure renders table has proper RLS policies
ALTER TABLE renders ENABLE ROW LEVEL SECURITY;

-- Drop and recreate renders policies
DROP POLICY IF EXISTS "Users can insert renders for their campaigns" ON renders;
DROP POLICY IF EXISTS "Users can view their own renders" ON renders;
DROP POLICY IF EXISTS "Users can update their own renders" ON renders;
DROP POLICY IF EXISTS "Service role has full access to renders" ON renders;

-- Users can create renders for their campaigns
CREATE POLICY "Users can insert renders for their campaigns"
ON renders FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.id = renders.campaign_id
    AND c.user_id = auth.uid()
  )
);

-- Users can view renders for their campaigns
CREATE POLICY "Users can view their own renders"
ON renders FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.id = renders.campaign_id
    AND c.user_id = auth.uid()
  )
);

-- Users can update their own renders (for status polling)
CREATE POLICY "Users can update their own renders"
ON renders FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.id = renders.campaign_id
    AND c.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.id = renders.campaign_id
    AND c.user_id = auth.uid()
  )
);

-- Service role (worker) has full access to renders
CREATE POLICY "Service role has full access to renders"
ON renders FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Instructions:
-- 1. Go to your Supabase Dashboard
-- 2. Navigate to SQL Editor
-- 3. Create a new query
-- 4. Paste this entire script
-- 5. Click "Run"
--
-- This will fix the RLS policies so that:
-- - Authenticated users can create/view render jobs for their own campaigns
-- - The worker (using service role key) can access all jobs
-- - Security is maintained - users can only see their own data