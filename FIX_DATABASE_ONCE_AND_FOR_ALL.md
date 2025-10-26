# 🔥 Fix Database Once and For All

## The Root Problem

Your database is missing essential columns that the worker needs:
- `render_jobs` table is missing: `updated_at`, `started_at`, `completed_at`, `campaign_id`
- `renders` table is missing: `updated_at`, `completed_at`, `error_message`
- `campaigns` table is missing: `facecam_url`, `output_width`, `output_height`, `output_fps`

## The Permanent Fix (1 Minute)

### Step 1: Run the Complete Schema Setup

1. **Open Supabase Dashboard** → **SQL Editor**
2. **Click "New query"**
3. **Copy the ENTIRE contents** of this file:
   ```
   /Users/Alan Piggott/loom outreach final/loom-lite/migrations/COMPLETE_SCHEMA_SETUP.sql
   ```
4. **Paste it** into the SQL editor
5. **Click "Run"**

### Step 2: Verify It Worked

In the SQL Editor, run this query to check:
```sql
-- Check render_jobs has all columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'render_jobs'
ORDER BY ordinal_position;
```

You should see:
- id
- render_id
- campaign_id ✅ (was missing)
- state
- created_at
- updated_at ✅ (was missing)
- started_at ✅ (was missing)
- completed_at ✅ (was missing)
- error_message ✅ (was missing)

### Step 3: Test the Worker

1. **Restart the worker**:
   ```bash
   Ctrl+C (stop it)
   npm run worker (start again)
   ```

2. **Click "Render"** in your app

3. **Worker should now process successfully!**

## What This Migration Does

✅ **Adds ALL missing columns** to all tables
✅ **Is idempotent** - can run multiple times safely
✅ **Creates triggers** for auto-updating timestamps
✅ **Updates the claim function** to use the schema
✅ **Creates indexes** for performance
✅ **Checks before adding** - won't duplicate columns

## Why This Is the Proper Fix

Instead of patching issues one by one, this migration:
1. Defines the complete schema the worker expects
2. Handles both new and existing databases
3. Uses proper PostgreSQL patterns (DO blocks, IF NOT EXISTS)
4. Sets up everything in one go

## Complete Table Schema After Migration

### campaigns
- id (uuid)
- name (text)
- user_id (uuid)
- **facecam_url** (text) ✅
- **output_width** (int) ✅
- **output_height** (int) ✅
- **output_fps** (int) ✅
- created_at (timestamp)

### renders
- id (uuid)
- campaign_id (uuid)
- status (text)
- progress (int)
- final_video_url (text)
- thumb_url (text)
- public_id (text)
- duration_sec (int)
- **updated_at** (timestamp) ✅
- **completed_at** (timestamp) ✅
- **error_message** (text) ✅
- created_at (timestamp)

### render_jobs
- id (uuid)
- render_id (uuid)
- **campaign_id** (uuid) ✅
- state (text)
- **updated_at** (timestamp) ✅
- **started_at** (timestamp) ✅
- **completed_at** (timestamp) ✅
- **error_message** (text) ✅
- created_at (timestamp)

### scenes
- id (uuid)
- campaign_id (uuid)
- url (text)
- duration_sec (int)
- order_index (int)
- created_at (timestamp)

## If You Still Get Errors

If after running the migration you still get column errors:

1. **Check if the migration ran successfully**:
   - Look for any red error messages in SQL Editor
   - Should see green "Success" message

2. **Ensure you're connected to the right database**:
   - Check you're in the correct Supabase project
   - Verify the URL in your .env matches

3. **Force a schema refresh**:
   - In Supabase Dashboard, go to Database → Tables
   - Click refresh icon
   - Check the columns are there

4. **Nuclear option** (last resort):
   ```sql
   -- Drop and recreate the claim function
   DROP FUNCTION IF EXISTS claim_render_job();
   -- Then run the migration again
   ```

## This Is Now Fixed Properly

No more:
- Missing column errors ❌
- Hacky workarounds ❌
- Partial fixes ❌

Just a proper, complete database schema that works! ✅