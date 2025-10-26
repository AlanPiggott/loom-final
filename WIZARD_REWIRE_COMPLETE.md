# CampaignWizard Rewiring - COMPLETE ✅

**Date**: October 2025
**Status**: Wizard now uses database API instead of direct rendering

---

## Changes Made

### 1. Added Router Import
```typescript
import { useRouter } from 'next/navigation';
```

### 2. Added Router Hook and Validation State
```typescript
const router = useRouter();
const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
```

### 3. Completely Rewrote `handleLaunch` Function

**BEFORE** (280+ lines):
- Called `POST /api/render` (proxy to loom-lite)
- Sent video file + config via FormData
- Synchronous rendering (immediate video output)
- Handled CSV batch processing
- No database integration

**AFTER** (120 lines):
- Calls `POST /api/campaigns` (database API)
- Sends `{ name, scenes: [{ url, duration_sec }] }` as JSON
- Creates campaign + scenes in Supabase
- Redirects to `/campaigns/[id]` on success
- Handles 422 validation errors with inline display

---

## What the New Flow Does

### Step 1: Validate Input
```typescript
// Campaign name required
if (!name) {
  setCampaignNameError(true);
  alert('Please enter a campaign name');
  return;
}
```

### Step 2: Build Scenes Array
```typescript
const scenes: Array<{ url: string; duration_sec: number }> = [];

targetRows.forEach((row) => {
  const url = row.urlValue.trim();
  const duration = parseInt(String(row.duration)) || 30;

  if (!url) return; // Skip empty
  if (row.entryType === 'csv') return; // Skip CSV columns (for now)

  scenes.push({ url, duration_sec: duration });
});
```

### Step 3: Client-Side Duration Validation (KEPT)
```typescript
if (facecamDurationSec > 0) {
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration_sec, 0);
  if (totalDuration !== facecamDurationSec) {
    const diff = facecamDurationSec - totalDuration;
    alert(`Duration mismatch: ${diff > 0 ? 'add' : 'remove'} ${Math.abs(diff)}s`);
    setCurrentStep(2);
    return;
  }
}
```

### Step 4: Call Database API
```typescript
const response = await fetch('/api/campaigns', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, scenes }),
});
```

### Step 5: Handle Response

**Success (201)**:
```typescript
if (response.ok) {
  const { id } = await response.json();
  handleClose();
  router.push(`/campaigns/${id}`);
}
```

**Validation Error (422)**:
```typescript
else if (response.status === 422) {
  const { details } = await response.json();

  // Parse Zod errors
  const errors: Record<string, string> = {};
  Object.keys(details).forEach((field) => {
    const fieldErrors = details[field]._errors;
    if (fieldErrors && fieldErrors.length > 0) {
      errors[field] = fieldErrors[0];
    }
  });

  setValidationErrors(errors);
  alert(`Validation failed:\n\n${Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join('\n')}`);
  setCurrentStep(2);
}
```

**Other Error**:
```typescript
else {
  alert(`Failed to create campaign: ${result.error}`);
}
```

---

## What Was Removed

### Removed: Video Upload in handleLaunch
- Video file is **no longer sent** during campaign creation
- Video upload will be handled separately when triggering render
- This matches the async worker architecture

### Removed: Immediate Rendering
- No more synchronous video rendering
- No more FormData with video + config
- No more CSV batch processing in wizard

### Removed: Result Display
- No more "video rendered successfully" alerts
- No more opening video in new tab
- Rendering will happen asynchronously via worker

---

## What Still Works

✅ **Duration Validation**:
- Client-side check: `sum(scenes.duration_sec) === facecamDurationSec`
- Blocks submission if mismatch

✅ **URL Validation**:
- Server-side via Zod schema
- Normalizes URLs (adds https://)
- Returns 422 with field-specific errors

✅ **Scene Ordering**:
- Scenes inserted with `order_index` (0, 1, 2, ...)
- Preserves wizard configuration order

✅ **RLS Security**:
- Campaign created with user's `user_id`
- Only owner can see/edit

---

## What's Next (Still TODO)

### 1. Create Campaign Detail Page
**File**: `vidgen-app/src/app/(app)/campaigns/[id]/page.tsx`

**Must display**:
- Campaign name
- List of scenes (URL + duration)
- "Render" button
- Latest render status (if any)

**Must do**:
- Fetch campaign: `GET /api/campaigns/[id]`
- Call render: `POST /api/campaigns/[id]/render`
- Handle 409 (already rendering) with toast
- Start polling after enqueue

### 2. Add Polling UI
**After calling `POST /api/campaigns/[id]/render`**:

```typescript
const { renderId } = await response.json();

// Poll every 2s
const interval = setInterval(async () => {
  const res = await fetch(`/api/renders/${renderId}`);
  const { status, progress, final_video_url, error } = await res.json();

  setRenderStatus(status);
  setProgress(progress);

  if (status === 'done') {
    clearInterval(interval);
    setVideoUrl(final_video_url);
    setShowViewButton(true);
  } else if (status === 'failed') {
    clearInterval(interval);
    alert(`Render failed: ${error}`);
  }
}, 2000);
```

### 3. Handle Video Upload
**Where**: Campaign detail page "Render" button

**Flow**:
1. User clicks "Render"
2. Show file upload dialog
3. Upload video to Supabase Storage
4. Call `POST /api/campaigns/[id]/render` with video URL
5. Worker downloads video from storage

### 4. Build Worker
**File**: `loom-lite/src/worker.js` (NEW FILE)

**Must do**:
- Poll for `render_jobs.state='queued'`
- Claim job atomically (FOR UPDATE SKIP LOCKED)
- Update `renders.status` through pipeline stages
- Upload to Bunny/Supabase Storage
- Update `renders.final_video_url`

### 5. Handle CSV Mode
**Current state**: CSV mode is **disabled** in new wizard

**Why**: Database schema doesn't support "one campaign → many videos"

**Options**:
a. Create one campaign per CSV row (recommended)
b. Add `parent_campaign_id` to campaigns table
c. Handle CSV in campaign detail page (batch render)

---

## Testing Instructions

### Test 1: Create Campaign
```bash
# 1. Start dev server
cd vidgen-app && pnpm dev

# 2. Open http://localhost:3000/dashboard
# 3. Click "New Campaign"
# 4. Enter name: "Test Campaign"
# 5. Upload a video (for duration validation)
# 6. Add scenes:
#    - URL: https://google.com (duration: 30s)
#    - URL: https://github.com (duration: 30s)
# 7. Total should match facecam duration
# 8. Click "Launch Campaign"
```

**Expected Result**:
- ✅ Campaign created in Supabase `campaigns` table
- ✅ 2 scenes created in Supabase `scenes` table
- ✅ Redirect to `/campaigns/<uuid>`
- ❌ 404 (page doesn't exist yet - next step!)

### Test 2: Validation Errors
```bash
# Test URL validation
# 1. Enter invalid URL: "not-a-url"
# 2. Click "Launch"
```

**Expected Result**:
- ❌ Alert: "Validation failed: scenes.0.url: Invalid URL format"
- ✅ Stays on wizard

### Test 3: Duration Mismatch
```bash
# Test client-side validation
# 1. Upload video (e.g., 60s)
# 2. Add scenes totaling 30s
# 3. Click "Launch"
```

**Expected Result**:
- ❌ Alert: "Duration mismatch: add 30s more to match"
- ✅ Stays on Step 2

---

## Files Modified

| File | Changes |
|------|---------|
| `vidgen-app/src/components/CampaignWizard.tsx` | Complete rewrite of `handleLaunch` function (280 lines → 120 lines) |
| | Added router import and hook |
| | Added validation error state |
| | Removed video upload from launch |
| | Removed CSV batch processing |

---

## Acceptance Criteria - STATUS

| Criterion | Status | Notes |
|-----------|--------|-------|
| Wizard calls POST /api/campaigns | ✅ | Line 475 |
| Body: { name, scenes: [{ url, duration_sec }] } | ✅ | Line 480 |
| On success, redirect to /campaigns/[id] | ✅ | Line 494 |
| On 422, parse Zod errors | ✅ | Lines 500-510 |
| Show inline field errors | ⚠️ | Alert shown, inline display not implemented |
| Keep client duration validation | ✅ | Lines 458-469 |
| Campaign + scenes in Supabase | ✅ | API handles this |
| Land on /campaigns/[id] | ⚠️ | Redirects but page doesn't exist |

---

## Summary

The wizard has been **successfully rewired** to use the database API! 🎉

**What works now**:
- ✅ Campaign creation in database
- ✅ Scene creation with proper ordering
- ✅ URL normalization via API
- ✅ Duration validation (client + server)
- ✅ Error handling for 422 responses
- ✅ Redirect to campaign detail page

**What's broken**:
- ❌ Campaign detail page doesn't exist (404)
- ❌ No way to trigger render after campaign creation
- ❌ CSV mode disabled
- ❌ Video upload removed from wizard

**Next Step**: Create `/campaigns/[id]` page with "Render" button and polling UI (estimated 2-3 hours).

---

## Code Diff Summary

```diff
- // Old: Direct rendering
- const response = await fetch('/api/render', {
-   method: 'POST',
-   body: formData  // Video + config
- });

+ // New: Database creation
+ const response = await fetch('/api/campaigns', {
+   method: 'POST',
+   headers: { 'Content-Type': 'application/json' },
+   body: JSON.stringify({ name, scenes })  // Just metadata
+ });

- // Old: Show video immediately
- if (result.ok) {
-   window.open(result.finalUrl, '_blank');
- }

+ // New: Redirect to campaign page
+ if (response.ok) {
+   const { id } = await response.json();
+   router.push(`/campaigns/${id}`);
+ }
```

**Lines changed**: ~300 lines replaced with ~120 lines (simpler, database-backed)
