# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**VidGen** is a two-application system for creating personalized video campaigns:

- **vidgen-app** (this repo): Next.js frontend + API for campaign management
- **loom-lite** (sibling repo): Express app that handles video recording/rendering using Puppeteer and FFmpeg

This Next.js app runs on **port 3000** and provides the user interface and database-backed API. The Express app runs on **port 3100** and processes video rendering jobs.

## Development Commands

```bash
# Start development server (port 3000)
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Run linter
pnpm lint
```

**Package Manager:** Always use `pnpm` (not npm or yarn). The project is configured with pnpm@10.12.1.

## Environment Configuration

Required environment variables in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Important:** The `NEXT_PUBLIC_` prefix makes variables available in the browser, required for client-side Supabase auth.

## Architecture

### Two-App Architecture

**vidgen-app (Next.js - this repo):**
- User authentication (Supabase magic link)
- Campaign/scene/render management API
- User interface (React components)
- Database queries with RLS

**loom-lite (Express - separate repo):**
- Video recording with Puppeteer/Playwright
- Video processing with FFmpeg
- Worker process that consumes render jobs

### Database Schema (Supabase PostgreSQL)

**campaigns**
- Stores user-created campaigns
- RLS: `user_id` must match authenticated user

**scenes**
- Multiple scenes per campaign (ordered by `order_index`)
- Each scene = URL + duration_sec

**renders**
- Execution instances of campaigns
- Multiple renders can exist per campaign (for re-rendering)
- Status: 'queued' → 'recording' → 'normalizing' → 'completed'/'failed'
- Contains `public_id` (nanoid) for sharing

**render_jobs**
- Queue for worker process to consume
- Links to `renders` table

### API Architecture

All API routes follow this pattern:

1. **Auth Guard**: Verify user session with `createRouteHandlerClient({ cookies })`
2. **Ownership Verification**: Use RLS or explicit joins to ensure user owns resource
3. **Validation**: Zod schemas for all POST/PUT payloads
4. **Error Handling**: Return proper HTTP status codes

#### API Endpoints

**POST /api/campaigns**
- Creates campaign + scenes in single transaction
- Bulk inserts scenes with `order_index`
- Validates total duration ≤ 300s
- Normalizes URLs (adds https:// if missing)
- Rollback: Deletes campaign if scene insertion fails

**GET /api/campaigns**
- Lists user's campaigns with embedded latest render
- Uses `foreignTable` ordering to get single latest render per campaign
- Returns flat structure: `{ campaigns: [{ id, name, created_at, last_render }] }`

**GET /api/campaigns/[id]**
- Returns campaign + all scenes (ordered) + latest render
- 404 for both non-existent and non-owned campaigns (prevents ID enumeration)

**POST /api/campaigns/[id]/render**
- Enqueues new render job
- **Duplicate Guard**: Returns 409 if render already in progress
  - Checks for status in: `['queued', 'recording', 'normalizing', 'concatenating', 'overlaying', 'uploading']`
- Creates `renders` and `render_jobs` records atomically
- Generates `public_id` using nanoid

**GET /api/renders/[id]**
- Polls render status and progress (0-100)
- Ownership verified via campaign join
- Returns 404 if not found or not owned

### Authentication Flow

1. User visits `/` → redirects based on auth status
   - Authenticated → `/campaigns`
   - Not authenticated → `/login`

2. Login page uses Supabase Auth UI (magic link)
   - User enters email
   - Supabase sends magic link
   - Link redirects to `http://localhost:3000` with auth code
   - Session established

3. Protected routes check `supabase.auth.getUser()`
   - Client-side: `createClientComponentClient()`
   - Server-side: `createRouteHandlerClient({ cookies })`

### Security Patterns

**Row Level Security (RLS):**
- Database enforces user ownership at the query level
- Queries automatically filtered by `user_id`
- Even if API code has a bug, database prevents unauthorized access

**HTTP Status Codes:**
- 401: Unauthorized (not logged in)
- 404: Not found OR forbidden (to prevent ID enumeration)
- 409: Conflict (e.g., duplicate render in progress)
- 422: Validation error (bad input)
- 500: Server error

**ID Enumeration Prevention:**
Return 404 for both "doesn't exist" and "exists but you don't own it":
```typescript
const { data: campaign } = await supabase
  .from('campaigns')
  .select('*')
  .eq('id', params.id)
  .single();

if (!campaign) {
  // Could be non-existent OR non-owned (RLS filtered it out)
  return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
}
```

## Key Technical Details

### Supabase Auth Helpers (Deprecated Warning)

The project uses `@supabase/auth-helpers-nextjs@0.10.0` which shows a deprecation warning. This is expected. The package still works but future versions should migrate to `@supabase/ssr`.

**Current imports:**
```typescript
// Client-side (use in 'use client' components)
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

// Server-side (API routes)
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
```

### Supabase Auth UI Theme Import

The theme must be imported from the separate package:
```typescript
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';  // NOT from auth-ui-react
```

### URL Normalization

Use `normalizeUrl()` from `src/lib/utils/url.ts` for all user-submitted URLs:
```typescript
import { normalizeUrl } from '@/lib/utils/url';

const normalized = normalizeUrl("example.com");  // → "https://example.com"
```

### Foreign Table Ordering (Supabase)

To get the latest related record per parent:
```typescript
.select(`
  id,
  name,
  renders!left (
    id,
    status,
    progress
  )
`)
.order('created_at', { foreignTable: 'renders', ascending: false })
.limit(1, { foreignTable: 'renders' })
```

This avoids N+1 queries and returns a single render per campaign.

### Bulk Inserts with Order

Insert multiple records with sequential ordering:
```typescript
await supabase.from('scenes').insert(
  scenes.map((scene, index) => ({
    campaign_id: campaignId,
    url: scene.url,
    duration_sec: scene.duration_sec,
    order_index: index  // 0, 1, 2, ...
  }))
);
```

## File Structure

```
src/
├── app/
│   ├── page.tsx                          # Home: redirects based on auth
│   ├── login/page.tsx                    # Supabase Auth UI
│   ├── campaigns/page.tsx                # Protected: campaign dashboard
│   └── api/
│       ├── campaigns/
│       │   ├── route.ts                  # GET (list), POST (create)
│       │   └── [id]/
│       │       ├── route.ts              # GET (detail)
│       │       └── render/route.ts       # POST (enqueue)
│       └── renders/
│           └── [id]/route.ts             # GET (poll status)
└── lib/
    └── utils/
        └── url.ts                        # normalizeUrl()
```

## Integration with loom-lite

The worker process (not yet built) will:

1. Poll `render_jobs` table for `state = 'queued'`
2. Fetch campaign scenes from database
3. Call loom-lite Express API at `http://localhost:3100/api/render`
4. Update `renders.status` and `renders.progress` as video processes
5. Upload final video and update `renders.final_video_url`

The Express app (`loom-lite`) expects multipart form data:
- `facecam`: MP4 file buffer
- `config`: JSON configuration with scenes array

## Common Patterns

### Creating a Protected Page

```typescript
'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function ProtectedPage() {
  const supabase = createClientComponentClient();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) window.location.href = '/login';
      setUser(user);
    };
    getUser();
  }, [supabase]);

  if (!user) return <div>Loading...</div>;

  return <div>Protected content</div>;
}
```

### Creating an API Route with Validation

```typescript
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1),
  value: z.number()
});

export async function POST(request: Request) {
  const supabase = createRouteHandlerClient({ cookies });

  // Auth guard
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate
  const body = await request.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation error', details: result.error.format() },
      { status: 422 }
    );
  }

  // Use validated data
  const { name, value } = result.data;

  // ... database operations
}
```

## Testing Auth Locally

1. Start dev server: `pnpm dev`
2. Visit `http://localhost:3000/login`
3. Enter email (any email you have access to)
4. Check email for magic link
5. Click link → redirects to `/campaigns` when authenticated

## Port Configuration

- **vidgen-app (Next.js):** Port 3000
- **loom-lite (Express):** Port 3100

Both must be running for full functionality. However, vidgen-app can run independently for UI/API development.

## Security Best Practices

### Secret Management

**NEVER commit actual secrets to git.** This project has multiple layers of protection:

1. **.gitignore Protection**
   - `.env*` pattern blocks all .env files by default
   - `!.env.example` explicitly allows the template file
   - `.env.local` contains your actual secrets and is NEVER committed

2. **Pre-commit Hook** (`.git/hooks/pre-commit`)
   - Automatically scans staged files for secret patterns
   - Blocks commits containing:
     - Supabase URLs and keys
     - API keys, secret keys, private keys
     - AWS credentials
     - Password strings
   - Allows `.env.example` with placeholder values
   - Can be bypassed with `git commit --no-verify` for false positives

3. **File Organization**
   ```
   .env.local        # Your actual secrets (NEVER commit)
   .env.example      # Template with placeholders (SAFE to commit)
   ```

### What to Do If Secrets Are Exposed

If you accidentally commit secrets to GitHub:

1. **Rotate the compromised credentials immediately**
   - Supabase: Generate new anon/service keys in dashboard
   - API keys: Revoke and regenerate in the service provider

2. **Remove from git history** (if just committed):
   ```bash
   git reset HEAD~1  # Undo last commit
   # OR
   git rebase -i HEAD~5  # Edit last 5 commits
   ```

3. **For pushed commits**: Contact your team to coordinate the fix, as rewriting pushed history affects all developers.

### Supabase Security

**Anon Key vs Service Role Key:**
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Safe to expose in browser (limited by RLS)
- `SUPABASE_SERVICE_ROLE_KEY`: NEVER expose - bypasses RLS (server-side only)

The anon key is public by design - security is enforced by Row Level Security (RLS) policies in the database.

**Service Role Key Usage:**
If you need the service role key for admin operations:
- Add it to `.env.local` WITHOUT the `NEXT_PUBLIC_` prefix
- Only use in server-side code (API routes, not client components)
- Never log it or send it in responses

### GitHub Secret Scanning

GitHub automatically scans for leaked credentials. If you receive an alert:
- Take it seriously - secrets may already be compromised
- Follow the rotation steps above
- Review your `.gitignore` and pre-commit hook
- Check that `.env.local` was never committed: `git log --all --full-history -- "**/.env.local"`

### Additional Security Measures

1. **Enable 2FA** on critical services (GitHub, Supabase, AWS, etc.)
2. **Use environment-specific credentials** (dev vs production)
3. **Regularly rotate secrets** even if not compromised
4. **Limit secret access** to only team members who need it
5. **Monitor for unusual activity** in service provider dashboards
