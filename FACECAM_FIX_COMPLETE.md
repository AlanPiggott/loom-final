# ✅ Facecam Upload Fix Complete!

## What Was Wrong

When you created a campaign with a facecam video:
1. **UI collected the facecam** - The video file was stored in browser memory
2. **But never uploaded it** - The API only received `{ name, scenes }`, NO facecam file
3. **Worker expected facecam_url** - But database had NULL because facecam was never saved

## What We Fixed

### 1. **API Route Enhancement** (`vidgen-app/src/app/api/campaigns/route.ts`)
- Now accepts both JSON and FormData (multipart)
- When FormData is received, extracts the facecam file
- Uploads facecam to Supabase Storage
- Stores the public URL in `campaigns.facecam_url`

### 2. **Frontend Update** (`vidgen-app/src/components/CampaignWizard.tsx`)
- Detects when user has uploaded a facecam
- Sends FormData instead of JSON when facecam exists
- Includes both campaign data and facecam file

### 3. **Storage Integration** (`vidgen-app/src/lib/supabase/storage.ts`)
- New utility for uploading files to Supabase Storage
- Auto-creates `facecams` bucket if it doesn't exist
- Returns public URLs for worker to download

### 4. **Worker Improvements** (`loom-lite/src/worker.js`)
- Handles missing facecams gracefully
- Falls back to local storage if Supabase Storage isn't configured
- Continues processing even without facecam

## How to Test

### 1. Create Storage Bucket (if not exists)
Go to Supabase Dashboard → Storage:
1. Create bucket: `facecams`
2. Set to **Public** access

### 2. Test Campaign Creation
1. Start both apps:
   ```bash
   # Terminal 1 - vidgen-app
   cd vidgen-app && pnpm dev

   # Terminal 2 - loom-lite Express
   cd loom-lite && npm run dev

   # Terminal 3 - loom-lite worker
   cd loom-lite && npm run worker
   ```

2. Create a new campaign with facecam:
   - Upload a video file in Step 1
   - Add URLs in Step 2
   - Click "Create Campaign"

3. Check the results:
   - Campaign should be created
   - Check Supabase → Storage → facecams bucket - video should be there
   - Check campaigns table - `facecam_url` should be populated

4. Click "Render":
   - Worker should pick up the job
   - Download facecam from URL
   - Process the video with facecam overlay

## Database Schema Complete

Your tables now have all required columns:
- ✅ `campaigns.facecam_url` - Stores Supabase Storage URL
- ✅ `render_jobs.updated_at`, `started_at`, etc.
- ✅ `renders.updated_at`, `error_message`, etc.

## What Happens Now

### When Creating a Campaign:
```
User uploads facecam → FormData → API → Supabase Storage → URL in DB
```

### When Rendering:
```
Worker claims job → Gets facecam_url → Downloads video → Overlays on recording
```

## Success Indicators

You'll know it's working when:
1. **Campaign creation**: Console shows `[POST /api/campaigns] Facecam uploaded: https://...`
2. **Worker processing**: Shows `[worker] Downloading facecam from: https://...`
3. **Final video**: Has the picture-in-picture overlay

## Troubleshooting

### If facecam upload fails:
- Check Supabase Storage is enabled in your project
- Verify you're using the correct Supabase credentials
- Check browser console for upload errors

### If worker can't download facecam:
- Ensure the facecams bucket is set to Public
- Check the URL is accessible in a browser
- Verify worker has internet access

### Fallback behavior:
- If no facecam is uploaded, videos render without overlay
- If Storage fails, files are served locally via Express

## The Complete Flow

1. **User uploads facecam** → Stored as File object in browser
2. **User creates campaign** → FormData sent with video file
3. **API uploads to Storage** → Returns public URL
4. **URL saved in database** → campaigns.facecam_url column
5. **Worker claims job** → Reads facecam_url from database
6. **Worker downloads video** → From Supabase Storage URL
7. **Pipeline processes** → Overlays facecam on recording
8. **Final video uploaded** → Complete with facecam!