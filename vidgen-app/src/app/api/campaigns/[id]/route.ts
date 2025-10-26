import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * GET /api/campaigns/[id]
 * Get campaign details with scenes and latest render
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
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

    // Query campaign (RLS will filter by user_id automatically)
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id, name, created_at, lead_row_count, lead_csv_filename, lead_csv_url')
      .eq('id', id)
      .single();

    // If no campaign found, it's either non-existent or not owned by user
    // Return 404 in both cases to avoid leaking existence
    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Query scenes ordered by order_index
    const { data: scenes, error: scenesError } = await supabase
      .from('scenes')
      .select('id, url, duration_sec, order_index, entry_type, csv_column')
      .eq('campaign_id', id)
      .order('order_index', { ascending: true });

    if (scenesError) {
      console.error('[GET /api/campaigns/[id]] Scenes query error:', scenesError);
      return NextResponse.json({ error: 'Failed to fetch scenes' }, { status: 500 });
    }

    // Query latest render
    const { data: renders, error: renderError } = await supabase
      .from('renders')
      .select('id, status, progress, public_id, final_video_url, thumb_url, error, lead_row_index, lead_identifier, created_at')
      .eq('campaign_id', id)
      .order('created_at', { ascending: false });

    if (renderError) {
      console.error('[GET /api/campaigns/[id]] Render query error:', renderError);
      return NextResponse.json({ error: 'Failed to fetch render' }, { status: 500 });
    }

    const latestRender = renders && renders.length > 0 ? renders[0] : null;

    return NextResponse.json({
      campaign,
      scenes: scenes || [],
      renders: renders || [],
      latestRender,
    });
  } catch (error) {
    console.error('[GET /api/campaigns/[id]] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
