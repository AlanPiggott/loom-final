# Loom-Lite System Overview & Current State

**Last Updated**: 2025-10-31
**Status**: MVP Working, Production Infrastructure In Progress
**Version**: 1.0.0

---

## Table of Contents

1. [What This System Does](#what-this-system-does)
2. [Current Architecture](#current-architecture)
3. [Technology Stack](#technology-stack)
4. [File Structure](#file-structure)
5. [How Video Rendering Works](#how-video-rendering-works)
6. [Database Schema](#database-schema)
7. [Existing Pages & Features](#existing-pages--features)
8. [What Works Right Now](#what-works-right-now)
9. [What Doesn't Work Yet](#what-doesnt-work-yet)
10. [Recent Changes](#recent-changes)
11. [Environment Configuration](#environment-configuration)
12. [Deployment & Infrastructure](#deployment--infrastructure)

---

## What This System Does

**Loom-Lite** is a personalized video outreach platform that automates the creation of customized demo videos for sales/marketing campaigns.

### The Problem It Solves

Sales teams want to send personalized video messages to prospects, but recording individual videos for hundreds of leads is impossible. Loom exists but is expensive and requires manual recording for each prospect.

### The Solution

Loom-Lite automatically generates personalized videos by:

1. **Recording website interactions** - Uses headless browser (Playwright/Steel) to record screen activity on any website
2. **Adding webcam overlay** - Combines screen recording with a facecam video of the sales rep
3. **Personalizing at scale** - Takes a CSV of leads and generates unique videos for each person by:
   - Navigating to their LinkedIn profile
   - Scrolling through their company website
   - Showing their product page
   - Any custom URL sequence
4. **Delivering shareable links** - Each video gets a unique URL with optional Calendly booking integration

### Example Use Case

**Before**: Sales rep manually records 100 videos, spending 5 minutes per video = 8.3 hours
**After**: Sales rep records ONE facecam video (2 min), uploads CSV of 100 leads → system generates 100 personalized videos automatically in ~20 minutes

Each prospect gets a video showing:
- Their LinkedIn profile being scrolled
- Their company website being explored
- Sales rep's face in bottom-right corner explaining value prop
- Custom landing page with their name and Calendly booking link

---

## Current Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                         USER FLOW                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  NEXT.JS FRONTEND (vidgen-app/)                             │
│  - Dashboard (campaign management)                           │
│  - Campaign wizard (create new campaigns)                    │
│  - Public video viewer (for prospects)                       │
│  - Authentication (Supabase Auth)                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  SUPABASE (Database + Auth + Storage)                       │
│  - PostgreSQL database                                       │
│  - Row-level security policies                               │
│  - File storage (CSVs, facecams)                            │
│  - Real-time subscriptions (progress updates)               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  RENDER WORKER (loom-lite/src/worker.js)                   │
│  - Polls database for render jobs                           │
│  - Downloads facecam & CSV files                            │
│  - Executes video pipeline                                   │
│  - Uploads final videos to CDN                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  VIDEO PIPELINE (loom-lite/src/pipeline/)                  │
│  1. Record scenes (browser automation)                      │
│  2. Normalize scenes (trim, resize, fps conversion)        │
│  3. Concatenate scenes (stitch together)                    │
│  4. Overlay facecam (PiP video + audio sync)               │
│  5. Generate thumbnail                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEEL BROWSER (Remote Chromium)                            │
│  - Headless browser in cloud                                │
│  - Records screen activity as video                          │
│  - Handles complex JS sites (SPAs)                          │
│  - Alternative: Local Playwright (dev mode)                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  BUNNY CDN (Video Storage & Delivery)                       │
│  - Stores final videos (MP4)                                │
│  - Stores thumbnails (JPG)                                  │
│  - Fast global delivery                                      │
│  - Low bandwidth costs                                       │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow for a Single Render

```
1. User creates campaign in dashboard
   ↓
2. User uploads CSV with lead data + facecam video
   ↓
3. User clicks "Render Videos"
   ↓
4. API creates render_jobs in database (one per CSV row)
   ↓
5. Worker polls database, finds job
   ↓
6. Worker downloads facecam from Supabase
   ↓
7. Worker parses CSV to get lead-specific URLs
   ↓
8. For each scene:
   - Steel browser navigates to URL
   - Records screen for X seconds
   - Saves raw .webm file
   ↓
9. FFmpeg processes videos:
   - Trims white screens
   - Normalizes resolution/fps
   - Concatenates scenes
   - Overlays facecam in bottom-right
   - Generates thumbnail
   ↓
10. Worker uploads final.mp4 + poster.jpg to Bunny CDN
    ↓
11. Worker updates database with CDN URLs
    ↓
12. User sees completed video in dashboard
    ↓
13. User shares public link with prospect
```

---

## Technology Stack

### Frontend (Next.js App)

**Location**: `../vidgen-app/` (separate repo/directory)

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui (Radix primitives)
- **Auth**: Supabase Auth (magic links, social login)
- **State**: React hooks + URL params
- **Forms**: Native HTML5 + React Hook Form (likely)
- **API**: Next.js API routes (`app/api/`)

### Backend (Node.js Worker)

**Location**: `loom-lite/` (this directory)

- **Language**: JavaScript (CommonJS)
- **Runtime**: Node.js
- **Database**: Supabase (PostgreSQL client)
- **Video Processing**: FFmpeg (via ffmpeg-static)
- **Browser Automation**:
  - Playwright (local dev)
  - Steel SDK (production remote browsers)
- **Storage**: Bunny CDN (via REST API)
- **Job Queue**: PostgreSQL polling (no Redis/SQS)
- **Process Manager**: PM2 (for production)

### Database

- **Provider**: Supabase (managed PostgreSQL)
- **Version**: PostgreSQL 15+
- **Features Used**:
  - Row-level security (RLS)
  - Real-time subscriptions
  - Foreign keys & constraints
  - JSONB columns for flexible data
  - RPC functions for atomic operations

### Infrastructure

- **Video Recording**: Steel.dev (remote Chromium instances)
- **Video Storage**: Bunny CDN (storage zone + pull zone)
- **Frontend Hosting**: Vercel (Next.js deployment)
- **Worker Hosting**: VPS or dedicated server (needs FFmpeg + disk space)
- **Database**: Supabase Cloud (or self-hosted)

---

## File Structure

### Backend (loom-lite/)

```
loom-lite/
├── campaigns/                    # Working directory for renders (TEMP - 4.3GB currently)
│   └── [campaign-name-render-id]/
│       ├── cache/               # Cached scene recordings for reuse
│       ├── work/                # Raw scene videos (.webm, .mp4)
│       ├── config.json          # Render configuration
│       ├── facecam.mp4         # Downloaded facecam
│       ├── final.mp4           # Final video (before upload)
│       └── poster.jpg          # Thumbnail (before upload)
│
├── src/
│   ├── worker.js               # Main worker process (polls for jobs)
│   ├── storage.js              # Bunny CDN upload/purge logic
│   │
│   ├── lib/
│   │   └── supabase.js         # Database client & helper functions
│   │
│   ├── pipeline/
│   │   ├── renderCampaignWithProgress.js  # Main render orchestrator
│   │   ├── renderCampaign.js              # CLI wrapper for testing
│   │   └── trimCampaignDurations.js       # Auto-fill scene durations
│   │
│   ├── recording/
│   │   ├── recordScene.js      # Browser automation (Playwright/Steel)
│   │   ├── steelSession.js     # Steel browser session management
│   │   └── actions.js          # Browser actions (scroll, click, etc)
│   │
│   ├── compose/
│   │   ├── normalizeScene.js   # Trim + resize + fps conversion
│   │   ├── concatScenes.js     # Stitch scenes together
│   │   ├── overlayFacecam.js   # Add facecam overlay
│   │   └── thumbnail.js        # Generate poster frame
│   │
│   ├── hme/                    # Human Motion Engine (natural scrolling)
│   │   ├── index.js            # Main HME runner
│   │   ├── beats.js            # Scene choreography system
│   │   ├── scroll.js           # Inertial scrolling with easing
│   │   └── seedrandom.js       # Deterministic RNG for natural motion
│   │
│   ├── utils/
│   │   ├── ffmpeg.js           # FFmpeg wrapper functions
│   │   ├── ffmpegCheck.js      # Verify FFmpeg installation
│   │   ├── detectWhiteLeadIn.js # Auto-trim white screens
│   │   └── urlNormalizer.js    # Add https:// to URLs
│   │
│   ├── providers/
│   │   └── steel.js            # Steel API client
│   │
│   └── scripts/
│       └── cleanup-old-renders.js  # Cron job for disk cleanup
│
├── migrations/                  # SQL migrations (manual execution)
│   ├── add_brand_columns_to_renders.sql
│   └── create_usage_tracking.sql
│
├── .env                        # Environment variables (NOT in git)
├── .env.example                # Template with all required vars
├── package.json                # Dependencies & scripts
└── ecosystem.config.js         # PM2 configuration (if using PM2)
```

### Frontend (vidgen-app/)

```
vidgen-app/
├── src/
│   ├── app/
│   │   ├── (app)/              # Authenticated routes
│   │   │   ├── dashboard/      # Campaign list
│   │   │   ├── campaigns/      # Campaign detail pages
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx           # Campaign detail
│   │   │   │       └── RenderControls.tsx # Render actions
│   │   │   └── layout.tsx      # Sidebar + nav
│   │   │
│   │   ├── (public)/           # Public routes (no auth)
│   │   │   └── v/[publicId]/   # Public video viewer
│   │   │       └── page.tsx
│   │   │
│   │   ├── api/                # API routes (backend)
│   │   │   ├── campaigns/
│   │   │   │   ├── route.ts              # List/create campaigns
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts          # Get/update/delete campaign
│   │   │   │       └── render/route.ts   # Trigger renders
│   │   │   └── v/[publicId]/route.ts     # Get public video data
│   │   │
│   │   ├── login/              # Login page
│   │   └── signup/             # Signup page
│   │
│   ├── components/
│   │   ├── CampaignWizard.tsx  # Multi-step campaign creation
│   │   ├── Sidebar.tsx         # App navigation
│   │   └── ui/                 # shadcn/ui components
│   │
│   └── lib/
│       ├── supabase/
│       │   ├── client.ts       # Browser Supabase client
│       │   └── server.ts       # Server Supabase client
│       └── utils.ts            # Helper functions
│
├── public/                     # Static assets
├── .env.local                  # Frontend env vars (NOT in git)
└── next.config.js              # Next.js configuration
```

---

## How Video Rendering Works

### Overview

The rendering system takes a campaign configuration and produces personalized videos by:
1. Recording browser interactions on specified URLs
2. Processing and stitching the recordings together
3. Overlaying a facecam video
4. Uploading to CDN for delivery

### Step-by-Step Pipeline

#### 1. Job Creation (Frontend)

**File**: `vidgen-app/src/app/api/campaigns/[id]/render/route.ts`

When user clicks "Render Videos":
```typescript
// For each row in CSV:
const { data: render } = await supabase
  .from('renders')
  .insert({
    campaign_id,
    lead_csv_url,      // Supabase storage URL
    lead_row_index: i, // Which CSV row (0-indexed)
    facecam_url,       // Supabase storage URL
    status: 'queued',
    progress: 0
  })
  .select()
  .single();

// Create job for worker to pick up
await supabase
  .from('render_jobs')
  .insert({
    render_id: render.id,
    state: 'queued'
  });
```

#### 2. Job Claiming (Worker)

**File**: `loom-lite/src/worker.js`

Worker runs continuously, polling every 2 seconds:
```javascript
// Atomic job claiming (prevents duplicate work)
const job = await supabase.rpc('claim_render_job');

if (job) {
  await processJob(job);
}
```

Database function ensures only one worker can claim each job:
```sql
UPDATE render_jobs
SET state = 'processing', started_at = NOW()
WHERE id = (
  SELECT id FROM render_jobs
  WHERE state = 'queued'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

#### 3. Scene Recording

**File**: `loom-lite/src/recording/recordScene.js`

For each scene in the campaign:

**A. Browser Setup**
```javascript
// Connect to Steel remote browser OR local Playwright
const browser = await chromium.connectOverCDP(steelWsEndpoint);
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: workDir }
});
const page = await context.newPage();
```

**B. Navigation & Page Ready**
```javascript
await page.goto(scene.url, { waitUntil: 'domcontentloaded' });

// Wait for page to be visually ready (not just networkidle)
// - DOM loaded
// - Fonts ready
// - First contentful paint
// - Visual stability (no more layout shifts)
await waitForPageReady(page, maxWaitMs);

// Ensure widgets initialize (Calendly, etc)
await ensureWidgetsReady(page);
```

**C. Human Motion Engine (HME)**

If scene has no manual actions, HME generates natural scrolling:

**File**: `loom-lite/src/hme/index.js`

```javascript
// 1. Analyze page content (find headings, sections)
const headings = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('h1, h2, h3'))
    .map(el => ({
      y: el.getBoundingClientRect().top + window.scrollY,
      text: el.textContent.trim()
    }));
});

// 2. Generate scroll plan (pause at headings)
const scrollSegments = generateContentAwareScrollSegments(page, {
  totalDurationMs: scene.durationSec * 1000,
  rand: seededRandom(scene.url) // Deterministic
});

// 3. Execute natural scrolling with easing
for (const segment of scrollSegments) {
  // Smooth scroll with sin/exp envelope
  await executeScrollSegments(page, [segment]);
  // Pause for "reading time"
  await page.waitForTimeout(segment.pauseAfterMs);
}
```

**D. Recording Capture**
```javascript
// Browser records entire time to .webm file
// Recording stops when page is closed
const videoPath = await page.video().path();
```

**E. Scene Caching**

To avoid re-recording the same URL:
```javascript
const cacheKey = md5(scene.url);
const cachedPath = `cache/${cacheKey}.webm`;

if (fs.existsSync(cachedPath)) {
  console.log('Using cached recording');
  return cachedPath;
} else {
  // Record and save to cache
  fs.copyFileSync(videoPath, cachedPath);
}
```

#### 4. Scene Normalization

**File**: `loom-lite/src/compose/normalizeScene.js`

Each raw recording is processed:

**A. Auto-Trim White Lead-In**

**File**: `loom-lite/src/utils/detectWhiteLeadIn.js`

```javascript
// Sample frames to find where content appears
const framePaths = extractFrames(videoPath, sampleRate);

for (let i = 0; i < framePaths.length; i++) {
  const avgLuma = calculateAverageLuma(framePaths[i]);

  if (avgLuma < 0.95) {
    // Found first non-white frame
    trimDurationMs = i * sampleIntervalMs;
    break;
  }
}
```

**B. FFmpeg Normalization**
```bash
ffmpeg -i input.webm \
  -ss 4.5                    # Skip white lead-in (4.5s = 1.5s nav + 3s pageload)
  -vframes 900               # Exact frame count (15s * 60fps)
  -r 60                      # Force 60fps
  -vf "scale=1920:1080,setsar=1" \
  -pix_fmt yuv420p           # Compatible pixel format
  -c:v libx264 -preset veryfast -crf 18 \
  -an                        # No audio (screen recording)
  output.mp4
```

#### 5. Scene Concatenation

**File**: `loom-lite/src/compose/concatScenes.js`

Stitch all normalized scenes together:

```bash
# Create concat file list
echo "file 'scene-1.mp4'" > concat.txt
echo "file 'scene-2.mp4'" >> concat.txt
echo "file 'scene-3.mp4'" >> concat.txt

# Concatenate with FFmpeg
ffmpeg -f concat -safe 0 -i concat.txt \
  -c copy \
  background.mp4
```

#### 6. Facecam Overlay

**File**: `loom-lite/src/compose/overlayFacecam.js`

Composite facecam video in bottom-right corner:

```bash
ffmpeg \
  -i background.mp4 \
  -i facecam.mp4 \
  -filter_complex "[1:v]scale=320:-1[pip]; \
    [0:v][pip]overlay=W-w-24:H-h-24" \
  -map 0:a? -map 1:a? \      # Mix audio from both
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 128k \
  final.mp4
```

**Facecam Position Options**:
- `bottom-right`: `W-w-24:H-h-24`
- `bottom-left`: `24:H-h-24`
- `top-right`: `W-w-24:24`
- `top-left`: `24:24`

#### 7. Thumbnail Generation

**File**: `loom-lite/src/compose/thumbnail.js`

Extract frame at 3 seconds:

```bash
ffmpeg -i final.mp4 \
  -ss 3 \
  -vframes 1 \
  -vf "scale=1280:720" \
  -q:v 2 \
  poster.jpg
```

#### 8. CDN Upload

**File**: `loom-lite/src/storage.js`

Upload to Bunny Storage:

```javascript
// Upload video
await axios.put(
  `https://storage.bunnycdn.com/${storageZone}/${publicId}.mp4`,
  fs.readFileSync(videoPath),
  {
    headers: {
      'AccessKey': BUNNY_STORAGE_API_KEY,
      'Content-Type': 'video/mp4'
    }
  }
);

const videoUrl = `https://your-cdn.b-cdn.net/${publicId}.mp4`;

// Upload thumbnail
await axios.put(
  `https://storage.bunnycdn.com/${storageZone}/${publicId}.jpg`,
  fs.readFileSync(thumbPath),
  {
    headers: {
      'AccessKey': BUNNY_STORAGE_API_KEY,
      'Content-Type': 'image/jpeg'
    }
  }
);

const thumbUrl = `https://your-cdn.b-cdn.net/${publicId}.jpg`;
```

**CDN Purge** (optional):
```javascript
await axios.post(
  `https://api.bunny.net/pullzone/${pullZoneId}/purgeCache`,
  {
    urls: [videoUrl, thumbUrl]
  },
  {
    headers: { 'AccessKey': BUNNY_ACCOUNT_API_KEY }
  }
);
```

#### 9. Database Update

```javascript
await supabase
  .from('renders')
  .update({
    status: 'completed',
    progress: 100,
    video_url: videoUrl,
    thumbnail_url: thumbUrl,
    completed_at: new Date().toISOString()
  })
  .eq('id', render_id);

await supabase
  .from('render_jobs')
  .update({
    state: 'completed'
  })
  .eq('id', job_id);
```

#### 10. Cleanup (NEW - Just Implemented)

**File**: `loom-lite/src/worker.js` (lines 67-104)

After successful upload:
```javascript
await cleanupCampaignDir(campaignDir, true);
// Schedules deletion after 1 hour
// Failed renders kept for 7 days
```

### Progress Updates

Throughout the pipeline, status is updated in real-time:

```javascript
const progressCallback = async (status, progress) => {
  await supabase
    .from('renders')
    .update({ status, progress })
    .eq('id', render_id);
};

// During pipeline:
progressCallback('recording', 20);   // Recording scenes
progressCallback('normalizing', 50); // Processing videos
progressCallback('concatenating', 60); // Stitching
progressCallback('overlaying', 80);  // Adding facecam
progressCallback('uploading', 90);   // Uploading to CDN
progressCallback('completed', 100);  // Done
```

Frontend subscribes to changes via Supabase real-time:
```typescript
supabase
  .channel('renders')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'renders',
    filter: `campaign_id=eq.${campaignId}`
  }, (payload) => {
    updateRenderInUI(payload.new);
  })
  .subscribe();
```

---

## Database Schema

### Core Tables

#### `campaigns`

Stores campaign configurations.

```sql
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,

  -- Scene configuration (JSONB array)
  scenes JSONB NOT NULL DEFAULT '[]'::JSONB,
  -- Example:
  -- [
  --   {
  --     "id": "scene-1",
  --     "url": "https://example.com",
  --     "duration_sec": 15,
  --     "entry_type": "manual",
  --     "csv_column": null
  --   },
  --   {
  --     "id": "scene-2",
  --     "url": null,
  --     "duration_sec": 10,
  --     "entry_type": "csv",
  --     "csv_column": "linkedin_url"
  --   }
  -- ]

  -- Output settings (JSONB)
  output_settings JSONB DEFAULT '{
    "width": 1920,
    "height": 1080,
    "fps": 60,
    "pageLoadWaitMs": 3000,
    "facecam": {
      "pip": {
        "width": 320,
        "margin": 24,
        "corner": "bottom-right"
      },
      "endPadMode": "freeze"
    }
  }'::JSONB,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
```

#### `renders`

Individual video renders (one per CSV row).

```sql
CREATE TABLE renders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

  -- Lead data
  lead_csv_url TEXT,           -- Supabase storage URL to CSV
  lead_row_index INTEGER,      -- Which row (0-indexed)
  lead_identifier TEXT,        -- Display name (from CSV column)

  -- Media files
  facecam_url TEXT,            -- Supabase storage URL to facecam video
  video_url TEXT,              -- Bunny CDN URL to final video
  thumbnail_url TEXT,          -- Bunny CDN URL to thumbnail

  -- Render status
  status TEXT NOT NULL DEFAULT 'queued',
  -- Possible values:
  -- 'queued' | 'recording' | 'normalizing' | 'concatenating' |
  -- 'overlaying' | 'creating_thumbnail' | 'uploading' |
  -- 'completed' | 'failed' | 'cancelled'

  progress INTEGER DEFAULT 0,  -- 0-100
  error_message TEXT,

  -- Public sharing
  public_id TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
  -- Used in public URL: /v/[public_id]

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE  -- NEW (just added)
);

CREATE INDEX idx_renders_campaign_id ON renders(campaign_id);
CREATE INDEX idx_renders_public_id ON renders(public_id);
CREATE INDEX idx_renders_status ON renders(status);
CREATE INDEX idx_renders_cancelled_at ON renders(cancelled_at)
  WHERE cancelled_at IS NOT NULL;  -- NEW
```

#### `render_jobs`

Job queue for worker polling.

```sql
CREATE TABLE render_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  render_id UUID NOT NULL REFERENCES renders(id) ON DELETE CASCADE,

  state TEXT NOT NULL DEFAULT 'queued',
  -- Possible values: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'

  error_message TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_render_jobs_state ON render_jobs(state);
CREATE INDEX idx_render_jobs_created_at ON render_jobs(created_at);
```

#### `profiles`

Extended user data (linked to Supabase auth.users).

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### Database Functions (RPC)

#### `claim_render_job()`

Atomically claims next queued job.

```sql
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
) AS $$
DECLARE
  v_job_id UUID;
BEGIN
  -- Lock and claim oldest queued job
  SELECT rj.id INTO v_job_id
  FROM render_jobs rj
  WHERE rj.state = 'queued'
  ORDER BY rj.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job_id IS NULL THEN
    RETURN; -- No jobs available
  END IF;

  -- Mark as processing
  UPDATE render_jobs
  SET state = 'processing',
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
```

#### `cancel_render()` (NEW - Not yet implemented)

Cancels an in-progress render.

```sql
CREATE OR REPLACE FUNCTION cancel_render(p_render_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_status TEXT;
BEGIN
  SELECT status INTO v_current_status
  FROM renders
  WHERE id = p_render_id;

  IF v_current_status NOT IN (
    'queued', 'recording', 'normalizing',
    'concatenating', 'overlaying', 'creating_thumbnail', 'uploading'
  ) THEN
    RETURN FALSE; -- Already completed or failed
  END IF;

  UPDATE renders
  SET cancelled_at = NOW(),
      status = 'cancelled',
      updated_at = NOW()
  WHERE id = p_render_id;

  UPDATE render_jobs
  SET state = 'cancelled',
      updated_at = NOW()
  WHERE render_id = p_render_id
    AND state = 'processing';

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
```

### Row-Level Security (RLS)

Ensures users can only access their own data.

```sql
-- Enable RLS on all tables
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE renders ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Campaigns: Users can only see/edit their own
CREATE POLICY "Users can view own campaigns"
  ON campaigns FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own campaigns"
  ON campaigns FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own campaigns"
  ON campaigns FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own campaigns"
  ON campaigns FOR DELETE
  USING (auth.uid() = user_id);

-- Renders: Access through campaign ownership
CREATE POLICY "Users can view renders of own campaigns"
  ON renders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM campaigns
      WHERE campaigns.id = renders.campaign_id
        AND campaigns.user_id = auth.uid()
    )
  );

-- Public video viewer: Anyone can view with public_id
CREATE POLICY "Anyone can view public renders"
  ON renders FOR SELECT
  USING (public_id IS NOT NULL);

-- Profiles: Users can only see/edit their own
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);
```

---

## Existing Pages & Features

### Frontend Pages (vidgen-app/)

#### 1. **Dashboard** (`/dashboard`)

**Route**: `app/(app)/dashboard/page.tsx`

**What it shows**:
- List of all campaigns for logged-in user
- Campaign cards with:
  - Campaign name
  - Number of scenes
  - Number of renders
  - Created date
  - "View" button to go to campaign detail

**Features**:
- Create new campaign button (opens wizard)
- Search/filter campaigns (if implemented)
- Pagination (if many campaigns)

**Current state**: Working, basic layout

---

#### 2. **Campaign Detail** (`/campaigns/[id]`)

**Route**: `app/(app)/campaigns/[id]/page.tsx`

**What it shows**:
- Campaign name and metadata
- List of scenes with URLs and durations
- Render controls (RenderControls.tsx component)
- Table of renders with status indicators
- Progress bars for in-progress renders

**Features**:
- Edit campaign button
- Delete campaign button
- Render videos button (opens modal/form)
- CSV upload for lead data
- Facecam upload
- View individual render results
- Copy public video links

**Current state**: Working, functional but "bare-bones" per user feedback

**Component**: `RenderControls.tsx`
- Handles CSV + facecam upload
- Triggers render job creation
- Shows real-time progress updates

---

#### 3. **Campaign Wizard** (`/campaigns/new`)

**Component**: `components/CampaignWizard.tsx`

**What it does**:
- Multi-step form to create new campaign
- Steps:
  1. Campaign name
  2. Add scenes (manual URLs or CSV column)
  3. Set scene durations
  4. Configure output settings
  5. Review & create

**Features**:
- Add/remove scenes
- Specify which CSV column for dynamic URLs
- Auto-fill scene durations (analyze facecam length)
- Preview configuration

**Current state**: Working

---

#### 4. **Public Video Viewer** (`/v/[publicId]`)

**Route**: `app/(public)/v/[publicId]/page.tsx`

**What it shows**:
- Video player with the rendered video
- Thumbnail poster image
- Lead's name (if available)
- Optional: Calendly booking widget
- Optional: Custom branding

**Features**:
- Clean, prospect-facing design
- Autoplay video on load
- No authentication required
- Shareable link
- Analytics tracking (views, watch time - if implemented)

**Current state**: "Not finished" per user feedback
- Video playback works
- Missing: Calendly integration, custom branding, analytics

---

#### 5. **Authentication Pages**

**Routes**:
- `/login` - Login with magic link or social
- `/signup` - Create new account

**Provider**: Supabase Auth
**Features**:
- Magic link email authentication
- Social login (Google, GitHub, etc - if configured)
- Password reset

**Current state**: Working (using Supabase Auth UI)

---

#### 6. **API Routes** (`/api/*`)

**Campaigns API** (`/api/campaigns`):
- `GET /api/campaigns` - List user's campaigns
- `POST /api/campaigns` - Create new campaign
- `GET /api/campaigns/[id]` - Get campaign details
- `PUT /api/campaigns/[id]` - Update campaign
- `DELETE /api/campaigns/[id]` - Delete campaign
- `POST /api/campaigns/[id]/render` - Trigger render jobs

**Public API** (`/api/v/[publicId]`):
- `GET /api/v/[publicId]` - Get public video data (no auth)

**Current state**: Working for basic CRUD operations

---

### Pages That DON'T Exist Yet

Per user request and PRODUCTION_ROADMAP.md:

1. **Settings Page** - User profile, API keys, billing, notifications
2. **Homepage** - Marketing site for new users
3. **Contact Page** - Support form
4. **About Page** - Company info
5. **Pricing Page** - Subscription tiers
6. **Use Cases Page** - Customer stories
7. **Documentation** - How-to guides
8. **Admin Dashboard** - User management (if multi-tenant)

---

## What Works Right Now

### ✅ Fully Functional

1. **Video Rendering Pipeline**
   - Records websites with Playwright/Steel ✅
   - Processes videos with FFmpeg ✅
   - Adds facecam overlay ✅
   - Generates thumbnails ✅
   - Uploads to Bunny CDN ✅
   - Duration: ~2-5 minutes per video (depending on scenes)

2. **HME (Human Motion Engine)**
   - Natural scrolling with inertia ✅
   - Content-aware pauses at headings ✅
   - Deterministic (same URL = same scroll pattern) ✅
   - Peek-back scrolling ✅
   - Multiple envelope functions (sin, exp) ✅

3. **Worker System**
   - Polls database every 2 seconds ✅
   - Atomic job claiming (no duplicates) ✅
   - Progress updates in real-time ✅
   - Error handling with retries (3 attempts per scene) ✅
   - Graceful shutdown on SIGTERM/SIGINT ✅

4. **Scene Caching**
   - Reuses recordings for same URL ✅
   - Saves to `campaigns/[id]/cache/` directory ✅
   - MD5 hash for cache keys ✅
   - Speeds up re-renders dramatically ✅

5. **Auto-Trim White Screens**
   - Detects white lead-in frames ✅
   - Automatically trims navigation time ✅
   - Uses luminance analysis ✅
   - Configurable via `pageLoadWaitMs` ✅

6. **Widget Initialization** (JUST FIXED)
   - Calendly embeds render properly ✅
   - Uses CDP to set page lifecycle ✅
   - Dispatches resize/scroll events ✅
   - Waits for fonts + double rAF ✅

7. **Disk Cleanup Management** (JUST IMPLEMENTED)
   - Automatic cleanup with retention policies ✅
   - Successful renders: 1 hour retention ✅
   - Failed renders: 7 day retention ✅
   - Periodic cleanup cron job ✅
   - Configurable via environment variables ✅

8. **Database Integration**
   - Supabase PostgreSQL client ✅
   - Row-level security ✅
   - Real-time subscriptions ✅
   - Atomic operations via RPC functions ✅

9. **Frontend Dashboard**
   - Campaign list ✅
   - Campaign detail with renders ✅
   - Campaign wizard (multi-step form) ✅
   - Real-time progress updates ✅
   - CSV + facecam upload ✅

10. **Public Video Viewer**
    - Plays rendered videos ✅
    - Uses public_id for sharing ✅
    - No authentication required ✅

11. **Authentication**
    - Supabase Auth integration ✅
    - Magic link login ✅
    - Protected routes ✅
    - User sessions ✅

### ⚠️ Partially Working

1. **Video Landing Pages**
   - Basic video playback works ✅
   - Missing: Calendly integration ⚠️
   - Missing: Custom branding ⚠️
   - Missing: Analytics tracking ⚠️

2. **Dashboard**
   - Shows campaigns and renders ✅
   - Missing: Search/filter ⚠️
   - Missing: Bulk actions ⚠️
   - Missing: Usage stats ⚠️

3. **Facecam Duration Validation**
   - Checks if scene durations match facecam ✅
   - Throws error on mismatch ✅
   - Missing: Auto-fill from facecam length ⚠️
   - Missing: UI warnings before render ⚠️

---

## What Doesn't Work Yet

### 🚨 Critical Missing Features (From PRODUCTION_ROADMAP.md)

1. **Cancellation Support**
   - **Problem**: Can't stop renders mid-execution
   - **Impact**: Wastes Steel minutes if user made mistake
   - **Status**: Database column added (`cancelled_at`), logic not implemented
   - **ETA**: 6-8 hours to complete

2. **Health Checks & Monitoring**
   - **Problem**: No way to know if worker crashes
   - **Impact**: Silent failures, support tickets
   - **Status**: Not started
   - **Needed**: HTTP health endpoint, heartbeat, PM2 config
   - **ETA**: 3-4 hours

3. **Concurrency Limits**
   - **Problem**: Could spawn unlimited concurrent renders
   - **Impact**: Overwhelms Steel, 10x cost spike
   - **Status**: Not implemented
   - **Needed**: MAX_CONCURRENT_JOBS check with DB semaphore
   - **ETA**: 2-3 hours

4. **Settings Page**
   - **Problem**: No user settings UI
   - **Impact**: Can't update profile, manage API keys, view billing
   - **Status**: Page doesn't exist
   - **Needed**: Profile edit, password change, API keys, billing link
   - **ETA**: 6-8 hours

5. **Custom Subdomains** (Higher Tier Feature)
   - **Problem**: All videos use main domain
   - **Impact**: Can't offer branded URLs (e.g., videos.acmecorp.com)
   - **Status**: Not started
   - **Needed**: DNS routing, SSL, domain verification
   - **ETA**: 12-16 hours

6. **Stripe Integration**
   - **Problem**: Unclear if Stripe is connected/working
   - **Impact**: Can't charge users, track subscriptions
   - **Status**: "Somewhere but not sure how it works" per user
   - **Needed**: Audit existing setup, connect webhooks, test flow
   - **ETA**: 4-6 hours

7. **Usage Limits & Tracking**
   - **Problem**: No enforcement of plan limits
   - **Impact**: Users can render unlimited videos
   - **Status**: Not implemented
   - **Needed**: Count renders per user, block at limit, upgrade prompts
   - **ETA**: 6-8 hours

8. **Marketing Pages**
   - **Problem**: No homepage, contact, about, pricing pages
   - **Impact**: Can't onboard new users
   - **Status**: Not started
   - **ETA**: 20-30 hours total

### 🐛 Known Bugs/Issues

1. **Maximum Campaign Duration Limit**
   - **Limit**: 5 minutes total (300 seconds)
   - **Reason**: Steel browser timeout, processing time
   - **Code**: `src/pipeline/renderCampaignWithProgress.js:103-111`
   - **Workaround**: Split into multiple campaigns

2. **Facecam Duration Mismatch Error**
   - **Problem**: If sum of scene durations ≠ facecam length, render fails
   - **Error**: "Duration mismatch: Scenes total 45s must equal facecam 60s"
   - **Workaround**: Manually adjust scene durations or trim facecam
   - **Fix needed**: Auto-fill scene durations from facecam

3. **CSV Column Validation**
   - **Problem**: No validation that CSV has required columns
   - **Error**: "CSV column 'linkedin_url' is empty for lead row 5"
   - **Fix needed**: Validate CSV columns before rendering

4. **No Retry for Failed Uploads**
   - **Problem**: If Bunny CDN upload fails, entire render fails
   - **Fix needed**: Retry upload with exponential backoff

5. **Steel Session Cleanup**
   - **Problem**: Steel sessions sometimes don't release properly
   - **Impact**: Dangling sessions waste credits
   - **Status**: Partially addressed with shared context
   - **Fix needed**: Better error handling and explicit release

### 🎨 UI/UX Gaps

1. **Dashboard is "Bare-Bones"**
   - No search or filtering
   - No bulk actions (delete multiple)
   - No usage stats/charts
   - No recent activity feed

2. **Campaign Wizard**
   - No preview before saving
   - No scene reordering (drag-drop)
   - No duplicate scene button

3. **Render Status**
   - Progress bar is generic (doesn't show current scene)
   - No estimated time remaining
   - No detailed logs/timeline

4. **Public Video Viewer**
   - Generic design (not polished)
   - No Calendly integration yet
   - No custom branding
   - No view analytics

5. **Error Messages**
   - Technical errors shown to user
   - No user-friendly explanations
   - No suggested fixes

---

## Recent Changes

### Today (2025-10-31)

#### ✅ Disk Cleanup Management Implemented

**Files Changed**:
- `src/worker.js` - Added cleanup configuration and `cleanupCampaignDir()` function
- `src/scripts/cleanup-old-renders.js` - Created periodic cleanup cron job
- `package.json` - Added `cleanup` script
- `.env.example` - Added cleanup environment variables

**What it does**:
- Automatically schedules cleanup of campaign directories
- Successful renders: deleted after 1 hour
- Failed renders: deleted after 7 days
- Prevents disk exhaustion (currently at 4.3GB)

**Configuration**:
```bash
CLEANUP_ENABLED=true
FAILED_RENDER_RETENTION_DAYS=7
SUCCESS_RENDER_RETENTION_HOURS=1
CLEANUP_MAX_AGE_DAYS=30
```

**Manual cleanup**: `npm run cleanup`

---

### Last Week (Approximate)

#### ✅ Widget Readiness Fix

**File**: `src/recording/recordScene.js:106-150`

**Problem**: Calendly and other embeds showed white screens in Steel recordings

**Solution**:
- Use CDP to set page lifecycle to "active"
- Dispatch resize/scroll/focus events
- Wait for fonts + double rAF
- 1.5s initialization delay

**Impact**: Widgets now render properly in videos

---

#### ✅ HME Scroll Timing Improvements

**Files**: `src/hme/scroll.js`, `src/hme/beats.js`

**Changes**:
- Reduced burst amplitudes (60-140px instead of 240-480px)
- Increased burst durations (900-1600ms instead of 320-540ms)
- Longer reading pauses (900-1800ms)
- Content-aware pauses at headings
- Result: More natural, human-like scrolling

---

#### ✅ Scene Caching System

**File**: `src/pipeline/renderCampaignWithProgress.js:66-68, 126-172`

**What it does**:
- Saves recorded scenes to `campaigns/[id]/cache/` directory
- MD5 hash of URL as cache key
- Reuses cached recordings for same URLs
- Dramatically speeds up re-renders (skips Steel browser entirely)

**Example**: Recording LinkedIn profile once, reusing for all leads

---

### Earlier Changes (This Month)

- Switched from Browserless to Steel for remote browsers
- Implemented shared Steel context (one session per campaign instead of per scene)
- Added video-layer auto-trim for white screens
- Fixed viewport stabilization for Steel
- Added retry logic with exponential backoff (3 attempts per scene)
- Implemented facecam duration validation
- Added progress callbacks throughout pipeline
- Created public video viewer with shareable links

---

## Environment Configuration

### Required Environment Variables

#### Backend (loom-lite/.env)

```bash
# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Worker Configuration
WORKER_POLL_INTERVAL=2000           # Poll every 2 seconds
WORKER_MAX_RETRIES=3                # Retry failed scenes 3 times

# Remote Browser (Steel)
USE_STEEL=true                      # Use Steel (true) or local Playwright (false)
STEEL_API_KEY=your-steel-api-key
STEEL_WARMUP_MS=1200                # Wait before navigation (Steel only)
STEEL_EMBED_SELECTORS=iframe[src*="calendly.com"],div[data-calendly-inline-widget]
STEEL_EMBED_WAIT_MS=3000            # Wait for embeds to load

# Video Storage (Bunny CDN)
STORAGE_PROVIDER=bunny
BUNNY_STORAGE_ZONE=your-storage-zone-name
BUNNY_STORAGE_API_KEY=your-storage-api-key
BUNNY_CDN_BASE_URL=https://your-pullzone.b-cdn.net

# Optional: CDN Purge
BUNNY_ACCOUNT_API_KEY=your-account-api-key
BUNNY_PULL_ZONE_ID=123456

# Disk Cleanup (NEW)
CLEANUP_ENABLED=true
FAILED_RENDER_RETENTION_DAYS=7
SUCCESS_RENDER_RETENTION_HOURS=1
CLEANUP_MAX_AGE_DAYS=30
```

#### Frontend (vidgen-app/.env.local)

```bash
# Public (client-side)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Private (server-side only)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional: Analytics
NEXT_PUBLIC_GOOGLE_ANALYTICS_ID=GA-XXXXXXXXX
```

---

## Deployment & Infrastructure

### Current Setup (Assumed)

#### Frontend
- **Host**: Vercel (likely)
- **Domain**: TBD
- **Deployment**: Git push auto-deploys
- **Environment**: Production + Preview branches

#### Backend Worker
- **Host**: VPS or dedicated server (not serverless - needs FFmpeg)
- **Requirements**:
  - Node.js 18+
  - FFmpeg installed
  - 50GB+ disk space
  - 4GB+ RAM
  - Stable internet (uploads to CDN)
- **Process Manager**: PM2 (recommended) or systemd
- **Restart Policy**: Auto-restart on crash

#### Database
- **Provider**: Supabase Cloud
- **Plan**: Likely Free or Pro tier
- **Backup**: Supabase handles automatically

#### Storage
- **Provider**: Bunny CDN
- **Storage Zone**: For video files (MP4, JPG)
- **Pull Zone**: For delivery (CDN edge locations)
- **Cost**: ~$0.01/GB storage + $0.01/GB bandwidth

#### Browser Automation
- **Provider**: Steel.dev
- **Plan**: Pay-per-use (minutes of browser time)
- **Cost**: ~$0.XX per minute (check Steel pricing)
- **Alternative**: Local Playwright (free but requires powerful server)

### Running the Worker

#### Development (Local Chromium)

```bash
cd loom-lite
npm install
USE_STEEL=false npm run worker:dev
```

#### Production (Steel Remote Browsers)

```bash
cd loom-lite
npm install

# Option 1: Direct node
USE_STEEL=true npm run worker

# Option 2: PM2 (recommended)
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Enable auto-start on server reboot

# View logs
pm2 logs loom-lite-worker

# Monitor
pm2 monit
```

#### Running Cleanup Cron Job

```bash
# Option 1: System cron
crontab -e
# Add: 0 2 * * * cd /path/to/loom-lite && npm run cleanup >> logs/cleanup.log 2>&1

# Option 2: PM2 cron (recommended)
pm2 start src/scripts/cleanup-old-renders.js \
  --cron "0 2 * * *" \
  --name "cleanup-cron" \
  --no-autorestart
```

### Health Monitoring (NOT YET IMPLEMENTED)

**Planned** (from PRODUCTION_ROADMAP.md):
- HTTP health endpoint at `:3001/health`
- Heartbeat updates every poll cycle
- PM2 process monitoring
- External monitoring (UptimeRobot, Pingdom)

### Scaling Considerations

#### Current Limits

- **Single Worker**: Processes 1 render at a time (sequential)
- **Bottleneck**: Steel browser recording (slowest step)
- **Throughput**: ~20-30 renders per hour (depending on scene complexity)

#### How to Scale

1. **Multiple Workers**
   - Run 2-3 worker instances on same server
   - Each claims jobs independently (atomic locking prevents conflicts)
   - Requires concurrency limit implementation (not yet done)

2. **Vertical Scaling**
   - More CPU cores for FFmpeg processing
   - More RAM for large video files
   - Faster disk for I/O (SSD recommended)

3. **Horizontal Scaling**
   - Multiple servers running workers
   - All connect to same Supabase database
   - Shared job queue (already works with current design)
   - Requires shared storage or CDN-only workflow

---

## Summary: State of the System

### What's Production-Ready ✅

- Core video rendering pipeline (record → process → upload)
- Worker job queue system
- Database schema and RPC functions
- Frontend dashboard and campaign management
- Public video viewer (basic version)
- Authentication and user management
- Widget initialization fix (Calendly, etc.)
- Disk cleanup management (just added)

### What's Needed for Launch 🚧

**Week 1 (Infrastructure)**:
- Cancellation support
- Health checks and monitoring
- Concurrency limits

**Week 2 (Frontend)**:
- Settings page
- Enhanced dashboard (search, filters, bulk actions)
- Polished video landing pages
- Custom subdomain support (for higher tiers)

**Week 3 (Marketing)**:
- Homepage
- Contact page
- Pricing page
- Terms of service / Privacy policy

**Week 4 (Business)**:
- Stripe integration audit and setup
- Subscription management
- Usage limits and enforcement
- Testing and bug fixes

### Current Technical Debt

1. **No cancellation** - Users can't stop renders
2. **No health monitoring** - Worker crashes are silent
3. **No concurrency control** - Could spawn unlimited renders
4. **No usage limits** - Users can render unlimited videos
5. **Manual CSV validation** - No pre-flight checks
6. **No upload retry** - Single failure = entire render fails
7. **Basic error messages** - Too technical for end users
8. **No analytics** - Can't track video views/engagement

### Known Limitations

- Maximum 5 minute total video length (Steel timeout)
- Facecam must exactly match scene duration sum (no tolerance)
- CSV columns must be validated manually
- No offline/queue status when worker is down
- Steel sessions sometimes don't clean up properly
- Local disk fills up without cleanup (mitigated but needs cron setup)

### Recommended Next Steps

Based on PRODUCTION_ROADMAP.md, prioritize:

1. **Week 1: Core Infrastructure**
   - ✅ Widget readiness (done)
   - ✅ Disk cleanup (done)
   - ⏭️ Cancellation support (6-8 hours)
   - ⏭️ Health checks (3-4 hours)
   - ⏭️ Concurrency limits (2-3 hours)

2. **Week 2: Essential Frontend**
   - Settings page
   - Dashboard improvements
   - Video landing page polish

3. **Week 3+**: Marketing pages, billing, launch prep

---

## Appendix: Key Files Reference

### Most Important Files to Understand

1. **`src/worker.js`** (375 lines)
   - Main worker loop
   - Job claiming and processing
   - Error handling and cleanup

2. **`src/pipeline/renderCampaignWithProgress.js`** (220 lines)
   - Orchestrates entire render pipeline
   - Progress callbacks
   - Scene caching logic

3. **`src/recording/recordScene.js`** (721 lines)
   - Browser automation
   - Steel vs local Playwright
   - Widget initialization
   - HME integration

4. **`src/compose/normalizeScene.js`** (54 lines)
   - FFmpeg scene processing
   - Auto-trim white screens
   - Resolution and fps conversion

5. **`src/hme/index.js`** (200+ lines)
   - Human motion engine
   - Scene choreography
   - Beat generation

6. **`vidgen-app/src/app/api/campaigns/[id]/render/route.ts`**
   - Creates render jobs
   - Handles CSV/facecam uploads
   - Triggers worker processing

7. **`vidgen-app/src/components/CampaignWizard.tsx`**
   - Campaign creation flow
   - Scene configuration UI
   - CSV column mapping

---

**End of System Overview**

Last updated: 2025-10-31
For production roadmap, see: `PRODUCTION_ROADMAP.md`
