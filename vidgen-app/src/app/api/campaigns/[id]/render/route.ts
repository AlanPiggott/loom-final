import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

/**
 * POST /api/campaigns/[id]/render
 * Enqueue a new render job for the campaign
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
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

    // Verify campaign exists and user owns it (RLS will filter)
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', params.id)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Duplicate render guard: Check for in-progress renders
    const inProgressStates = ['queued', 'recording', 'normalizing', 'concatenating', 'overlaying', 'uploading'];

    const { data: existingRenders, error: duplicateCheckError } = await supabase
      .from('renders')
      .select('id, status')
      .eq('campaign_id', params.id)
      .in('status', inProgressStates)
      .limit(1);

    if (duplicateCheckError) {
      console.error('[POST /api/campaigns/[id]/render] Duplicate check error:', duplicateCheckError);
      return NextResponse.json({ error: 'Failed to check existing renders' }, { status: 500 });
    }

    if (existingRenders && existingRenders.length > 0) {
      return NextResponse.json(
        { error: 'A render is already in progress for this campaign' },
        { status: 409 }
      );
    }

    // Get scenes to calculate total duration
    const { data: scenes, error: scenesError } = await supabase
      .from('scenes')
      .select('duration_sec')
      .eq('campaign_id', params.id);

    if (scenesError) {
      console.error('[POST /api/campaigns/[id]/render] Scenes query error:', scenesError);
      return NextResponse.json({ error: 'Failed to fetch scenes' }, { status: 500 });
    }

    if (!scenes || scenes.length === 0) {
      return NextResponse.json({ error: 'Campaign has no scenes' }, { status: 422 });
    }

    const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration_sec, 0);

    // Create render record
    const publicId = nanoid();
    const { data: render, error: renderError } = await supabase
      .from('renders')
      .insert({
        campaign_id: params.id,
        status: 'queued',
        progress: 0,
        public_id: publicId,
        duration_sec: totalDuration,
      })
      .select('id')
      .single();

    if (renderError) {
      console.error('[POST /api/campaigns/[id]/render] Render insert error:', renderError);
      return NextResponse.json({ error: 'Failed to create render' }, { status: 500 });
    }

    // Create render_jobs record
    const { error: jobError } = await supabase
      .from('render_jobs')
      .insert({
        render_id: render.id,
        state: 'queued',
      });

    if (jobError) {
      console.error('[POST /api/campaigns/[id]/render] Job insert error:', jobError);
      // Rollback: delete render if job creation fails
      await supabase.from('renders').delete().eq('id', render.id);
      return NextResponse.json({ error: 'Failed to create render job' }, { status: 500 });
    }

    return NextResponse.json({ renderId: render.id }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/campaigns/[id]/render] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
