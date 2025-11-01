# Production Launch Roadmap - Loom-Lite Video Platform

**Timeline**: 4 weeks to production launch
**Status**: Video generation working, needs infrastructure + frontend completion
**Last Updated**: 2025-10-31

---

## Executive Summary

### Current State
✅ **Working**:
- Video rendering pipeline (record → normalize → concat → overlay → thumbnail)
- HME (Human Motion Engine) for natural interactions
- Worker system with job claiming
- Database integration (Supabase)
- Storage upload (Bunny CDN)
- Progress tracking
- Error retry logic

❌ **Critical Gaps**:
- No widget initialization (Calendly/embeds show white screens)
- No disk cleanup (will fill disk and crash)
- No cancellation support (wastes Steel minutes)
- Settings page missing
- Stripe integration unclear/disconnected
- Homepage not built
- Video landing pages bare-bones
- Custom subdomain support missing

### 4-Week Sprint Plan

**Week 1**: Core Infrastructure (Backend)
**Week 2**: Essential Frontend (Dashboard, Settings, Landing Pages)
**Week 3**: Go-to-Market (Homepage, Billing)
**Week 4**: Launch Prep (Testing, Monitoring, Soft Launch)

---

## PHASE 1: Core Infrastructure (Week 1)

### 1.1 Widget Readiness - Calendly/Embed Fix

**Priority**: 🚨 CRITICAL
**Effort**: 2-4 hours
**Impact**: Fixes white screens on all embedded widgets (Calendly, Typeform, HubSpot, Intercom)

#### Problem
Modern widgets use "lazy-load gates" - they wait for browser visibility signals before initializing. Steel's remote compositor doesn't automatically provide these signals, so widgets never load.

#### Solution
Add CDP (Chrome DevTools Protocol) lifecycle calls + early-paint triggers to ensure pages are treated as visible/active.

#### Implementation

**File**: `src/recording/recordScene.js`

**Step 1**: Add helper function after imports (around line 20)

```javascript
/**
 * Ensure embedded widgets initialize properly in headless environment
 * Uses CDP and standard Web APIs to trigger lazy-load gates
 */
async function ensureWidgetsReady(page) {
  console.log('[recordScene] Initializing widgets for headless environment...');

  try {
    // Create CDP session for lifecycle control
    const cdp = await page.context().newCDPSession(page);

    // Set page as visible, active, and focused (triggers visibility-based lazy loading)
    await cdp.send('Page.bringToFront').catch(() => {});
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

    console.log('[recordScene] ✓ Page lifecycle set to active/visible');
  } catch (err) {
    console.warn('[recordScene] CDP lifecycle setup failed (non-fatal):', err.message);
  }

  // Wait for fonts to load (many widgets wait for this)
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  console.log('[recordScene] ✓ Fonts ready');

  // Trigger standard browser events that lazy-load widgets listen for
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
    // Micro-scroll to trigger scroll listeners
    window.scrollBy(0, 1);
    window.scrollBy(0, -1);
  }).catch(() => {});
  console.log('[recordScene] ✓ Triggered resize/scroll events');

  // Double rAF for compositor synchronization
  await page.evaluate(() => new Promise(r =>
    requestAnimationFrame(() => requestAnimationFrame(r))
  )).catch(() => {});

  // Allow widgets time to initialize (1.5s for API calls, iframe loads, animations)
  await page.waitForTimeout(1500);
  console.log('[recordScene] ✓ Widgets ready');
}
```

**Step 2**: Call it in recordScene after networkidle wait (around line 395)

Find this code:
```javascript
// Wait for network to settle
await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
```

Add immediately after:
```javascript
// Wait for network to settle
await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

// NEW: Ensure widgets are ready
await ensureWidgetsReady(page);

// Hide mask (if applicable)
await hideMask(page);
```

#### Testing
1. Test with Calendly embed: `https://calendly.com/your-page`
2. Test with Typeform: `https://form.typeform.com/to/xyz`
3. Verify widgets render in final video
4. Check recording time increase (~1.5s per scene)

#### Success Criteria
- [ ] Calendly embeds show booking interface (not white screen)
- [ ] Typeform embeds show form fields
- [ ] HubSpot chat widgets appear
- [ ] No impact on non-widget pages

---

### 1.2 Disk Cleanup Management

**Priority**: 🚨 CRITICAL
**Effort**: 4-6 hours
**Impact**: Prevents out-of-disk failures in production

#### Problem
Line 271-273 in `src/worker.js` has cleanup commented out:
```javascript
// Clean up work directory (optional)
// You might want to keep it for debugging
// fs.rmSync(campaignDir, { recursive: true, force: true });
```

At scale: 100 renders × 2GB = 200GB disk usage. This will cause system failures.

#### Solution
Implement smart cleanup with retention policy for debugging.

#### Implementation

**File**: `src/worker.js`

**Step 1**: Add cleanup configuration (after imports, ~line 22)

```javascript
// Cleanup configuration
const CLEANUP_ENABLED = process.env.CLEANUP_ENABLED !== 'false'; // Default: true
const FAILED_RENDER_RETENTION_DAYS = parseInt(process.env.FAILED_RENDER_RETENTION_DAYS) || 7;
const SUCCESS_RENDER_RETENTION_HOURS = parseInt(process.env.SUCCESS_RENDER_RETENTION_HOURS) || 1;
```

**Step 2**: Add cleanup helper function (after getCsvRows, ~line 60)

```javascript
/**
 * Clean up campaign directory based on retention policy
 * @param {string} campaignDir - Directory to clean up
 * @param {boolean} wasSuccessful - Whether render succeeded
 */
async function cleanupCampaignDir(campaignDir, wasSuccessful) {
  if (!CLEANUP_ENABLED) {
    console.log('[worker] Cleanup disabled, keeping directory:', campaignDir);
    return;
  }

  if (!fs.existsSync(campaignDir)) {
    return; // Already cleaned or doesn't exist
  }

  try {
    if (wasSuccessful) {
      // Successful renders: cleanup after short delay (allow for debugging if needed)
      console.log(`[worker] Scheduling cleanup of successful render in ${SUCCESS_RENDER_RETENTION_HOURS}h: ${campaignDir}`);
      setTimeout(() => {
        if (fs.existsSync(campaignDir)) {
          fs.rmSync(campaignDir, { recursive: true, force: true });
          console.log('[worker] ✓ Cleaned up successful render:', campaignDir);
        }
      }, SUCCESS_RENDER_RETENTION_HOURS * 3600 * 1000);
    } else {
      // Failed renders: keep for debugging based on retention policy
      const retentionMs = FAILED_RENDER_RETENTION_DAYS * 24 * 3600 * 1000;
      console.log(`[worker] Failed render will be kept for ${FAILED_RENDER_RETENTION_DAYS} days: ${campaignDir}`);

      // Schedule cleanup after retention period
      setTimeout(() => {
        if (fs.existsSync(campaignDir)) {
          fs.rmSync(campaignDir, { recursive: true, force: true });
          console.log('[worker] ✓ Cleaned up failed render after retention:', campaignDir);
        }
      }, retentionMs);
    }
  } catch (error) {
    console.error('[worker] Error scheduling cleanup:', error);
    // Don't throw - cleanup failure shouldn't break render
  }
}
```

**Step 3**: Replace comment at line 271-273

Find:
```javascript
// Clean up work directory (optional)
// You might want to keep it for debugging
// fs.rmSync(campaignDir, { recursive: true, force: true });
```

Replace with:
```javascript
// Clean up work directory based on retention policy
await cleanupCampaignDir(campaignDir, true); // true = successful render
```

**Step 4**: Add cleanup for failed renders (in catch block, ~line 283)

Find:
```javascript
} catch (error) {
  console.error(`[worker] ❌ Job ${job_id} failed:`, error);

  // Update render status to failed
  await updateRenderProgress(render_id, 'failed', 0, error.message);

  // Mark job as failed
  await updateJobState(job_id, 'failed', error.message);

  throw error; // Re-throw to handle in the polling loop
}
```

Add before `throw error`:
```javascript
} catch (error) {
  console.error(`[worker] ❌ Job ${job_id} failed:`, error);

  // Update render status to failed
  await updateRenderProgress(render_id, 'failed', 0, error.message);

  // Mark job as failed
  await updateJobState(job_id, 'failed', error.message);

  // Clean up failed render (with retention)
  if (typeof campaignDir !== 'undefined') {
    await cleanupCampaignDir(campaignDir, false); // false = failed render
  }

  throw error; // Re-throw to handle in the polling loop
}
```

**Step 5**: Add periodic cleanup cron job

Create new file: `src/scripts/cleanup-old-renders.js`

```javascript
#!/usr/bin/env node
/**
 * Cleanup old render directories
 * Run this as a cron job: 0 2 * * * (daily at 2am)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CAMPAIGNS_DIR = path.join(process.cwd(), 'campaigns');
const MAX_AGE_DAYS = parseInt(process.env.CLEANUP_MAX_AGE_DAYS) || 30;

async function cleanupOldDirectories() {
  console.log('[cleanup] Starting cleanup of old render directories...');
  console.log(`[cleanup] Campaigns directory: ${CAMPAIGNS_DIR}`);
  console.log(`[cleanup] Max age: ${MAX_AGE_DAYS} days`);

  if (!fs.existsSync(CAMPAIGNS_DIR)) {
    console.log('[cleanup] Campaigns directory does not exist, nothing to clean');
    return;
  }

  const now = Date.now();
  const maxAgeMs = MAX_AGE_DAYS * 24 * 3600 * 1000;
  let cleanedCount = 0;
  let freedBytes = 0;

  const dirs = fs.readdirSync(CAMPAIGNS_DIR);

  for (const dir of dirs) {
    const fullPath = path.join(CAMPAIGNS_DIR, dir);

    try {
      const stats = fs.statSync(fullPath);

      if (!stats.isDirectory()) continue;

      const ageMs = now - stats.mtimeMs;

      if (ageMs > maxAgeMs) {
        // Calculate directory size before deletion
        const size = getDirectorySize(fullPath);

        console.log(`[cleanup] Deleting ${dir} (age: ${Math.floor(ageMs / (24 * 3600 * 1000))} days, size: ${formatBytes(size)})`);
        fs.rmSync(fullPath, { recursive: true, force: true });

        cleanedCount++;
        freedBytes += size;
      }
    } catch (error) {
      console.error(`[cleanup] Error processing ${dir}:`, error.message);
    }
  }

  console.log(`[cleanup] ✓ Cleanup complete:`);
  console.log(`[cleanup]   - Directories deleted: ${cleanedCount}`);
  console.log(`[cleanup]   - Space freed: ${formatBytes(freedBytes)}`);
}

function getDirectorySize(dirPath) {
  let size = 0;

  try {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        size += getDirectorySize(filePath);
      } else {
        size += stats.size;
      }
    }
  } catch (error) {
    console.error(`Error calculating size for ${dirPath}:`, error.message);
  }

  return size;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Run cleanup
cleanupOldDirectories().catch(error => {
  console.error('[cleanup] Fatal error:', error);
  process.exit(1);
});
```

**Step 6**: Add to package.json scripts

```json
{
  "scripts": {
    "cleanup": "node src/scripts/cleanup-old-renders.js"
  }
}
```

**Step 7**: Setup cron job

Add to crontab (run `crontab -e`):
```bash
# Cleanup old render directories daily at 2am
0 2 * * * cd /path/to/loom-lite && npm run cleanup >> logs/cleanup.log 2>&1
```

Or use PM2 cron (recommended):
```bash
pm2 start src/scripts/cleanup-old-renders.js --cron "0 2 * * *" --name "cleanup-cron" --no-autorestart
```

#### Environment Variables

Add to `.env`:
```bash
# Cleanup configuration
CLEANUP_ENABLED=true
FAILED_RENDER_RETENTION_DAYS=7
SUCCESS_RENDER_RETENTION_HOURS=1
CLEANUP_MAX_AGE_DAYS=30
```

#### Testing
```bash
# Test with cleanup disabled
CLEANUP_ENABLED=false npm run worker

# Test manual cleanup script
npm run cleanup

# Monitor disk usage
df -h
du -sh campaigns/
```

#### Success Criteria
- [ ] Successful renders cleaned after 1 hour
- [ ] Failed renders kept for 7 days
- [ ] Cron job running daily
- [ ] Disk usage stays below 50GB

---

### 1.3 Cancellation Support

**Priority**: 🚨 CRITICAL
**Effort**: 6-8 hours
**Impact**: Prevents wasted Steel minutes, improves UX

#### Problem
Once a render starts, there's no way to stop it. User must wait 2-5 minutes for completion even if they configured it wrong. Wastes Steel minutes = $$$.

#### Solution
Add cancellation flag that's checked between each scene recording. Allow graceful shutdown with cleanup.

#### Implementation

**Step 1**: Database Migration

Create file: `migrations/add_cancellation_support.sql`

```sql
-- Add cancellation support to renders table
ALTER TABLE renders
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_renders_cancelled_at ON renders(cancelled_at) WHERE cancelled_at IS NOT NULL;

-- Add helper function to cancel render
CREATE OR REPLACE FUNCTION cancel_render(p_render_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_status TEXT;
BEGIN
  -- Get current status
  SELECT status INTO v_current_status
  FROM renders
  WHERE id = p_render_id;

  -- Only allow cancellation of in-progress renders
  IF v_current_status NOT IN ('queued', 'recording', 'normalizing', 'concatenating', 'overlaying', 'creating_thumbnail', 'uploading') THEN
    RETURN FALSE;
  END IF;

  -- Mark as cancelled
  UPDATE renders
  SET
    cancelled_at = NOW(),
    status = 'cancelled',
    updated_at = NOW()
  WHERE id = p_render_id;

  -- Mark associated job as cancelled
  UPDATE render_jobs
  SET
    state = 'cancelled',
    updated_at = NOW()
  WHERE render_id = p_render_id
    AND state = 'processing';

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION cancel_render(UUID) IS 'Cancel a render if it is in progress. Returns true if cancelled, false if already completed/failed.';
```

Run migration:
```bash
# Using Supabase CLI
supabase db push migrations/add_cancellation_support.sql

# Or via Supabase dashboard SQL editor
```

**Step 2**: Add checkCancellation helper to supabase.js

**File**: `src/lib/supabase.js`

Add new function before `module.exports`:

```javascript
/**
 * Check if render has been cancelled
 * @param {string} renderId - Render ID to check
 * @returns {Promise<boolean>} True if cancelled
 */
async function checkRenderCancellation(renderId) {
  const { data, error } = await supabase
    .from('renders')
    .select('cancelled_at')
    .eq('id', renderId)
    .single();

  if (error) {
    console.error('[supabase] Error checking cancellation:', error);
    return false; // Assume not cancelled on error
  }

  return data?.cancelled_at !== null;
}

/**
 * Cancel a render
 * @param {string} renderId - Render ID to cancel
 * @returns {Promise<boolean>} True if successfully cancelled
 */
async function cancelRender(renderId) {
  const { data, error } = await supabase
    .rpc('cancel_render', { p_render_id: renderId });

  if (error) {
    console.error('[supabase] Error cancelling render:', error);
    throw error;
  }

  return data;
}
```

Update exports:
```javascript
module.exports = {
  supabase,
  updateRenderProgress,
  updateJobState,
  claimRenderJob,
  downloadFile,
  updateRenderComplete,
  checkRenderCancellation, // NEW
  cancelRender,             // NEW
};
```

**Step 3**: Update worker to check cancellation

**File**: `src/worker.js`

Import new function (top of file):
```javascript
const {
  supabase,
  claimRenderJob,
  updateRenderProgress,
  updateJobState,
  downloadFile,
  updateRenderComplete,
  checkRenderCancellation, // NEW
} = require('./lib/supabase');
```

Add cancellation check helper (after getCsvRows, ~line 60):

```javascript
/**
 * Check if render should be cancelled and handle cleanup
 * @param {string} renderId - Render ID to check
 * @param {string} jobId - Job ID for updating state
 * @param {string} campaignDir - Campaign directory to cleanup
 * @throws {Error} If cancelled
 */
async function checkAndHandleCancellation(renderId, jobId, campaignDir) {
  const isCancelled = await checkRenderCancellation(renderId);

  if (isCancelled) {
    console.log(`[worker] ⚠️  Render ${renderId} has been cancelled by user`);

    // Cleanup campaign directory
    if (campaignDir && fs.existsSync(campaignDir)) {
      try {
        fs.rmSync(campaignDir, { recursive: true, force: true });
        console.log('[worker] ✓ Cleaned up cancelled render directory');
      } catch (error) {
        console.error('[worker] Failed to cleanup cancelled render:', error);
      }
    }

    // Update job state
    await updateJobState(jobId, 'cancelled');

    // Throw to exit processing
    throw new Error('RENDER_CANCELLED_BY_USER');
  }
}
```

Add cancellation checks in processJob function. Find the scene recording loop (~line 123):

```javascript
for (let i = 0; i < cfg.scenes.length; i++) {
  const s = cfg.scenes[i];
  s.isFirstScene = (i === 0);

  // NEW: Check for cancellation before each scene
  await checkAndHandleCancellation(render_id, job_id, campaignDir);

  const cacheKey = getCacheKey(s.url);
  // ... rest of scene recording logic
}
```

Also add before major pipeline steps (~line 238):

```javascript
// Execute pipeline with progress updates
console.log('[worker] Starting video pipeline...');

// NEW: Check cancellation before pipeline
await checkAndHandleCancellation(render_id, job_id, campaignDir);

// Create progress callback
const progressCallback = async (status, progress) => {
  // Check cancellation on every progress update
  await checkAndHandleCancellation(render_id, job_id, campaignDir);
  await updateRenderProgress(render_id, status, progress);
};
```

Update error handling (~line 275):

```javascript
} catch (error) {
  // Check if this was a user cancellation
  if (error.message === 'RENDER_CANCELLED_BY_USER') {
    console.log(`[worker] ✓ Render ${render_id} cancelled gracefully`);
    // Already handled in checkAndHandleCancellation
    return; // Don't re-throw
  }

  console.error(`[worker] ❌ Job ${job_id} failed:`, error);

  // ... rest of error handling
}
```

**Step 4**: Add API endpoint for cancellation

**File**: `vidgen-app/src/app/api/campaigns/[id]/cancel/route.ts`

Create new file:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient();

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const campaignId = params.id;

  try {
    // Get campaign to verify ownership
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('user_id')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (campaign.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get all active renders for this campaign
    const { data: renders, error: rendersError } = await supabase
      .from('renders')
      .select('id, status')
      .eq('campaign_id', campaignId)
      .in('status', ['queued', 'recording', 'normalizing', 'concatenating', 'overlaying', 'creating_thumbnail', 'uploading']);

    if (rendersError) {
      throw rendersError;
    }

    if (!renders || renders.length === 0) {
      return NextResponse.json({
        error: 'No active renders to cancel',
        cancelledCount: 0
      }, { status: 400 });
    }

    // Cancel all active renders
    let cancelledCount = 0;
    for (const render of renders) {
      const { data: cancelled } = await supabase.rpc('cancel_render', {
        p_render_id: render.id
      });

      if (cancelled) {
        cancelledCount++;
      }
    }

    return NextResponse.json({
      success: true,
      cancelledCount,
      message: `Cancelled ${cancelledCount} render(s)`
    });

  } catch (error: any) {
    console.error('[cancel] Error cancelling renders:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to cancel renders' },
      { status: 500 }
    );
  }
}
```

**Step 5**: Add cancel button to frontend

**File**: `vidgen-app/src/app/(app)/campaigns/[id]/RenderControls.tsx`

Add cancel handler:

```typescript
const [isCancelling, setIsCancelling] = useState(false);

const handleCancel = async () => {
  if (!confirm('Are you sure you want to cancel all active renders? This action cannot be undone.')) {
    return;
  }

  setIsCancelling(true);

  try {
    const response = await fetch(`/api/campaigns/${campaignId}/cancel`, {
      method: 'POST',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to cancel');
    }

    toast.success(data.message || 'Renders cancelled successfully');

    // Refresh render list
    router.refresh();
  } catch (error: any) {
    toast.error(error.message || 'Failed to cancel renders');
  } finally {
    setIsCancelling(false);
  }
};
```

Add button to UI:

```typescript
{hasActiveRenders && (
  <Button
    variant="destructive"
    size="sm"
    onClick={handleCancel}
    disabled={isCancelling}
  >
    {isCancelling ? (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Cancelling...
      </>
    ) : (
      <>
        <XCircle className="mr-2 h-4 w-4" />
        Cancel Renders
      </>
    )}
  </Button>
)}
```

#### Testing

```bash
# Terminal 1: Start worker
npm run worker

# Terminal 2: Start a render
curl -X POST http://localhost:3000/api/campaigns/[id]/render

# Terminal 3: Cancel it mid-render
curl -X POST http://localhost:3000/api/campaigns/[id]/cancel

# Verify:
# - Worker logs show "Render cancelled gracefully"
# - DB shows cancelled_at timestamp
# - Campaign directory cleaned up
# - No Steel minutes wasted
```

#### Success Criteria
- [ ] Cancel button appears when renders are active
- [ ] Clicking cancel stops render within 5 seconds
- [ ] Campaign directory cleaned up
- [ ] Status shows "cancelled" in UI
- [ ] No errors in worker logs

---

### 1.4 Health Checks & Monitoring
**Status:** ✅ Implemented (worker health server, metrics endpoint, PM2 process config, monitoring script)

> Health server automatically retries on sequential ports when the preferred `HEALTH_PORT` is busy (actual port is logged and exported via `HEALTH_PORT_ACTIVE`).

**Priority**: ⚙️ OPERATIONAL
**Effort**: 3-4 hours
**Impact**: Detect worker failures before users report them

#### Problem
No way to know if worker crashes or gets stuck. Silent failures cause support tickets.

#### Solution
Add HTTP health endpoint, heartbeat updates, and process manager for auto-restart.

#### Implementation

**Step 1**: Add HTTP health server to worker

**File**: `src/worker.js`

Add http import (top of file):
```javascript
const http = require('http');
```

Add health server setup (before workerLoop function, ~line 290):

```javascript
// Health check server
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT) || 3001;
let lastHeartbeat = Date.now();
let currentJobInfo = null;

/**
 * Update heartbeat timestamp
 */
function updateHeartbeat(jobInfo = null) {
  lastHeartbeat = Date.now();
  currentJobInfo = jobInfo;
}

/**
 * HTTP server for health checks
 */
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    const now = Date.now();
    const timeSinceHeartbeat = now - lastHeartbeat;
    const isHealthy = timeSinceHeartbeat < 60000; // Healthy if heartbeat within last 60s

    const status = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      uptime: process.uptime(),
      lastHeartbeat: new Date(lastHeartbeat).toISOString(),
      timeSinceHeartbeat: `${Math.floor(timeSinceHeartbeat / 1000)}s`,
      currentJob: currentJobInfo,
      memory: process.memoryUsage(),
      isShuttingDown,
    };

    res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  } else if (req.url === '/metrics') {
    // Prometheus-compatible metrics
    const metrics = `
# HELP worker_uptime_seconds Worker uptime in seconds
# TYPE worker_uptime_seconds gauge
worker_uptime_seconds ${process.uptime()}

# HELP worker_last_heartbeat_seconds Seconds since last heartbeat
# TYPE worker_last_heartbeat_seconds gauge
worker_last_heartbeat_seconds ${(Date.now() - lastHeartbeat) / 1000}

# HELP worker_memory_used_bytes Memory usage in bytes
# TYPE worker_memory_used_bytes gauge
worker_memory_used_bytes ${process.memoryUsage().heapUsed}

# HELP worker_is_processing Is worker currently processing a job
# TYPE worker_is_processing gauge
worker_is_processing ${currentJob ? 1 : 0}
`;

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(metrics.trim());
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

healthServer.listen(HEALTH_PORT, () => {
  console.log(`[worker] Health check server listening on :${HEALTH_PORT}`);
  console.log(`[worker] Health endpoint: http://localhost:${HEALTH_PORT}/health`);
  console.log(`[worker] Metrics endpoint: http://localhost:${HEALTH_PORT}/metrics`);
});
```

**Step 2**: Update workerLoop to send heartbeats

Find workerLoop function (~line 291), update:

```javascript
async function workerLoop() {
  console.log(`[worker] Worker started - polling every ${POLL_INTERVAL}ms`);

  while (!isShuttingDown) {
    try {
      // Update heartbeat
      updateHeartbeat(null);

      // Try to claim a job
      const job = await claimRenderJob();

      if (job) {
        currentJob = job;
        updateHeartbeat({
          jobId: job.job_id,
          renderId: job.render_id,
          campaignName: job.campaign_name,
          startedAt: new Date().toISOString(),
        });

        await processJob(job);

        currentJob = null;
        updateHeartbeat(null);
      } else {
        // No jobs available, wait before polling again
        process.stdout.write('.');
      }
    } catch (error) {
      // Log error but keep worker running
      console.error('[worker] Error in worker loop:', error);
      currentJob = null;
      updateHeartbeat(null);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  console.log('[worker] Worker loop stopped');

  // Close health server
  healthServer.close(() => {
    console.log('[worker] Health check server closed');
  });
}
```

**Step 3**: Setup PM2 for process management

Create `ecosystem.config.js` in project root:

```javascript
module.exports = {
  apps: [
    {
      name: 'loom-lite-worker',
      script: './src/worker.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        HEALTH_PORT: 3001,
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_file: './logs/worker-combined.log',
      time: true,
      kill_timeout: 30000, // 30s graceful shutdown
      listen_timeout: 10000,
      // Restart on crash
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
```

Install PM2:
```bash
npm install -g pm2
```

Start worker with PM2:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup # Enable auto-start on system boot
```

**Step 4**: Setup monitoring/alerting

Create health check script: `src/scripts/check-worker-health.sh`

```bash
#!/bin/bash

# Health check script for monitoring systems (UptimeRobot, Pingdom, etc.)

HEALTH_URL="http://localhost:3001/health"
MAX_RESPONSE_TIME=5 # seconds

# Make request
response=$(curl -s -w "\n%{http_code}" --max-time $MAX_RESPONSE_TIME "$HEALTH_URL")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

# Check response
if [ "$http_code" -eq 200 ]; then
  echo "✓ Worker healthy"
  echo "$body" | jq '.'
  exit 0
else
  echo "✗ Worker unhealthy (HTTP $http_code)"
  echo "$body"
  exit 1
fi
```

Make executable:
```bash
chmod +x src/scripts/check-worker-health.sh
```

Add to crontab for monitoring:
```bash
# Check worker health every 5 minutes
*/5 * * * * /path/to/loom-lite/src/scripts/check-worker-health.sh >> /var/log/worker-health.log 2>&1
```

Or setup external monitoring with UptimeRobot:
- URL: `http://your-server:3001/health`
- Interval: 5 minutes
- Alert: Email/SMS on downtime

#### Environment Variables

Add to `.env`:
```bash
# Health check configuration
HEALTH_PORT=3001
```

#### Testing

```bash
# Start worker with PM2
pm2 start ecosystem.config.js

# Check health
curl http://localhost:3001/health

# Check metrics
curl http://localhost:3001/metrics

# View logs
pm2 logs loom-lite-worker

# Monitor status
pm2 monit

# Restart worker
pm2 restart loom-lite-worker

# Stop worker
pm2 stop loom-lite-worker
```

#### Success Criteria
- [ ] Health endpoint returns 200 when worker running
- [ ] Metrics endpoint shows Prometheus format
- [ ] PM2 auto-restarts on crash
- [ ] Logs written to ./logs/
- [ ] Monitoring alerts on downtime

---

### 1.5 Concurrency Limits
**Status:** ✅ Implemented (RPC with concurrency cap, worker integration, health metrics, env defaults)

- Worker now reads `system_settings.max_concurrent_jobs` (cached ~15s) so UI updates apply without restarts.
- Admin dashboard exposes health plus concurrency controls via `/api/admin/system-settings` and `/api/admin/worker-health`.

**Priority**: ⚙️ OPERATIONAL
**Effort**: 2-3 hours
**Impact**: Prevents cost spikes and service overload

#### Problem
No limit on concurrent renders. Could spawn 10+ jobs simultaneously, overwhelming Steel and causing 10x cost spike.

#### Solution
Add MAX_CONCURRENT_JOBS check before claiming jobs. Use DB-based semaphore for multi-worker coordination.

#### Implementation

**Step 1**: Database function for concurrent job check

Add to `migrations/add_concurrency_control.sql`:

```sql
-- Function to claim job with concurrency limit
CREATE OR REPLACE FUNCTION claim_render_job_with_limit(p_max_concurrent INT DEFAULT 3)
RETURNS TABLE(
  job_id UUID,
  render_id UUID,
  campaign_id UUID,
  campaign_name TEXT,
  scenes JSONB,
  facecam_url TEXT,
  lead_csv_url TEXT,
  lead_row_index INT,
  output_settings JSONB
) AS $$
DECLARE
  v_job_id UUID;
  v_active_count INT;
BEGIN
  -- Count currently processing jobs
  SELECT COUNT(*) INTO v_active_count
  FROM render_jobs
  WHERE state = 'processing';

  -- Check if we're at capacity
  IF v_active_count >= p_max_concurrent THEN
    RAISE NOTICE 'At capacity: % active jobs (limit: %)', v_active_count, p_max_concurrent;
    RETURN; -- Return empty result
  END IF;

  -- Try to claim oldest queued job
  SELECT rj.id INTO v_job_id
  FROM render_jobs rj
  WHERE rj.state = 'queued'
  ORDER BY rj.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED; -- PostgreSQL row-level locking

  -- If no job found, return empty
  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  -- Mark as processing
  UPDATE render_jobs
  SET
    state = 'processing',
    started_at = NOW(),
    updated_at = NOW()
  WHERE id = v_job_id;

  -- Return job details
  RETURN QUERY
  SELECT
    rj.id as job_id,
    rj.render_id,
    c.id as campaign_id,
    c.name as campaign_name,
    c.scenes,
    r.facecam_url,
    r.lead_csv_url,
    r.lead_row_index,
    c.output_settings
  FROM render_jobs rj
  JOIN renders r ON r.id = rj.render_id
  JOIN campaigns c ON c.id = r.campaign_id
  WHERE rj.id = v_job_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_render_job_with_limit(INT) IS 'Claim next queued render job only if under concurrency limit';
```

Run migration:
```bash
supabase db push migrations/add_concurrency_control.sql
```

**Step 2**: Update supabase.js to use new function

**File**: `src/lib/supabase.js`

Update claimRenderJob function:

```javascript
/**
 * Claim a render job atomically with concurrency limit
 * @param {number} maxConcurrent - Maximum concurrent jobs (default from env)
 */
async function claimRenderJob(maxConcurrent = null) {
  const limit = maxConcurrent || parseInt(process.env.MAX_CONCURRENT_JOBS) || 3;

  const { data, error } = await supabase.rpc('claim_render_job_with_limit', {
    p_max_concurrent: limit
  });

  if (error) {
    // It's normal to have no jobs available
    if (error.message?.includes('No rows returned') || error.message?.includes('At capacity')) {
      return null;
    }
    console.error('[supabase] Error claiming job:', error);
    throw error;
  }

  // RPC returns an array, get first result
  return data?.[0] || null;
}
```

**Step 3**: Add concurrency monitoring

**File**: `src/worker.js`

Update health check to show concurrency info:

```javascript
const healthServer = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    // ... existing health check code ...

    // Add concurrency info
    let activeJobCount = 0;
    try {
      const { count } = await supabase
        .from('render_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('state', 'processing');
      activeJobCount = count || 0;
    } catch (error) {
      console.error('[health] Error fetching active job count:', error);
    }

    const status = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      uptime: process.uptime(),
      lastHeartbeat: new Date(lastHeartbeat).toISOString(),
      timeSinceHeartbeat: `${Math.floor(timeSinceHeartbeat / 1000)}s`,
      currentJob: currentJobInfo,
      concurrency: {
        active: activeJobCount,
        limit: parseInt(process.env.MAX_CONCURRENT_JOBS) || 3,
        available: Math.max(0, (parseInt(process.env.MAX_CONCURRENT_JOBS) || 3) - activeJobCount),
      },
      memory: process.memoryUsage(),
      isShuttingDown,
    };

    res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  }
  // ... rest of health server code
});
```

#### Environment Variables

Add to `.env`:
```bash
# Concurrency control
MAX_CONCURRENT_JOBS=3  # Adjust based on Steel plan limits
```

#### Testing

```bash
# Terminal 1: Start worker
MAX_CONCURRENT_JOBS=2 npm run worker

# Terminal 2-4: Queue multiple renders
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/campaigns/test/render
done

# Check health endpoint
curl http://localhost:3001/health | jq '.concurrency'

# Verify:
# - Only 2 jobs processing simultaneously
# - Others remain queued
# - No Steel overload
```

#### Success Criteria
- [ ] MAX_CONCURRENT_JOBS respected
- [ ] Extra jobs wait in queue
- [ ] Health endpoint shows concurrency stats
- [ ] No Steel connection errors
- [ ] Costs stay within budget

---

## PHASE 2: Frontend/Product Completion (Week 2)

### 2.1 Settings Page

**Status:** ✅ Implemented (profile management, password change, API keys, billing summary, danger zone)

**Priority**: 🚨 MUST HAVE
**Effort**: 6-8 hours
**Impact**: Basic user management, required for production

#### Requirements
- User profile editing (name, email)
- Password change
- API key generation/management
- Billing info (links to Stripe)
- Notification preferences
- Danger zone (delete account)

#### Implementation

- `vidgen-app/src/app/(app)/settings/page.tsx` now renders the full settings dashboard with profile, API keys, billing, and danger zone sections.
- Components live under `vidgen-app/src/components/settings/` (`SettingsForm`, `ApiKeysSection`, `BillingSection`, `DangerZone`).
- Secure API routes provide profile, password, API key, and account deletion actions at `/api/settings/*`.
- `vidgen-app/migrations/005_settings_tables.sql` creates `profiles` + `api_keys` tables with RLS policies.
- Worker respects live concurrency overrides through `system_settings` (see 1.5).

**File**: `vidgen-app/src/app/(app)/settings/page.tsx`

```typescript
import { createServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { ApiKeysSection } from '@/components/settings/ApiKeysSection';
import { BillingSection } from '@/components/settings/BillingSection';
import { DangerZone } from '@/components/settings/DangerZone';

export const metadata = {
  title: 'Settings',
  description: 'Manage your account settings',
};

export default async function SettingsPage() {
  const supabase = createServerClient();

  // Get current user
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  // Get user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // Get subscription info
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*, prices(*, products(*))')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <div className="space-y-8">
        {/* Profile Section */}
        <section className="border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Profile</h2>
          <SettingsForm user={user} profile={profile} />
        </section>

        {/* API Keys Section */}
        <section className="border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">API Keys</h2>
          <ApiKeysSection userId={user.id} />
        </section>

        {/* Billing Section */}
        <section className="border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Billing</h2>
          <BillingSection subscription={subscription} />
        </section>

        {/* Danger Zone */}
        <section className="border border-red-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-red-600 mb-4">Danger Zone</h2>
          <DangerZone userId={user.id} />
        </section>
      </div>
    </div>
  );
}
```

**Component files to create**:

1. `vidgen-app/src/components/settings/SettingsForm.tsx`
2. `vidgen-app/src/components/settings/ApiKeysSection.tsx`
3. `vidgen-app/src/components/settings/BillingSection.tsx`
4. `vidgen-app/src/components/settings/DangerZone.tsx`

(Full component implementations omitted for brevity - each is ~100-200 lines with form handling, validation, API calls)

**Database tables needed**:

```sql
-- API keys table
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL, -- Hashed API key
  key_preview TEXT NOT NULL, -- Last 4 chars for display
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(key_hash)
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;
```

#### Success Criteria
- [ ] Users can update profile info
- [ ] Password change works
- [ ] API keys generated securely
- [ ] Billing links to Stripe portal
- [ ] Account deletion requires confirmation

---

### 2.2 Enhanced Campaign Dashboard

**Status:** ✅ Implemented (search, filters, metrics, bulk actions)

**Priority**: ⚙️ SHOULD HAVE
**Effort**: 4-6 hours

#### Improvements Needed
- Better render status indicators
- Bulk actions (delete, retry)
- Filtering by status
- Search by campaign name
- Usage stats per campaign

#### Implementation

**File**: `vidgen-app/src/app/(app)/campaigns/page.tsx`

Add filters, search, bulk actions:

```typescript
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export default function CampaignsPage({ campaigns }) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);

  // Filter campaigns
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter(campaign => {
      const matchesSearch = campaign.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || campaign.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [campaigns, searchTerm, statusFilter]);

  // Bulk delete
  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedCampaigns.length} campaign(s)?`)) return;

    for (const id of selectedCampaigns) {
      await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    }

    setSelectedCampaigns([]);
    router.refresh();
  };

  return (
    <div className="container py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Campaigns</h1>
        <Button onClick={() => router.push('/campaigns/new')}>
          New Campaign
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <Input
          placeholder="Search campaigns..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      {/* Bulk Actions */}
      {selectedCampaigns.length > 0 && (
        <div className="flex items-center gap-4 mb-4 p-4 bg-muted rounded-lg">
          <span>{selectedCampaigns.length} selected</span>
          <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
            Delete Selected
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelectedCampaigns([])}>
            Clear Selection
          </Button>
        </div>
      )}

      {/* Campaign List */}
      <div className="grid gap-4">
        {filteredCampaigns.map(campaign => (
          <div key={campaign.id} className="border rounded-lg p-4 hover:shadow-md transition">
            <div className="flex items-start gap-4">
              <Checkbox
                checked={selectedCampaigns.includes(campaign.id)}
                onCheckedChange={(checked) => {
                  setSelectedCampaigns(prev =>
                    checked
                      ? [...prev, campaign.id]
                      : prev.filter(id => id !== campaign.id)
                  );
                }}
              />
              <div className="flex-1">
                <h3 className="font-semibold">{campaign.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {campaign.renders_count} renders • {campaign.scenes_count} scenes
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => router.push(`/campaigns/${campaign.id}`)}>
                View
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### Success Criteria
- [x] Search works instantly
- [x] Status filter updates list
- [x] Bulk delete confirms before action
- [x] Performance good with 100+ campaigns (client-side memoised filtering)

---

_(Continuing with remaining sections in next part due to length...)_

## Quick Reference Checklist

### Week 1: Core Infrastructure
- [ ] 1.1 Widget readiness (2-4h)
- [ ] 1.2 Disk cleanup (4-6h)
- [ ] 1.3 Cancellation support (6-8h)
- [ ] 1.4 Health checks (3-4h)
- [ ] 1.5 Concurrency limits (2-3h)

### Week 2: Essential Frontend
- [ ] 2.1 Settings page (6-8h)
- [ ] 2.2 Dashboard improvements (4-6h)
- [ ] 2.3 Video landing page polish (8-10h)
- [ ] 2.4 Custom subdomain setup (12-16h)

### Week 3: Go-to-Market
- [ ] 3.1 Homepage (12-16h)
- [ ] 3.2 Contact page (3-4h)
- [ ] 3.3 Marketing pages (6-8h)
- [ ] 3.4 Stripe audit & connection (4-6h)

### Week 4: Launch Prep
- [ ] 4.1 Subscription management (8-10h)
- [ ] 4.2 Usage limits (6-8h)
- [ ] 4.3 Testing & bug fixes (8-12h)
- [ ] 4.4 Soft launch

---

## Critical Environment Variables Summary

```bash
# Worker Configuration
WORKER_POLL_INTERVAL=2000
MAX_CONCURRENT_JOBS=3
HEALTH_PORT=3001

# Cleanup
CLEANUP_ENABLED=true
FAILED_RENDER_RETENTION_DAYS=7
SUCCESS_RENDER_RETENTION_HOURS=1
CLEANUP_MAX_AGE_DAYS=30

# Supabase
SUPABASE_URL=your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key

# Steel/Browserless
STEEL_API_KEY=your-key
BROWSERLESS_API_KEY=your-key

# Storage (Bunny CDN)
BUNNY_STORAGE_ZONE=your-zone
BUNNY_API_KEY=your-key
BUNNY_CDN_URL=your-cdn.b-cdn.net

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

---

## Deployment Checklist

- [ ] Environment variables configured in production
- [ ] Database migrations run
- [ ] PM2 configured and running
- [ ] Health checks endpoint accessible
- [ ] Monitoring/alerting setup (UptimeRobot, etc.)
- [ ] Cron jobs configured
- [ ] Log rotation setup
- [ ] Backups configured
- [ ] SSL certificates valid
- [ ] DNS records configured
- [ ] CDN purge working
- [ ] Stripe webhooks configured
- [ ] Test renders complete successfully
- [ ] Error tracking (Sentry) configured
- [ ] Analytics (PostHog/Mixpanel) working

---

**Next Steps**: Start with Phase 1.1 (Widget Readiness) - it's the quickest win that fixes a critical quality issue. Then tackle disk cleanup and cancellation support before moving to frontend work.
