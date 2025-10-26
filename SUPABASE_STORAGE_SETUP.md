# Supabase Storage Setup

## Required Storage Buckets

Before using the app, you must manually create the following storage buckets in your Supabase Dashboard:

### 1. Create Buckets

Go to **Supabase Dashboard** → **Storage** → **New bucket** and create:

| Bucket Name | Public Access | Purpose |
|------------|--------------|---------|
| `facecams` | ✅ ON | Stores uploaded facecam videos |
| `videos` | ✅ ON | Stores final rendered videos |
| `thumbnails` | ✅ ON | Stores video thumbnails |

### 2. Important Settings

- **Public Access**: Must be ON for all buckets
- **File size limits**: Ensure large enough for videos (default is usually fine)
- **Allowed MIME types**: Should include `video/*` and `image/*`

### 3. Verify Setup

After creating, you should see all three buckets listed in Storage.

Test URLs should work:
- `https://[your-project].supabase.co/storage/v1/object/public/facecams/test.mp4`
- `https://[your-project].supabase.co/storage/v1/object/public/videos/test.mp4`
- `https://[your-project].supabase.co/storage/v1/object/public/thumbnails/test.jpg`

## Why Manual Creation?

Storage buckets cannot be created programmatically from client-side code due to security restrictions. They must be created by an admin in the dashboard.

## Troubleshooting

### "Failed to upload" error
- Verify bucket exists with exact name
- Check bucket is set to public
- Ensure you're authenticated

### "new row violates row-level security policy"
- This means code is trying to create a bucket
- Buckets must be created manually in dashboard
- Check that all three buckets exist

### Files upload but URLs don't work
- Verify buckets are set to PUBLIC
- Check Supabase project is not paused
- Ensure storage quotas aren't exceeded