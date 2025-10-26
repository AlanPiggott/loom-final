import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch renders for the campaign. RLS on campaigns/renders enforces ownership.
    const { data: renders, error: renderError } = await supabase
      .from('renders')
      .select(
        'id, status, progress, public_id, final_video_url, thumb_url, error, lead_row_index, lead_identifier, created_at'
      )
      .eq('campaign_id', id)
      .order('created_at', { ascending: false });

    if (renderError) {
      console.error('[GET /api/campaigns/[id]/renders] Query error:', renderError);
      return NextResponse.json({ error: 'Failed to fetch renders' }, { status: 500 });
    }

    return NextResponse.json({ renders: renders || [] });
  } catch (error) {
    console.error('[GET /api/campaigns/[id]/renders] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
