# Fix Storage RLS Upload Permissions

The error "new row violates row-level security policy" means your storage bucket has RLS enabled but no policies allowing uploads.

## Quick Fix: Disable RLS (Easiest)

1. Go to **Supabase Dashboard** → **Storage**
2. Click on the `facecams` bucket
3. Click **Policies** tab
4. Toggle **"Enable Row Level Security"** to **OFF**
5. Confirm the change

This allows anyone authenticated to upload files (which is what you want for your app).

## Alternative: Add RLS Policies (More Secure)

If you want to keep RLS enabled, add these policies:

### 1. Go to Storage → facecams → Policies

### 2. Create INSERT Policy (Upload)
- **Name**: `Allow authenticated uploads`
- **Policy**: `INSERT`
- **Target roles**: `authenticated`
- **WITH CHECK expression**: `true`
- Click **Save**

### 3. Create SELECT Policy (Download/View)
- **Name**: `Allow public downloads`
- **Policy**: `SELECT`
- **Target roles**: `anon, authenticated`
- **USING expression**: `true`
- Click **Save**

### 4. Optional: UPDATE Policy (Replace files)
- **Name**: `Allow authenticated updates`
- **Policy**: `UPDATE`
- **Target roles**: `authenticated`
- **USING expression**: `true`
- **WITH CHECK expression**: `true`
- Click **Save**

### 5. Optional: DELETE Policy
- **Name**: `Allow authenticated deletes`
- **Policy**: `DELETE`
- **Target roles**: `authenticated`
- **USING expression**: `true`
- Click **Save**

## Apply to All Buckets

Repeat for these buckets:
- `facecams` ✅ (you're fixing this now)
- `videos` (for worker uploads)
- `thumbnails` (for worker uploads)

## Test After Fixing

1. **Restart your vidgen-app** (Ctrl+C and `pnpm dev`)
2. Create a new campaign with facecam
3. Should see: `[uploadFacecam] Successfully uploaded:` in console
4. Check Supabase Storage - file should be there

## Why This Happens

Supabase Storage uses two types of access control:
1. **Public/Private bucket**: Controls if files can be accessed via public URLs
2. **RLS Policies**: Controls who can upload/modify files

A "Public" bucket only means files can be read publicly - it doesn't mean anyone can upload! You still need policies for write operations.

## Recommended Setup

For your use case:
- **Bucket**: Public (for URL access)
- **RLS**: Either OFF or with INSERT policy for authenticated users

This allows:
- ✅ Your app to upload files (authenticated)
- ✅ Worker to download via public URLs
- ✅ Users to view videos via public URLs