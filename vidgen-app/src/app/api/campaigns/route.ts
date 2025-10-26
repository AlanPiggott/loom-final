import { randomUUID } from 'crypto';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { normalizeUrl } from '@/lib/utils/url';
import { uploadFacecam, uploadLeadCsv } from '@/lib/supabase/storage';

// Zod schema for POST /api/campaigns (when using JSON)
const sceneSchema = z
  .object({
    entry_type: z.enum(['manual', 'csv']).optional(),
    url: z.string().min(1, 'URL is required'),
    duration_sec: z.number().int().positive().max(300, 'Scene duration must be ≤ 300s'),
    csv_column: z.string().optional(),
  })
  .refine(
    (scene) => (scene.entry_type === 'csv' ? !!scene.csv_column?.trim() : true),
    {
      message: 'CSV column is required for CSV scenes',
      path: ['csv_column'],
    }
  );

const csvMetaSchema = z
  .object({
    rowCount: z.number().int().nonnegative(),
    headers: z.array(z.string()),
    filename: z.string().optional(),
  })
  .nullable()
  .optional();

const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  scenes: z.array(sceneSchema).min(1, 'At least one scene is required'),
  csv_meta: csvMetaSchema,
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
        facecam_url,
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
      facecam_url: campaign.facecam_url,
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
 * Create a new campaign with scenes and optional facecam
 * Accepts either JSON or FormData (when facecam is included)
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

    // Check content type to determine how to parse the request
    const contentType = request.headers.get('content-type') || '';
    let name: string;
    let scenes: Array<{
      entry_type?: 'manual' | 'csv';
      url: string;
      duration_sec: number;
      csv_column?: string;
    }>;
    let facecamFile: File | null = null;
    let leadCsvFile: File | null = null;
    let csvMeta: { rowCount: number; headers: string[]; filename?: string } | null = null;

    if (contentType.includes('multipart/form-data')) {
      // Handle FormData (with facecam)
      const formData = await request.formData();

      // Extract campaign data
      const campaignData = formData.get('data') as string;
      if (!campaignData) {
        return NextResponse.json({ error: 'Missing campaign data' }, { status: 422 });
      }

      const parsedData = JSON.parse(campaignData);
      const result = createCampaignSchema.safeParse(parsedData);

      if (!result.success) {
        return NextResponse.json(
          { error: 'Validation error', details: result.error.format() },
          { status: 422 }
        );
      }

      name = result.data.name;
      scenes = result.data.scenes;
      csvMeta = result.data.csv_meta ?? null;

      // Extract facecam file
      const facecam = formData.get('facecam');
      if (facecam instanceof File) {
        facecamFile = facecam;
        console.log('[POST /api/campaigns] Received facecam:', facecam.name, facecam.size);
      }

      const leadCsv = formData.get('lead_csv');
      if (leadCsv instanceof File && leadCsv.size > 0) {
        leadCsvFile = leadCsv;
        if (!csvMeta) {
          csvMeta = {
            rowCount: 0,
            headers: [],
            filename: leadCsv.name,
          };
        } else if (!csvMeta.filename) {
          csvMeta = { ...csvMeta, filename: leadCsv.name };
        }
        console.log('[POST /api/campaigns] Received lead CSV:', leadCsv.name, leadCsv.size);
      }
    } else {
      // Handle JSON (no facecam)
      const body = await request.json();
      const result = createCampaignSchema.safeParse(body);

      if (!result.success) {
        return NextResponse.json(
          { error: 'Validation error', details: result.error.format() },
          { status: 422 }
        );
      }

      name = result.data.name;
      scenes = result.data.scenes;
      csvMeta = result.data.csv_meta ?? null;
    }

    // Ensure entry_type defaults to manual when omitted
    scenes = scenes.map((scene) => ({
      ...scene,
      entry_type: (scene.entry_type ?? 'manual') as 'manual' | 'csv',
    }));

    // Normalize URLs (manual + CSV resolved values)
    const preparedScenes = scenes.map((scene) => ({
      entry_type: scene.entry_type,
      csv_column: scene.entry_type === 'csv' ? scene.csv_column ?? null : null,
      duration_sec: scene.duration_sec,
      url: normalizeUrl(scene.url),
    }));

    // Check for invalid URLs
    const invalidScene = preparedScenes.find((s) => s.url === null);
    if (invalidScene) {
      const message =
        invalidScene.entry_type === 'csv' && invalidScene.csv_column
          ? `Invalid URL resolved from CSV column "${invalidScene.csv_column}". Please verify the CSV values.`
          : 'Invalid URL in scenes';
      return NextResponse.json({ error: message }, { status: 422 });
    }

    // Validate total duration ≤ 300s (5 minutes)
    const usesCsvScenes = preparedScenes.some((scene) => scene.entry_type === 'csv');

    if (usesCsvScenes && !leadCsvFile) {
      return NextResponse.json(
        { error: 'Lead CSV file is required when using CSV scenes' },
        { status: 422 }
      );
    }

    if (usesCsvScenes && (!csvMeta || csvMeta.rowCount <= 0)) {
      return NextResponse.json(
        { error: 'Lead CSV must contain at least one data row' },
        { status: 422 }
      );
    }

    const totalDuration = preparedScenes.reduce((sum, scene) => sum + scene.duration_sec, 0);
    if (totalDuration > 300) {
      return NextResponse.json(
        { error: 'Total campaign duration exceeds 300s (5 minutes)' },
        { status: 422 }
      );
    }

    // If facecam is provided, validate that we have scenes
    if (facecamFile) {
      // Note: We can't easily validate exact video duration here without ffprobe
      // But we can at least ensure scenes exist
      if (scenes.length === 0) {
        return NextResponse.json(
          { error: 'Cannot create campaign with facecam but no scenes' },
          { status: 422 }
        );
      }
      console.log('[POST /api/campaigns] Facecam provided with', scenes.length, 'scenes');
    }

    // Create campaign with temporary ID for facecam upload
    const tempId = randomUUID();

    // Upload facecam to Supabase Storage if provided
    let facecamUrl: string | null = null;
    if (facecamFile) {
      try {
        console.log('[POST /api/campaigns] Uploading facecam to storage...');
        facecamUrl = await uploadFacecam(facecamFile, tempId);
        console.log('[POST /api/campaigns] Facecam uploaded:', facecamUrl);
      } catch (uploadError) {
        console.error('[POST /api/campaigns] Facecam upload failed:', uploadError);
        return NextResponse.json({ error: 'Failed to upload facecam video' }, { status: 500 });
      }
    }

    // Upload lead CSV if provided
    let leadCsvUrl: string | null = null;
    let leadCsvPath: string | null = null;
    let leadCsvFilename: string | null = csvMeta?.filename ?? null;
    const leadRowCount = csvMeta?.rowCount ?? 0;
    const csvHeaders = csvMeta?.headers ?? [];

    if (leadCsvFile) {
      try {
        console.log('[POST /api/campaigns] Uploading lead CSV to storage...');
        const { publicUrl, path } = await uploadLeadCsv(leadCsvFile, tempId);
        leadCsvUrl = publicUrl;
        leadCsvPath = path;
        if (!leadCsvFilename) {
          leadCsvFilename = leadCsvFile.name;
        }
        console.log('[POST /api/campaigns] Lead CSV uploaded:', publicUrl);
      } catch (uploadError) {
        console.error('[POST /api/campaigns] Lead CSV upload failed:', uploadError);
        return NextResponse.json({ error: 'Failed to upload lead CSV' }, { status: 500 });
      }
    }

    // Insert campaign with facecam URL
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        user_id: user.id,
        name,
        facecam_url: facecamUrl,
        lead_csv_url: leadCsvUrl,
        lead_csv_path: leadCsvPath,
        lead_csv_filename: leadCsvFilename,
        lead_row_count: leadRowCount,
        csv_headers: csvHeaders.length > 0 ? csvHeaders : null,
      })
      .select('id')
      .single();

    if (campaignError) {
      console.error('[POST /api/campaigns] Campaign insert error:', campaignError);
      // Clean up uploaded facecam if campaign creation fails
      if (facecamUrl) {
        // Note: We could delete the facecam here, but it's not critical
        console.log('[POST /api/campaigns] Campaign creation failed, orphaned facecam:', facecamUrl);
      }
      return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
    }

    // Bulk insert scenes with order_index
    const { error: scenesError } = await supabase.from('scenes').insert(
      preparedScenes.map((scene, index) => ({
        campaign_id: campaign.id,
        url: scene.url!,
        duration_sec: scene.duration_sec,
        order_index: index,
        entry_type: scene.entry_type,
        csv_column: scene.csv_column,
      })),
      { returning: 'minimal' }
    );

    if (scenesError) {
      console.error('[POST /api/campaigns] Scenes insert error:', scenesError);
      // Rollback: delete campaign if scenes insertion fails
      await supabase.from('campaigns').delete().eq('id', campaign.id);
      return NextResponse.json({ error: 'Failed to create scenes' }, { status: 500 });
    }

    return NextResponse.json({ id: campaign.id, facecam_url: facecamUrl }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/campaigns] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
