# VidGen Architecture Audit & Implementation Status

**Date**: October 2025
**Status**: Mixed Implementation - Database API routes exist but are bypassed by current wizard

---

## Executive Summary

**Critical Finding**: The database-backed API architecture is **correctly implemented** but **NOT being used**. The CampaignWizard currently bypasses the entire database layer and calls `/api/render` directly, which proxies to loom-lite for synchronous rendering.

### What's Working
✅ Database schema (campaigns, scenes, renders, render_jobs)
✅ API routes with RLS and validation
✅ Loom-lite rendering engine

### What's Broken
❌ Wizard doesn't use database APIs
❌ No worker job claiming system
❌ No polling UI
❌ Local filesystem storage (not cloud)
❌ No render job queue processing

---

## A) Next.js App → Supabase (Campaign Creation)

### Questions & Answers

#### Q: When I submit the "New Campaign" form, does it call `POST /api/campaigns`?

**Answer**: ❌ **NO - This is the core problem.**

**Current Behavior**:
- The wizard calls `POST /api/render` (proxy endpoint)
- This bypasses the database entirely
- No campaign or scene records are created in Supabase

**Implementation Found** (`vidgen-app/src/app/api/campaigns/route.ts`):
```typescript
// POST /api/campaigns IS IMPLEMENTED
export async function POST(request: Request) {
  const { name, scenes } = await validateRequest(request);

  // Creates campaign record
  const campaign = await supabase.from('campaigns').insert({ name, user_id });

  // Bulk inserts scenes with order_index
  await supabase.from('scenes').insert(scenes.map((s, i) => ({
    campaign_id: campaign.id,
    url: normalizeUrl(s.url),
    duration_sec: s.duration_sec,
    order_index: i
  })));

  return { id: campaign.id };
}
```

**Status**: ✅ **API exists** but ❌ **wizard doesn't call it**

**Location of Bug**: `vidgen-app/src/components/CampaignWizard.tsx:530`
```typescript
// WRONG - Current code
const response = await fetch('/api/render', { ... });

// CORRECT - Should be
const response = await fetch('/api/campaigns', {
  method: 'POST',
  body: JSON.stringify({ name, scenes }),
});
```

---

#### Q: On success, do we redirect to `/campaigns/[id]`?

**Answer**: ❌ **NO**

**Current Behavior**:
- Wizard shows "rendering" status but doesn't create a campaign
- No redirect happens because no campaign ID is returned

**Expected Behavior**:
```typescript
const response = await fetch('/api/campaigns', { method: 'POST', body: JSON.stringify({ name, scenes }) });
const { id } = await response.json();

// Redirect to campaign detail page
router.push(`/campaigns/${id}`);
```

**Status**: ❌ **Not implemented**

---

#### Q: Do we enforce total duration = facecam duration on the client?

**Answer**: ✅ **YES** (client-side validation exists)

**Implementation**: `CampaignWizard.tsx:983-999`
```typescript
// Validate duration matching on step 2
if (currentStep === 2 && facecamDurationSec > 0) {
  const remaining = calculateRemaining();
  if (remaining !== 0) {
    // Show error - blocks progression
    const warningEl = document.getElementById('durationWarning');
    warningEl.classList.remove('hidden');
    const message = remaining > 0
      ? `Add ${remaining}s more to scenes`
      : `Remove ${Math.abs(remaining)}s from scenes`;
    warningEl.innerHTML = `<span class="material-icons">warning</span>${message}`;
    return; // BLOCKS next step
  }
}
```

**How facecam duration is provided**:
- When video is uploaded, FFmpeg probe gets duration
- Stored in `facecamDurationSec` state variable
- Used to calculate `remaining = facecamDuration - totalSceneDuration`

**Status**: ✅ **Fully implemented**

---

#### Q: Are we using the Zod schema with URL normalization?

**Answer**: ✅ **YES** (in API) but ❌ **NOT USED** (wizard bypasses it)

**API Schema** (`/api/campaigns/route.ts:8-18`):
```typescript
const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  scenes: z.array(
    z.object({
      url: z.string().url('Invalid URL format'),
      duration_sec: z.number().int().positive().max(300, 'Scene duration ≤ 300s'),
    })
  ).min(1, 'At least one scene is required'),
});

// URL normalization (line 115)
const normalizedScenes = scenes.map(s => ({
  ...s,
  url: normalizeUrl(s.url) // Adds https:// if missing
}));

// Total duration check (line 127)
const totalDuration = scenes.reduce((sum, s) => sum + s.duration_sec, 0);
if (totalDuration > 300) {
  return NextResponse.json({ error: 'Total exceeds 300s' }, { status: 422 });
}
```

**Error Handling**:
```typescript
if (!result.success) {
  return NextResponse.json(
    { error: 'Validation error', details: result.error.format() },
    { status: 422 }
  );
}
```

**Status**: ✅ **API has validation** but ❌ **wizard doesn't use it**

---

#### Q: Are errors shown inline if validation fails?

**Answer**: ❌ **NO** (because wizard doesn't call the validated endpoint)

**What SHOULD happen**:
1. Wizard calls `POST /api/campaigns`
2. API returns 422 with Zod error details
3. Wizard parses `error.details` and shows field-specific errors

**Current State**: Wizard shows generic "all videos failed" because proxy returns 500

**Status**: ❌ **Not implemented**

---

#### Q: Are we using server-side Supabase client with RLS?

**Answer**: ✅ **YES** (perfectly implemented)

**Implementation** (`/api/campaigns/route.ts:26-37`):
```typescript
const cookieStore = await cookies();
const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

// Auth guard
const { data: { user }, error: authError } = await supabase.auth.getUser();
if (authError || !user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// RLS automatically filters by user_id
await supabase.from('campaigns').insert({
  user_id: user.id,
  name,
});
```

**RLS Policy** (from database schema):
```sql
CREATE POLICY "Users can only see their own campaigns"
  ON campaigns
  FOR SELECT
  USING (auth.uid() = user_id);
```

**Status**: ✅ **Correctly implemented**

---

#### Q: Do we return 404 for non-owner access?

**Answer**: ✅ **YES**

**Implementation** (`/api/campaigns/[id]/route.ts`):
```typescript
const { data: campaign } = await supabase
  .from('campaigns')
  .select('id')
  .eq('id', params.id)
  .single();

// RLS filters out non-owned campaigns, so this returns null
if (!campaign) {
  // Could be non-existent OR non-owned - both return 404
  return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
}
```

**Why this works**: RLS silently filters the query, so unauthorized access looks like a missing record.

**Status**: ✅ **Correctly implemented**

---

### Acceptance Criteria for Section A

| Criterion | Status | Notes |
|-----------|--------|-------|
| Wizard calls POST /api/campaigns | ❌ | Calls /api/render instead |
| Campaign + scenes inserted in DB | ❌ | Nothing written to database |
| GET /api/campaigns shows new campaign | ⚠️ | API works but no data to show |
| URL normalization | ✅ | Implemented in API |
| Duration validation | ✅ | Implemented in API |
| RLS enforcement | ✅ | Working correctly |
| Error handling | ❌ | Not wired to UI |

**Overall**: API is production-ready but **wizard must be rewired**.

---

## B) Next.js App → "Render" Button & Polling

### Questions & Answers

#### Q: Does the Render button call `POST /api/campaigns/[id]/render`?

**Answer**: ❌ **NO - Campaign detail page doesn't exist**

**Current State**:
- No `/campaigns/[id]` page exists
- Wizard calls `/api/render` directly after form submission
- No separate "Render" button on campaign detail page

**API Implementation** (`/api/campaigns/[id]/render/route.ts:10-114`):
```typescript
export async function POST(request: Request, { params }: { params: { id: string } }) {
  // 1. Verify campaign ownership (RLS)
  const campaign = await supabase.from('campaigns')
    .select('id')
    .eq('id', params.id)
    .single();

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  // 2. Duplicate guard - check for in-progress renders
  const inProgressStates = ['queued', 'recording', 'normalizing', 'concatenating', 'overlaying', 'uploading'];
  const existingRenders = await supabase.from('renders')
    .select('id, status')
    .eq('campaign_id', params.id)
    .in('status', inProgressStates)
    .limit(1);

  if (existingRenders.length > 0) {
    return NextResponse.json(
      { error: 'A render is already in progress' },
      { status: 409 } // Conflict
    );
  }

  // 3. Get scenes to calculate total duration
  const scenes = await supabase.from('scenes')
    .select('duration_sec')
    .eq('campaign_id', params.id);

  const totalDuration = scenes.reduce((sum, s) => sum + s.duration_sec, 0);

  // 4. Create render + render_job atomically
  const publicId = nanoid();
  const render = await supabase.from('renders').insert({
    campaign_id: params.id,
    status: 'queued',
    progress: 0,
    public_id: publicId,
    duration_sec: totalDuration,
  }).select('id').single();

  await supabase.from('render_jobs').insert({
    render_id: render.id,
    state: 'queued',
  });

  return { renderId: render.id };
}
```

**Status**: ✅ **API exists** but ❌ **no UI to call it**

---

#### Q: Do we surface 409 ("already rendering") with a toast?

**Answer**: ❌ **NO**

**What's Needed**:
```typescript
// In CampaignDetailPage.tsx (DOESN'T EXIST YET)
const handleRender = async () => {
  const response = await fetch(`/api/campaigns/${id}/render`, { method: 'POST' });

  if (response.status === 409) {
    toast.error('A render is already in progress for this campaign');
    return;
  }

  const { renderId } = await response.json();
  setCurrentRenderId(renderId);
  startPolling(renderId);
};
```

**Status**: ❌ **Not implemented** (no page, no toast library)

---

#### Q: After enqueue, do we poll GET /api/renders/[renderId] every 2s?

**Answer**: ❌ **NO**

**What's Needed**:
```typescript
const startPolling = (renderId: string) => {
  const interval = setInterval(async () => {
    const response = await fetch(`/api/renders/${renderId}`);
    const data = await response.json();

    setRenderStatus(data.status);
    setProgress(data.progress);

    if (data.status === 'done' || data.status === 'failed') {
      clearInterval(interval);

      if (data.status === 'done') {
        setFinalVideoUrl(data.final_video_url);
        setThumbUrl(data.thumb_url);
        setShowViewButton(true); // Enable "View Video" button
      } else {
        toast.error(`Render failed: ${data.error}`);
      }
    }
  }, 2000); // Poll every 2 seconds
};
```

**GET /api/renders/[id] Implementation** (`/api/renders/[id]/route.ts:9-64`):
```typescript
export async function GET(request: Request, { params }: { params: { id: string } }) {
  // Auth + ownership verification via campaign join
  const render = await supabase.from('renders')
    .select(`
      id,
      status,
      progress,
      public_id,
      final_video_url,
      thumb_url,
      error,
      campaigns!inner (id)  // RLS filters by user_id
    `)
    .eq('id', params.id)
    .single();

  if (!render) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: render.id,
    status: render.status,
    progress: render.progress,
    public_id: render.public_id,
    final_video_url: render.final_video_url,
    thumb_url: render.thumb_url,
    error: render.error,
  });
}
```

**Status**: ✅ **API exists** but ❌ **no UI polling**

---

#### Q: On status='done', do we show a button to `/v/[publicId]`?

**Answer**: ❌ **NO**

**What's Needed**:
```typescript
{renderStatus === 'done' && (
  <Link href={`/v/${publicId}`}>
    <button className="btn-primary">
      <PlayIcon /> View Video
    </button>
  </Link>
)}
```

**Status**: ❌ **Not implemented** (no detail page)

---

### Acceptance Criteria for Section B

| Criterion | Status | Notes |
|-----------|--------|-------|
| Render button calls POST /api/campaigns/[id]/render | ❌ | No campaign detail page |
| 409 shown as toast | ❌ | No UI, no toast library |
| Polling GET /api/renders/[id] every 2s | ❌ | No polling logic |
| Progress bar updates | ❌ | No UI component |
| Status tag updates (queued → recording → done) | ❌ | No UI component |
| View Video button on completion | ❌ | No button, no /v/[publicId] link |
| Render + job inserted in DB | ✅ | API works correctly |

**Overall**: API is ready but **entire UI layer missing**.

---

## C) Worker (loom-lite) → Job Claiming & DB Updates

### Questions & Answers

#### Q: Does the worker call `rpc('claim_render_job')` or `SELECT FOR UPDATE SKIP LOCKED`?

**Answer**: ❌ **NO - loom-lite is NOT a worker**

**Current Architecture**:
- `loom-lite/src/server.js` is an Express HTTP server
- Handles synchronous requests to `POST /api/render`
- No job queue, no polling, no claiming

**What's Needed** (pseudocode for worker):
```javascript
// loom-lite/src/worker.js (DOESN'T EXIST)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Server-only key
);

async function claimJob() {
  // Option 1: PostgreSQL function (recommended)
  const { data } = await supabase.rpc('claim_render_job');

  // Option 2: SELECT FOR UPDATE SKIP LOCKED (manual)
  const { data } = await supabase
    .from('render_jobs')
    .select('*, renders(*)')
    .eq('state', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    // Note: Supabase JS doesn't support FOR UPDATE SKIP LOCKED
    // Would need raw SQL: supabase.rpc('claim_job_manual')

  if (!data) return null;

  // Mark as running
  await supabase.from('render_jobs')
    .update({ state: 'running', started_at: new Date().toISOString() })
    .eq('id', data.id);

  await supabase.from('renders')
    .update({ status: 'recording', progress: 0 })
    .eq('id', data.render_id);

  return data;
}

async function processJobs() {
  while (true) {
    const job = await claimJob();

    if (job) {
      try {
        await renderVideo(job);
      } catch (error) {
        await handleFailure(job, error);
      }
    } else {
      await sleep(5000); // Wait 5s before checking again
    }
  }
}

processJobs();
```

**PostgreSQL Function** (should be created in Supabase):
```sql
CREATE OR REPLACE FUNCTION claim_render_job()
RETURNS TABLE (
  id uuid,
  render_id uuid,
  campaign_id uuid,
  scenes jsonb
) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT rj.id, rj.render_id
    FROM render_jobs rj
    WHERE rj.state = 'queued'
    ORDER BY rj.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE render_jobs rj
  SET
    state = 'running',
    started_at = NOW()
  FROM claimed c
  WHERE rj.id = c.id
  RETURNING
    rj.id,
    rj.render_id,
    (SELECT campaign_id FROM renders WHERE id = rj.render_id),
    (SELECT jsonb_agg(jsonb_build_object('url', url, 'duration_sec', duration_sec) ORDER BY order_index)
     FROM scenes WHERE campaign_id = (SELECT campaign_id FROM renders WHERE id = rj.render_id));
END;
$$ LANGUAGE plpgsql;
```

**Status**: ❌ **Not implemented** (loom-lite is HTTP server, not worker)

---

#### Q: On claim, does it set `render_jobs.state='running'` and `renders.status='recording'`?

**Answer**: ❌ **NO**

**What's Needed** (in worker's `claimJob()` function):
```javascript
// After claiming
await supabase.from('render_jobs')
  .update({
    state: 'running',
    started_at: new Date().toISOString()
  })
  .eq('id', jobId);

await supabase.from('renders')
  .update({
    status: 'recording',
    progress: 5
  })
  .eq('id', renderId);
```

**Status**: ❌ **Not implemented**

---

#### Q: During pipeline stages, does the worker update `renders.status` and `renders.progress`?

**Answer**: ❌ **NO**

**What's Needed** (in `loom-lite/src/pipeline/renderCampaign.js`):
```javascript
const { renderCampaign } = require('./pipeline/renderCampaign');
const { createClient } = require('@supabase/supabase-js');

async function processJob(job) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Stage 1: Recording
    await supabase.from('renders')
      .update({ status: 'recording', progress: 10 })
      .eq('id', job.render_id);

    const recorded = await recordScenes(job.scenes);

    // Stage 2: Normalizing
    await supabase.from('renders')
      .update({ status: 'normalizing', progress: 40 })
      .eq('id', job.render_id);

    const normalized = await normalizeScenes(recorded);

    // Stage 3: Concatenating
    await supabase.from('renders')
      .update({ status: 'concatenating', progress: 60 })
      .eq('id', job.render_id);

    const concatenated = await concatScenes(normalized);

    // Stage 4: Overlaying facecam
    await supabase.from('renders')
      .update({ status: 'overlaying', progress: 80 })
      .eq('id', job.render_id);

    const final = await overlayFacecam(concatenated, job.facecam);

    // Stage 5: Uploading
    await supabase.from('renders')
      .update({ status: 'uploading', progress: 90 })
      .eq('id', job.render_id);

    const cdnUrl = await uploadToCDN(final);

    // Complete
    await supabase.from('renders')
      .update({
        status: 'done',
        progress: 100,
        final_video_url: cdnUrl,
        thumb_url: `${cdnUrl}.jpg`
      })
      .eq('id', job.render_id);

    await supabase.from('render_jobs')
      .update({
        state: 'done',
        finished_at: new Date().toISOString()
      })
      .eq('id', job.id);

  } catch (error) {
    await handleFailure(job, error);
  }
}
```

**Current loom-lite**: No database interaction at all. Writes to local filesystem only.

**Status**: ❌ **Not implemented**

---

#### Q: Where are logs written?

**Answer**: ❌ **Not written to database**

**Current Logs**: `console.log()` to stdout only

**What's Needed**:
```javascript
async function appendLog(jobId, message) {
  await supabase.rpc('append_render_log', {
    job_id: jobId,
    message: `[${new Date().toISOString()}] ${message}`
  });
}

// In pipeline
await appendLog(job.id, 'Starting scene recording...');
await appendLog(job.id, `Recorded scene 1/5 (${scene.url})`);
await appendLog(job.id, 'Normalizing videos...');
// etc.
```

**PostgreSQL Function**:
```sql
CREATE OR REPLACE FUNCTION append_render_log(job_id uuid, message text)
RETURNS void AS $$
BEGIN
  UPDATE render_jobs
  SET log = COALESCE(log, '') || message || E'\n'
  WHERE id = job_id;
END;
$$ LANGUAGE plpgsql;
```

**Status**: ❌ **Not implemented**

---

#### Q: After producing final.mp4, do we upload to Bunny/R2?

**Answer**: ❌ **NO - uses local filesystem**

**Current Storage** (`loom-lite/src/server.js:86-87`):
```javascript
const finalUrl = `/campaigns/${encodeURIComponent(safeName)}/final.mp4`;
const posterUrl = `/campaigns/${encodeURIComponent(safeName)}/poster.jpg`;
res.json({ ok: true, finalUrl, posterUrl });
```

Files are stored in: `loom-lite/campaigns/<campaign-name>/final.mp4`

**What's Needed** (Bunny CDN integration):
```javascript
const axios = require('axios');
const fs = require('fs');

async function uploadToBunny(localPath, fileName) {
  const fileBuffer = fs.readFileSync(localPath);

  const response = await axios.put(
    `https://storage.bunnycdn.com/${process.env.BUNNY_STORAGE_ZONE}/renders/${fileName}`,
    fileBuffer,
    {
      headers: {
        'AccessKey': process.env.BUNNY_STORAGE_API_KEY,
        'Content-Type': 'video/mp4'
      }
    }
  );

  // Return public CDN URL
  return `https://${process.env.BUNNY_PULL_ZONE}.b-cdn.net/renders/${fileName}`;
}

// Usage
const publicId = job.renders.public_id;
const cdnUrl = await uploadToBunny(
  '/path/to/final.mp4',
  `${publicId}.mp4`
);
```

**Environment Variables Needed**:
```env
BUNNY_STORAGE_ZONE=your-storage-zone
BUNNY_STORAGE_API_KEY=your-api-key
BUNNY_PULL_ZONE=your-pull-zone
```

**Alternative: Supabase Storage (temporary)**:
```javascript
const { data, error } = await supabase.storage
  .from('renders')  // Public bucket
  .upload(`${publicId}.mp4`, fileBuffer, {
    contentType: 'video/mp4',
    upsert: false
  });

const { data: { publicUrl } } = supabase.storage
  .from('renders')
  .getPublicUrl(`${publicId}.mp4`);

return publicUrl;
```

**Status**: ❌ **Not implemented** (local filesystem only)

---

#### Q: Do we then update `renders.final_video_url` and `renders.thumb_url`?

**Answer**: ❌ **NO**

**What's Needed**:
```javascript
await supabase.from('renders')
  .update({
    final_video_url: cdnUrl,
    thumb_url: thumbUrl,
    status: 'done',
    progress: 100
  })
  .eq('id', renderId);
```

**Status**: ❌ **Not implemented**

---

#### Q: On errors, do we set `renders.status='failed'` and `renders.error`?

**Answer**: ❌ **NO**

**What's Needed**:
```javascript
async function handleFailure(job, error) {
  console.error('[Worker] Job failed:', error);

  await supabase.from('renders')
    .update({
      status: 'failed',
      error: error.message,
      progress: 0
    })
    .eq('id', job.render_id);

  await supabase.from('render_jobs')
    .update({
      state: 'failed',
      log: (job.log || '') + `\n[ERROR] ${error.message}\n${error.stack}`,
      finished_at: new Date().toISOString()
    })
    .eq('id', job.id);
}
```

**Status**: ❌ **Not implemented**

---

#### Q: Is the worker using `SUPABASE_SERVICE_ROLE_KEY`?

**Answer**: ❌ **NO - worker doesn't use Supabase at all**

**What's Needed** (`.env` in loom-lite):
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc... # Server-only key (bypasses RLS)
PORT=3100

# CDN/Storage
BUNNY_STORAGE_ZONE=your-zone
BUNNY_STORAGE_API_KEY=key
BUNNY_PULL_ZONE=pull-zone
```

**Worker Initialization**:
```javascript
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
```

**Status**: ❌ **Not implemented**

---

#### Q: Confirm Next.js app only uses `NEXT_PUBLIC_` keys?

**Answer**: ✅ **YES - confirmed**

**vidgen-app/.env.local**:
```env
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...  # Client-safe key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**No service role key** in vidgen-app (correct behavior).

**Status**: ✅ **Correctly configured**

---

### Acceptance Criteria for Section C

| Criterion | Status | Notes |
|-----------|--------|-------|
| Worker polls for jobs | ❌ | No worker exists |
| Atomic job claiming (FOR UPDATE SKIP LOCKED) | ❌ | Not implemented |
| Updates renders.status through stages | ❌ | No DB integration |
| Updates renders.progress (0-100) | ❌ | No DB integration |
| Logs written to render_jobs.log | ❌ | Only stdout |
| Uploads to Bunny/R2 | ❌ | Local filesystem |
| Updates final_video_url + thumb_url | ❌ | Not implemented |
| Sets status='failed' on errors | ❌ | Not implemented |
| Uses SUPABASE_SERVICE_ROLE_KEY | ❌ | No Supabase integration |
| Web app uses only NEXT_PUBLIC keys | ✅ | Correct |

**Overall**: Worker needs **complete rewrite** to integrate with database.

---

## D) Storage/CDN Choice

### Questions & Answers

#### Q: Where are we putting final assets today?

**Answer**: 📁 **Local filesystem** (`loom-lite/campaigns/`)

**Directory Structure**:
```
loom-lite/campaigns/
├── campaign-name-video-1/
│   ├── facecam.mp4
│   ├── final.mp4
│   ├── poster.jpg
│   └── config.json
├── campaign-name-video-2/
│   └── ...
```

**Served via Express static middleware** (`loom-lite/src/server.js:20`):
```javascript
app.use('/campaigns', express.static(CAMPAIGNS_DIR));
```

**URLs returned**: `/campaigns/campaign-name/final.mp4` (relative)

**Problem**:
- Not persistent (container restart = data loss)
- Not accessible from Next.js app on different domain
- Can't scale to multiple workers

**Status**: ❌ **Not production-ready**

---

#### Q: If not ready for Bunny, can we use Supabase Storage temporarily?

**Answer**: ✅ **YES - Recommended short-term solution**

**Implementation**:
```javascript
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function uploadToSupabaseStorage(localPath, fileName) {
  const fileBuffer = fs.readFileSync(localPath);

  // Upload to public bucket
  const { data, error } = await supabase.storage
    .from('renders')
    .upload(fileName, fileBuffer, {
      contentType: 'video/mp4',
      upsert: false,
      cacheControl: '3600' // 1 hour
    });

  if (error) throw error;

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('renders')
    .getPublicUrl(fileName);

  return publicUrl;
}

// Usage
const publicId = render.public_id;
const videoUrl = await uploadToSupabaseStorage(
  '/path/to/final.mp4',
  `${publicId}.mp4`
);
const thumbUrl = await uploadToSupabaseStorage(
  '/path/to/poster.jpg',
  `${publicId}.jpg`
);
```

**Create Public Bucket** (in Supabase dashboard):
1. Go to Storage
2. Create bucket: `renders`
3. Make it public
4. Set policies to allow public read

**URLs**: `https://<project-ref>.supabase.co/storage/v1/object/public/renders/<publicId>.mp4`

**Status**: ⚠️ **Recommended for MVP** (easy to migrate to Bunny later)

---

#### Q: If Bunny is ready, what are the env vars?

**Answer**: 📋 **Bunny CDN Configuration**

**Environment Variables**:
```env
# Storage API
BUNNY_STORAGE_ZONE=your-storage-zone-name
BUNNY_STORAGE_API_KEY=your-storage-api-key-here

# CDN Pull Zone
BUNNY_PULL_ZONE=your-pull-zone-name  # e.g., "vidgen-cdn"
BUNNY_CDN_BASE_URL=https://your-pull-zone.b-cdn.net
```

**Upload Function**:
```javascript
const axios = require('axios');

async function uploadToBunny(localPath, fileName) {
  const fileBuffer = fs.readFileSync(localPath);

  const response = await axios.put(
    `https://storage.bunnycdn.com/${process.env.BUNNY_STORAGE_ZONE}/renders/${fileName}`,
    fileBuffer,
    {
      headers: {
        'AccessKey': process.env.BUNNY_STORAGE_API_KEY,
        'Content-Type': 'video/mp4'
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    }
  );

  console.log('[Bunny] Upload response:', response.status);

  // Return public CDN URL
  return `${process.env.BUNNY_CDN_BASE_URL}/renders/${fileName}`;
}
```

**Final URL Pattern**: `https://vidgen-cdn.b-cdn.net/renders/<publicId>.mp4`

**Setup Steps**:
1. Create Bunny account
2. Create storage zone
3. Create pull zone linked to storage zone
4. Generate API key
5. Add env vars to worker

**Status**: 📋 **Ready to implement** (just needs env vars + upload code)

---

### Acceptance Criteria for Section D

| Criterion | Status | Notes |
|-----------|--------|-------|
| Public viewer /v/[publicId] plays video | ❌ | No viewer page exists |
| Video served from real URL (not local) | ❌ | Local filesystem only |
| Bunny/R2 integration | ❌ | Not implemented |
| Supabase Storage fallback | ⚠️ | Recommended for MVP |

**Overall**: Storage needs to be **migrated from local to cloud** before production.

---

## Implementation Gap Summary

### What Works ✅

1. **Database Schema**: Tables properly designed with RLS policies
2. **API Routes**: All endpoints correctly implemented with validation
3. **Auth & Security**: Server-side Supabase client, RLS enforcement, 404 for non-owners
4. **Rendering Engine**: loom-lite successfully produces videos
5. **URL Normalization**: Adds https:// to incomplete URLs
6. **Duration Validation**: Client + server validation

### What's Broken ❌

#### Critical (Blocks all functionality)

1. **Wizard doesn't use database APIs**
   - Calls `/api/render` instead of `/api/campaigns`
   - No campaign/scene records created
   - No database integration at all

2. **No worker job queue**
   - loom-lite is HTTP server, not background worker
   - Doesn't claim jobs from `render_jobs` table
   - No job loop, no polling

3. **No polling UI**
   - No campaign detail page (`/campaigns/[id]`)
   - No "Render" button
   - No progress bar
   - No status updates

4. **Local filesystem storage**
   - Videos not in cloud
   - Not accessible from Next.js app
   - Not production-ready

#### Medium (Blocks monitoring/UX)

5. **No error handling UI**
   - 422 validation errors not shown inline
   - 409 conflicts not shown as toasts
   - Generic "all videos failed" message

6. **No logging to database**
   - Logs only to stdout
   - Can't view render progress in UI

7. **No public video viewer**
   - `/v/[publicId]` page doesn't exist
   - Can't share videos

#### Low (Polish)

8. **No redirect after campaign creation**
9. **No toast library** for notifications
10. **No progress percentage display**

---

## Recommended Fix Order

### Phase 1: Wire Wizard to Database (1-2 hours)

1. **Update CampaignWizard.tsx**:
   - Change `POST /api/render` → `POST /api/campaigns`
   - Parse validation errors and show inline
   - Redirect to `/campaigns/[id]` on success

2. **Create `/campaigns/[id]/page.tsx`**:
   - Show campaign name, scenes
   - "Render" button → calls `POST /api/campaigns/[id]/render`
   - Handle 409 with toast

3. **Add polling**:
   - Poll `GET /api/renders/[renderId]` every 2s
   - Update progress bar
   - Show "View Video" when done

**Result**: Database-backed flow works, but videos still fail (no worker)

---

### Phase 2: Convert loom-lite to Worker (4-6 hours)

1. **Create `loom-lite/src/worker.js`**:
   - Job claiming loop
   - Call `rpc('claim_render_job')`
   - Update `renders.status` through stages

2. **Add Supabase integration**:
   - Install `@supabase/supabase-js`
   - Use `SUPABASE_SERVICE_ROLE_KEY`
   - Update renders table during pipeline

3. **Implement logging**:
   - Append to `render_jobs.log` via RPC

4. **Keep HTTP server** (optional):
   - For legacy `/api/render` compatibility
   - Or remove and use worker only

**Result**: Videos render and update database

---

### Phase 3: Cloud Storage (2-4 hours)

**Option A: Supabase Storage (MVP)**
1. Create public `renders` bucket
2. Upload via `supabase.storage.upload()`
3. Update `final_video_url` with public URL

**Option B: Bunny CDN (Production)**
1. Create Bunny account + zones
2. Implement upload with axios
3. Update env vars

**Result**: Videos accessible from `/v/[publicId]`

---

### Phase 4: Create Video Viewer (1-2 hours)

1. **Create `/v/[publicId]/page.tsx`**:
   - Look up render by `public_id`
   - Embed video player
   - Show metadata (campaign name, duration)

**Result**: Shareable video links work

---

### Phase 5: Polish (2-4 hours)

1. Install toast library (react-hot-toast)
2. Better error messages
3. Progress percentage
4. Retry failed renders

---

## Environment Variables Checklist

### vidgen-app (.env.local)

```env
# Supabase (client-safe keys only)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Optional: Loom-lite URL (if worker separate)
LOOM_LITE_URL=http://localhost:3100
```

### loom-lite (.env)

```env
# Supabase (server-only service key)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...  # NEVER in web app

# Server
PORT=3100

# Storage (choose one)

# Option A: Supabase Storage
STORAGE_TYPE=supabase

# Option B: Bunny CDN
STORAGE_TYPE=bunny
BUNNY_STORAGE_ZONE=your-zone
BUNNY_STORAGE_API_KEY=key
BUNNY_PULL_ZONE=pull-zone
BUNNY_CDN_BASE_URL=https://pull-zone.b-cdn.net
```

---

## Testing Acceptance Criteria

### Test A: Campaign Creation

```bash
# 1. Open wizard in browser
# 2. Fill form: name="Test Campaign", scenes=[{url: "https://google.com", duration: 30}]
# 3. Submit

# Expected:
# - POST /api/campaigns returns { id: "uuid" }
# - Database has 1 row in campaigns table
# - Database has 1 row in scenes table
# - Redirect to /campaigns/<uuid>
```

**Pass Criteria**: ✅ Campaign + scenes visible in Supabase dashboard

---

### Test B: Render Enqueue & Polling

```bash
# 1. On /campaigns/<uuid>, click "Render"

# Expected:
# - POST /api/campaigns/<uuid>/render returns { renderId: "uuid" }
# - Database has 1 row in renders (status='queued')
# - Database has 1 row in render_jobs (state='queued')
# - Progress bar appears, starts polling
# - Every 2s: GET /api/renders/<renderId>
# - Progress updates from 0 → 100
# - Status changes: queued → recording → done
# - "View Video" button appears
```

**Pass Criteria**: ✅ Render row exists with correct status

---

### Test C: Worker Processing

```bash
# 1. Start worker: cd loom-lite && node src/worker.js
# 2. Worker logs: "Claimed job <id>"

# Expected:
# - render_jobs.state: queued → running → done
# - renders.status: queued → recording → normalizing → done
# - renders.progress: 0 → 10 → 40 → 60 → 80 → 90 → 100
# - renders.final_video_url: populated
# - File uploaded to Bunny/Supabase Storage
```

**Pass Criteria**: ✅ Video URL returns 200, video plays

---

### Test D: Public Viewer

```bash
# 1. Open /v/<publicId>

# Expected:
# - Page loads (not 404)
# - Video player embedded
# - URL: https://<cdn>/renders/<publicId>.mp4
# - Video plays
```

**Pass Criteria**: ✅ Video plays without authentication

---

## Final Checklist

| Component | Status | Priority | Est. Hours |
|-----------|--------|----------|-----------|
| Wizard → /api/campaigns | ❌ | P0 | 1 |
| Campaign detail page | ❌ | P0 | 2 |
| Polling UI | ❌ | P0 | 1 |
| Worker job claiming | ❌ | P0 | 4 |
| Worker DB updates | ❌ | P0 | 2 |
| Cloud storage (Supabase) | ❌ | P0 | 2 |
| Video viewer /v/[publicId] | ❌ | P1 | 1 |
| Toast notifications | ❌ | P1 | 1 |
| Error handling | ❌ | P1 | 2 |
| Bunny CDN | ❌ | P2 | 2 |
| **Total** | | | **18-20 hours** |

**Status Key**:
- ✅ Working
- ⚠️ Partial
- ❌ Not implemented

---

## Conclusion

The **database-backed architecture is correctly designed and implemented** in the API layer. However, the **UI and worker are completely disconnected** from it.

**Current Flow** (broken):
```
Wizard → /api/render (proxy) → loom-lite HTTP server → local files
```

**Target Flow** (needs implementation):
```
Wizard → POST /api/campaigns → Database (campaigns + scenes)
↓
Campaign Page → POST /api/campaigns/[id]/render → Database (renders + render_jobs)
↓
Worker → Claim job → Update renders.status → Upload to CDN → Update final_video_url
↓
Campaign Page → Poll GET /api/renders/[id] → Show progress
↓
Viewer /v/[publicId] → Play video from CDN
```

**Next Steps**:
1. Fix wizard to call `/api/campaigns` (1 hour)
2. Create campaign detail page with polling (2 hours)
3. Convert loom-lite to worker (6 hours)
4. Add Supabase Storage upload (2 hours)
5. Create video viewer page (1 hour)

**Total implementation time**: ~12-15 hours to full functionality.
