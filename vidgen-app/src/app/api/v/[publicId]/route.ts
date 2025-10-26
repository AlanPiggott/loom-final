import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * GET /api/v/[publicId]
 * Public endpoint - fetch render by public_id (no auth required)
 */
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  try {
    const { publicId } = await params;
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    // Query render by public_id
    // Note: This is a PUBLIC endpoint - no auth required
    // Only return completed renders with video URLs
    const { data: render, error: renderError } = await supabase
      .from('renders')
      .select('id, final_video_url, thumb_url, duration_sec, status, public_id')
      .eq('public_id', publicId)
      .single();

    // If no render found, return 404
    if (renderError || !render) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // If render not completed or no video URL, return 404
    if (render.status !== 'done' || !render.final_video_url) {
      return NextResponse.json({ error: 'Video not ready' }, { status: 404 });
    }

    // Return public video data
    return NextResponse.json({
      public_id: render.public_id,
      final_video_url: render.final_video_url,
      thumb_url: render.thumb_url,
      duration_sec: render.duration_sec,
    });
  } catch (error) {
    console.error('[GET /api/v/[publicId]] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
