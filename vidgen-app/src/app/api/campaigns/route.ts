import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { normalizeUrl } from '@/lib/utils/url';

// Zod schema for POST /api/campaigns
const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  scenes: z
    .array(
      z.object({
        url: z.string().url('Invalid URL format'),
        duration_sec: z.number().int().positive().max(300, 'Scene duration must be ≤ 300s'),
      })
    )
    .min(1, 'At least one scene is required'),
});

/**
 * GET /api/campaigns
 * List user's campaigns with latest render status
 */
export async function GET() {
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

    // Query campaigns with embedded latest render
    // Using foreignTable ordering to get only the most recent render per campaign
    const { data: campaigns, error: queryError } = await supabase
      .from('campaigns')
      .select(
        `
        id,
        name,
        created_at,
        renders!left (
          id,
          status,
          progress,
          final_video_url,
          thumb_url,
          created_at
        )
      `
      )
      .order('created_at', { ascending: false })
      .order('created_at', { foreignTable: 'renders', ascending: false })
      .limit(1, { foreignTable: 'renders' });

    if (queryError) {
      console.error('[GET /api/campaigns] Query error:', queryError);
      return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
    }

    // Transform to flat shape with last_render
    const transformed = (campaigns || []).map((campaign: any) => ({
      id: campaign.id,
      name: campaign.name,
      created_at: campaign.created_at,
      last_render: campaign.renders?.[0] || null,
    }));

    return NextResponse.json({ campaigns: transformed });
  } catch (error) {
    console.error('[GET /api/campaigns] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/campaigns
 * Create a new campaign with scenes
 */
export async function POST(request: Request) {
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

    // Parse and validate request body
    const body = await request.json();
    const result = createCampaignSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation error', details: result.error.format() },
        { status: 422 }
      );
    }

    const { name, scenes } = result.data;

    // Normalize URLs
    const normalizedScenes = scenes.map((scene) => ({
      ...scene,
      url: normalizeUrl(scene.url),
    }));

    // Check for invalid URLs
    const invalidUrl = normalizedScenes.find((s) => s.url === null);
    if (invalidUrl) {
      return NextResponse.json({ error: 'Invalid URL in scenes' }, { status: 422 });
    }

    // Validate total duration ≤ 300s (5 minutes)
    const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration_sec, 0);
    if (totalDuration > 300) {
      return NextResponse.json(
        { error: 'Total campaign duration exceeds 300s (5 minutes)' },
        { status: 422 }
      );
    }

    // Insert campaign
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        user_id: user.id,
        name,
      })
      .select('id')
      .single();

    if (campaignError) {
      console.error('[POST /api/campaigns] Campaign insert error:', campaignError);
      return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
    }

    // Bulk insert scenes with order_index
    const { error: scenesError } = await supabase.from('scenes').insert(
      normalizedScenes.map((scene, index) => ({
        campaign_id: campaign.id,
        url: scene.url!,
        duration_sec: scene.duration_sec,
        order_index: index,
      })),
      { returning: 'minimal' }
    );

    if (scenesError) {
      console.error('[POST /api/campaigns] Scenes insert error:', scenesError);
      // Rollback: delete campaign if scenes insertion fails
      await supabase.from('campaigns').delete().eq('id', campaign.id);
      return NextResponse.json({ error: 'Failed to create scenes' }, { status: 500 });
    }

    return NextResponse.json({ id: campaign.id }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/campaigns] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
