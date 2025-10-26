require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Validate environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required Supabase environment variables');
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file');
  process.exit(1);
}

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Update render status and progress
 */
async function updateRenderProgress(renderId, status, progress, error = null) {
  const updates = {
    status,
    progress,
    updated_at: new Date().toISOString(),
  };

  if (error) {
    updates.error_message = error;
  }

  const { error: updateError } = await supabase
    .from('renders')
    .update(updates)
    .eq('id', renderId);

  if (updateError) {
    console.error('[supabase] Error updating render progress:', updateError);
    throw updateError;
  }

  console.log(`[supabase] Render ${renderId}: ${status} (${progress}%)`);
}

/**
 * Update job state
 */
async function updateJobState(jobId, state, error = null) {
  const updates = {
    state,
    updated_at: new Date().toISOString(),
  };

  if (state === 'completed') {
    updates.completed_at = new Date().toISOString();
  }

  if (error) {
    updates.error_message = error;
  }

  const { error: updateError } = await supabase
    .from('render_jobs')
    .update(updates)
    .eq('id', jobId);

  if (updateError) {
    console.error('[supabase] Error updating job state:', updateError);
    throw updateError;
  }

  console.log(`[supabase] Job ${jobId}: ${state}`);
}

/**
 * Claim a render job atomically
 */
async function claimRenderJob() {
  const { data, error } = await supabase.rpc('claim_render_job');

  if (error) {
    // It's normal to have no jobs available
    if (error.message?.includes('No rows returned')) {
      return null;
    }
    console.error('[supabase] Error claiming job:', error);
    throw error;
  }

  // RPC returns an array, get first result
  return data?.[0] || null;
}

/**
 * Download file from URL
 */
async function downloadFile(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    console.error('[supabase] Error downloading file:', error);
    throw error;
  }
}

/**
 * Update render with final URLs
 */
async function updateRenderComplete(renderId, videoUrl, thumbUrl) {
  const { error } = await supabase
    .from('renders')
    .update({
      final_video_url: videoUrl,
      thumb_url: thumbUrl,
      status: 'done',
      progress: 100,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', renderId);

  if (error) {
    console.error('[supabase] Error updating render complete:', error);
    throw error;
  }

  console.log(`[supabase] Render ${renderId}: COMPLETED`);
}

module.exports = {
  supabase,
  updateRenderProgress,
  updateJobState,
  claimRenderJob,
  downloadFile,
  updateRenderComplete,
};
