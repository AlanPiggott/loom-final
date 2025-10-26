# Create Test Facecam for Worker Testing

Since the campaigns don't have facecam URLs yet, the worker needs a test facecam video to work with.

## Option 1: Create a Test Video with FFmpeg

```bash
# Create a 30-second test facecam video (solid color with timestamp)
ffmpeg -f lavfi -i color=c=blue:s=320x240:d=30 \
  -vf "drawtext=fontsize=30:fontcolor=white:text='Test Facecam':x=(w-text_w)/2:y=(h-text_h)/2" \
  test-facecam.mp4
```

## Option 2: Use Any Existing Video

Find any MP4 video file and copy it to:
```
loom-lite/campaigns/test-facecam.mp4
```

## Option 3: Upload to Supabase Storage

1. Go to Supabase Dashboard > Storage
2. Create a bucket called `facecams` (if it doesn't exist)
3. Upload any MP4 file
4. Get the public URL
5. Update your campaign in the database:
   ```sql
   UPDATE campaigns
   SET facecam_url = 'https://your-project.supabase.co/storage/v1/object/public/facecams/test.mp4'
   WHERE id = 'your-campaign-id';
   ```

## Option 4: Run Without Facecam (Already Supported)

The worker is now configured to handle missing facecams gracefully. It will render videos without the facecam overlay if none is provided.

The videos will still be rendered successfully, just without the picture-in-picture overlay.