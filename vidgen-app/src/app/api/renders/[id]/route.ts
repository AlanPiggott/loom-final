import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * GET /api/renders/[id]
 * Poll render status (ownership verified via campaign RLS)
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    // Auth guard
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Query render with campaign ownership check via join
    // RLS on campaigns table will automatically filter by user_id
    const { data: render, error: renderError } = await supabase
      .from('renders')
      .select(
        `
        id,
        status,
        progress,
        public_id,
        final_video_url,
        thumb_url,
        error,
        campaign_id,
        campaigns!inner (id)
      `
      )
      .eq('id', params.id)
      .single();

    // If no render found, it's either non-existent or not owned by user
    // Return 404 in both cases to avoid leaking existence
    if (renderError || !render) {
      return NextResponse.json({ error: 'Render not found' }, { status: 404 });
    }

    // Return clean response without campaign join data
    return NextResponse.json({
      id: render.id,
      status: render.status,
      progress: render.progress,
      public_id: render.public_id,
      final_video_url: render.final_video_url,
      thumb_url: render.thumb_url,
      error: render.error,
    });
  } catch (error) {
    console.error('[GET /api/renders/[id]] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
