# VidGen-App + Loom-Lite Setup

## Architecture

This project uses a **dual-server architecture**:

1. **vidgen-app** (port 3000) - Next.js frontend with dashboard and wizard
2. **loom-lite** (port 3100) - Express backend for video rendering

The wizard UI in vidgen-app sends rendering requests to loom-lite server.

## Running Both Servers

### Terminal 1: Start loom-lite (rendering engine)

```bash
cd loom-lite
npm start
```

You should see:
```
✓ SERVER READY
  UI:           http://localhost:3100
  Render API:   http://localhost:3100/api/render
```

### Terminal 2: Start vidgen-app (dashboard UI)

```bash
cd vidgen-app
pnpm dev
```

You should see:
```
✓ Ready in XXXms
  Local:   http://localhost:3000
```

## Using the Dashboard

1. Navigate to `http://localhost:3000/dashboard`
2. Click "New Campaign" button
3. Fill out the wizard:
   - **Step 1**: Upload webcam video (MP4) and optionally a CSV
   - **Step 2**: Configure target websites and durations
   - **Step 3**: Review and launch
4. Click "Launch Campaign"

The wizard will:
1. Send the video + config to vidgen-app's `/api/render` endpoint
2. vidgen-app proxies the request to loom-lite on port 3100
3. loom-lite renders the video and returns the URL
4. The wizard displays the result

## Troubleshooting

### "All videos failed to render"

**Cause**: Loom-lite server is not running

**Solution**:
```bash
cd loom-lite
npm start
```

Make sure you see "SERVER READY" before trying to render.

### "Cannot connect to loom-lite server"

**Cause**: Port 3100 is blocked or loom-lite crashed

**Solution**:
1. Check if loom-lite is running: `curl http://localhost:3100/api/health`
2. Should return: `{"ok":true}`
3. If not, restart loom-lite

### Videos render but URLs are broken

**Cause**: URL transformation issue in proxy

**Solution**: Check the proxy logs in vidgen-app terminal. URLs should be transformed to include `http://localhost:3100` prefix.

## Environment Variables

### vidgen-app (.env.local)

```env
# Supabase (required for auth)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Loom-lite backend (optional, defaults to localhost:3100)
LOOM_LITE_URL=http://localhost:3100
```

### loom-lite (.env)

```env
# Port (optional, defaults to 3100)
PORT=3100
```

## File Structure

```
vidgen-app/
├── src/app/
│   ├── (app)/dashboard/page.tsx    # Dashboard page (EXACT copy from loom-lite)
│   └── api/
│       └── render/route.ts         # Proxy to loom-lite
├── src/components/
│   └── CampaignWizard.tsx          # Campaign wizard (EXACT copy from loom-lite)
└── src/app/globals.css             # Styles (copied from loom-lite)

loom-lite/
├── src/
│   ├── server.js                   # Express server with /api/render
│   ├── pipeline/renderCampaign.js  # Video rendering logic
│   └── public/index.html           # Original dashboard (reference)
└── campaigns/                      # Rendered videos stored here
```

## Development Workflow

1. Make UI changes in `vidgen-app/src/app/(app)/dashboard/page.tsx`
2. Make wizard changes in `vidgen-app/src/components/CampaignWizard.tsx`
3. Make rendering logic changes in `loom-lite/src/pipeline/`
4. Both servers auto-reload on file changes

## Production Deployment

For production, you'll need to:

1. Deploy vidgen-app to Vercel/Netlify (static frontend)
2. Deploy loom-lite to a VPS/cloud server (needs FFmpeg, Playwright)
3. Update `LOOM_LITE_URL` in vidgen-app to point to production loom-lite URL
4. Ensure loom-lite is accessible from vidgen-app (CORS, networking)

## Notes

- The dashboard and wizard in vidgen-app are **exact copies** from loom-lite
- All visual design, animations, and logic are identical
- Only difference: vidgen-app uses React/Next.js instead of vanilla HTML/JS
