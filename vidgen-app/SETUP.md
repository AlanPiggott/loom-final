# VidGen Setup Guide

## What's Done

✅ Next.js app created with TypeScript, Tailwind, and ESLint
✅ Supabase dependencies installed
✅ API routes copied (campaigns, renders)
✅ Login page created
✅ URL utility created
✅ .env.local template created

## Next Steps

### 1. Configure Supabase

Edit `.env.local` and replace with your actual Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
NEXT_PUBLIC_SITE_URL=http://localhost:3100
```

Get these from: **Supabase Dashboard → Project Settings → API**

### 2. Update Supabase Auth Redirects

In Supabase Dashboard:
1. Go to **Auth → URL Configuration**
2. Add to **Redirect URLs**: `http://localhost:3100`

### 3. Ensure Database Schema Exists

Make sure your Supabase database has these tables with RLS enabled:
- `campaigns` (id, user_id, name, created_at)
- `scenes` (id, campaign_id, url, duration_sec, order_index)
- `renders` (id, campaign_id, status, progress, public_id, final_video_url, thumb_url, error, duration_sec, created_at)
- `render_jobs` (id, render_id, state, created_at)

### 4. Run the Dev Server

```bash
cd vidgen-app
pnpm dev
```

This will start the Next.js app on **http://localhost:3000** (default).

### 5. Test the Login

Visit `http://localhost:3000/login` to test Supabase auth.

## Architecture

- **vidgen-app** (Next.js) - UI + API endpoints for campaign/render management
- **loom-lite** (Express) - Video rendering pipeline worker

The Next.js app handles user-facing UI and API, while the Express server handles the actual video recording/rendering work.

## API Endpoints Available

- `POST /api/campaigns` - Create campaign with scenes
- `GET /api/campaigns` - List user's campaigns
- `GET /api/campaigns/[id]` - Get campaign details
- `POST /api/campaigns/[id]/render` - Trigger render (with duplicate guard)
- `GET /api/renders/[id]` - Poll render status

All endpoints include:
- Supabase auth guards
- RLS-based ownership checks
- Zod validation
- Proper error handling (401, 404, 409, 422, 500)
