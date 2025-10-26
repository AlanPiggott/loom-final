# Loom-Lite Background Worker Setup

This guide explains how to set up and run the background worker that processes video rendering jobs from Supabase.

## Prerequisites

1. **Supabase Project**: You need a Supabase project with the proper database schema
2. **Node.js**: Version 16 or higher
3. **FFmpeg**: Installed and accessible in PATH (required for video processing)

## Setup Instructions

### 1. Database Migration

First, create the `claim_render_job()` function in your Supabase database:

1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Navigate to **SQL Editor**
3. Create a new query
4. Copy the contents of `migrations/claim_render_job.sql`
5. Run the query

This creates a PostgreSQL function that atomically claims render jobs for processing.

### 2. Create Storage Buckets

In your Supabase dashboard:

1. Go to **Storage**
2. Create two new buckets:
   - `videos` - For storing final rendered videos
   - `thumbnails` - For storing video thumbnails
3. Set both buckets to **Public** if you want direct URL access
   - Or keep them private and use signed URLs (requires additional code changes)

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
# Get these from Supabase Dashboard > Settings > API
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJ...  # Service role key (NOT anon key!)

# Optional: Adjust these as needed
PORT=3100
WORKER_POLL_INTERVAL=2000
WORKER_MAX_RETRIES=3
STORAGE_BUCKET_VIDEOS=videos
STORAGE_BUCKET_THUMBNAILS=thumbnails
```

**⚠️ IMPORTANT**: Use the **Service Role Key**, not the Anon Key. The service role key bypasses Row Level Security (RLS) and is needed for the worker to access all data.

### 4. Install Dependencies

```bash
npm install
```

### 5. Test the Worker

First, ensure your Express server is running (for serving files):

```bash
npm run dev  # In one terminal
```

Then run the worker:

```bash
npm run worker  # In another terminal
```

You should see:

```
============================================================
Loom-Lite Background Worker
============================================================
Environment: development
Supabase URL: https://your-project-id.supabase.co
Poll Interval: 2000ms
============================================================

[worker] Worker started - polling every 2000ms
....
```

The dots indicate the worker is polling for jobs.

## Running the Worker

### Development Mode

Use nodemon for auto-restart on code changes:

```bash
npm run worker:dev
```

### Production Mode

#### Option 1: Direct Node

```bash
npm run worker
```

#### Option 2: PM2 (Recommended for Production)

First, install PM2 globally:

```bash
npm install -g pm2
```

Then start the worker:

```bash
npm run worker:pm2
# OR
pm2 start src/worker.js --name loom-worker
```

PM2 commands:
```bash
pm2 status          # Check worker status
pm2 logs loom-worker  # View logs
pm2 restart loom-worker  # Restart worker
pm2 stop loom-worker  # Stop worker
pm2 delete loom-worker  # Remove from PM2
```

#### Option 3: SystemD Service (Linux)

Create `/etc/systemd/system/loom-worker.service`:

```ini
[Unit]
Description=Loom-Lite Background Worker
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/loom-lite
ExecStart=/usr/bin/node /path/to/loom-lite/src/worker.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable loom-worker
sudo systemctl start loom-worker
```

## Testing the Full Pipeline

1. **Create a campaign** in the vidgen-app UI
2. **Click "Render"** to queue a job
3. **Watch the worker logs** to see it process the job
4. **Check Supabase dashboard** to see status updates
5. **Verify outputs** in Storage buckets

## Workflow Overview

```
vidgen-app (Next.js)          Supabase              loom-lite (Worker)
     |                            |                         |
     |-- Create Render Job -----> |                         |
     |                            |                         |
     |                            | <-- Poll for Jobs -------|
     |                            |                         |
     |                            |-- Return Job ----------> |
     |                            |                         |
     |                            | <-- Update Progress ----| (recording)
     |                            |                         |
     |                            | <-- Update Progress ----| (normalizing)
     |                            |                         |
     |                            | <-- Update Progress ----| (concatenating)
     |                            |                         |
     |                            | <-- Update Progress ----| (overlaying)
     |                            |                         |
     |                            | <-- Upload Files -------| (to Storage)
     |                            |                         |
     |                            | <-- Mark Complete ------|
     |                            |                         |
     | <-- Poll for Status -------|                         |
     |                            |                         |
     | <-- Return Complete -------|                         |
```

## Database Schema Requirements

The worker expects these tables in Supabase:

### campaigns
- `id` (uuid, primary key)
- `name` (text)
- `user_id` (uuid, references auth.users)
- `facecam_url` (text, optional)
- `output_width` (int, optional, default 1920)
- `output_height` (int, optional, default 1080)
- `output_fps` (int, optional, default 60)

### scenes
- `id` (uuid, primary key)
- `campaign_id` (uuid, references campaigns)
- `url` (text)
- `duration_sec` (int)
- `order_index` (int)

### renders
- `id` (uuid, primary key)
- `campaign_id` (uuid, references campaigns)
- `status` (text) - 'queued', 'recording', 'normalizing', 'concatenating', 'overlaying', 'uploading', 'done', 'failed'
- `progress` (int) - 0 to 100
- `final_video_url` (text, nullable)
- `thumb_url` (text, nullable)
- `error_message` (text, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `completed_at` (timestamp, nullable)

### render_jobs
- `id` (uuid, primary key)
- `render_id` (uuid, references renders)
- `state` (text) - 'queued', 'running', 'completed', 'failed'
- `started_at` (timestamp, nullable)
- `completed_at` (timestamp, nullable)
- `error_message` (text, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## Monitoring

### Check Worker Health

The worker logs all activity to console. Monitor for:
- Job claiming: `[worker] Processing job: <job-id>`
- Progress updates: `[supabase] Render <id>: recording (20%)`
- Completions: `[worker] ✓ Job <id> completed successfully`
- Errors: `[worker] ❌ Job <id> failed:`

### Supabase Dashboard

Monitor in real-time:
1. **Database > render_jobs**: See job queue and states
2. **Database > renders**: See render progress and status
3. **Storage**: Check uploaded videos and thumbnails
4. **Logs**: View Postgres function logs

### Error Recovery

The worker is designed to be resilient:
- **Automatic retries**: Failed scene recordings retry up to 3 times
- **Graceful shutdown**: SIGTERM/SIGINT signals handled properly
- **Job safety**: Uses `FOR UPDATE SKIP LOCKED` to prevent duplicate processing
- **Continuous operation**: Errors in one job don't crash the worker

## Troubleshooting

### Worker doesn't claim jobs
- Check `.env` has correct Supabase credentials
- Verify the SQL function was created successfully
- Check render_jobs table has entries with `state = 'queued'`
- Look for error messages in worker console output

### Upload fails
- Verify storage buckets exist in Supabase
- Check bucket names match `.env` configuration
- Ensure service role key has storage permissions

### Video rendering fails
- Check FFmpeg is installed: `ffmpeg -version`
- Verify facecam files are accessible
- Check scene URLs are valid and reachable
- Look for detailed error messages in worker logs

### Worker crashes
- Check Node.js version: `node --version` (should be 16+)
- Review error logs for missing dependencies
- Ensure sufficient disk space for video processing
- Check memory usage during rendering

## Performance Tuning

### Adjust Poll Interval
```env
WORKER_POLL_INTERVAL=5000  # Check less frequently (5 seconds)
```

### Run Multiple Workers
```bash
# Terminal 1
WORKER_ID=1 npm run worker

# Terminal 2
WORKER_ID=2 npm run worker
```

The `FOR UPDATE SKIP LOCKED` ensures workers don't process the same job.

### Optimize Video Processing
- Use lower resolution for faster processing
- Adjust FPS in campaign settings
- Enable scene caching (already implemented)
- Use SSD for campaigns directory

## Security Notes

1. **Never commit `.env`** - It contains sensitive credentials
2. **Service role key** - Keep secure, it bypasses all RLS
3. **Storage buckets** - Configure appropriate access rules
4. **Worker access** - Run on secure, isolated server in production

## Next Steps

1. Set up monitoring/alerting for failed jobs
2. Implement job retry logic for transient failures
3. Add webhook notifications for job completion
4. Create admin dashboard for job management
5. Implement job priority queue
6. Add video quality presets