# Duration Validation Bug Fix

## The Bug That Was Fixed

### Root Cause: Race Condition in Duration Extraction

When you uploaded a facecam video and quickly clicked "Create Campaign", the validation was bypassed due to:

1. **Asynchronous Duration Extraction**: Video duration was extracted in `onloadedmetadata` callback (takes 100-500ms)
2. **Flawed Validation Condition**: Only validated when `facecamDurationSec > 0`, not when a video was uploaded
3. **Result**: If you clicked submit before duration was extracted, validation was completely skipped

### How It Failed:
```
User uploads 111s video → Clicks "Create Campaign" quickly → facecamDurationSec still 0 → Validation skipped → Campaign created with 30s scenes + 111s facecam → Worker detects mismatch and fails
```

## The Fix Applied

### 1. Added Loading State
- New state: `isExtractingDuration`
- Set to `true` when video upload starts
- Set to `false` when duration is extracted or fails
- UI shows "Loading..." while extracting

### 2. Fixed Validation Logic
**Before (buggy):**
```typescript
if (facecamDurationSec > 0 && !hasCsvRows) {
  // Only validated if duration was extracted
}
```

**After (fixed):**
```typescript
if (uploadedVideo && !hasCsvRows) {
  // Always validate when video is uploaded
  if (facecamDurationSec === 0) {
    alert('Failed to extract duration...');
    return;
  }
  // Validate duration matching
}
```

### 3. Prevents Submission While Loading
- Checks `isExtractingDuration` before allowing submission
- Shows "Please wait while video duration is being extracted..."
- Launch button disabled and shows "Extracting Duration..."

### 4. Error Handling
- Added `onerror` handler for video metadata extraction
- Shows alert if duration extraction fails
- Forces user to re-upload if extraction fails

## Testing the Fix

1. **Upload a facecam video**
   - You'll see "Loading..." next to Facecam duration
   - Launch button shows "Extracting Duration..." and is disabled

2. **Try to submit quickly**
   - Now blocked with "Please wait while video duration is being extracted..."

3. **After duration loads**
   - Shows actual duration (e.g., "111s")
   - If scenes don't match, shows proper error
   - Forces you to fix duration mismatch before proceeding

4. **Worker validation**
   - Now only receives properly validated campaigns
   - No more duration mismatches getting through

## What Changed

### CampaignWizard.tsx:
1. Added `isExtractingDuration` state
2. Updated `handleVideoUpload` to set loading state
3. Added error handler for metadata extraction
4. Changed validation from `facecamDurationSec > 0` to `uploadedVideo !== null`
5. Added loading check in `handleLaunch`
6. Updated UI to show loading state
7. Disabled Launch button while extracting

### API route.ts:
1. Added basic validation to ensure scenes exist when facecam is provided

## Why This Works

The fix ensures:
- ✅ Duration MUST be extracted before submission (no race condition)
- ✅ Validation ALWAYS happens when video is uploaded (not conditional on duration)
- ✅ User gets clear feedback while duration is loading
- ✅ Submission is blocked until duration is ready
- ✅ Failed extractions are handled gracefully

## Result

No more campaigns with mismatched durations can be created. The validation now happens reliably on the frontend, preventing bad data from reaching the worker.