import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy endpoint that forwards video rendering requests to loom-lite server.
 *
 * This endpoint receives multipart form data (facecam video + config JSON)
 * from the CampaignWizard and forwards it to the loom-lite Express server
 * running on port 3100.
 *
 * Architecture:
 * - vidgen-app (port 3000): UI and dashboard
 * - loom-lite (port 3100): Video rendering engine
 */
export async function POST(request: NextRequest) {
  const LOOM_LITE_URL = process.env.LOOM_LITE_URL || 'http://localhost:3100';

  console.log('[Proxy /api/render] Received request, forwarding to loom-lite...');

  try {
    // Get the form data from the request
    const formData = await request.formData();

    // Log what we received
    const facecam = formData.get('facecam');
    const config = formData.get('config');
    console.log('[Proxy /api/render] Facecam:', facecam ? 'present' : 'missing');
    console.log('[Proxy /api/render] Config:', config ? 'present' : 'missing');

    if (!facecam || !config) {
      return NextResponse.json(
        { ok: false, error: 'Missing facecam or config' },
        { status: 400 }
      );
    }

    // Forward to loom-lite server
    console.log(`[Proxy /api/render] Forwarding to ${LOOM_LITE_URL}/api/render...`);

    const response = await fetch(`${LOOM_LITE_URL}/api/render`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type - let fetch set it with boundary for multipart
    });

    console.log('[Proxy /api/render] Response status:', response.status);

    // Get the response from loom-lite
    const result = await response.json();

    if (response.ok) {
      console.log('[Proxy /api/render] Success! Final URL:', result.finalUrl);

      // Transform URLs to point to loom-lite server
      // The wizard expects relative URLs, but they need to point to loom-lite
      const transformedResult = {
        ...result,
        finalUrl: result.finalUrl ? `${LOOM_LITE_URL}${result.finalUrl}` : undefined,
        posterUrl: result.posterUrl ? `${LOOM_LITE_URL}${result.posterUrl}` : undefined,
      };

      return NextResponse.json(transformedResult);
    } else {
      console.error('[Proxy /api/render] Error from loom-lite:', result.error);
      return NextResponse.json(result, { status: response.status });
    }
  } catch (error: any) {
    console.error('[Proxy /api/render] Error:', error.message);
    console.error('[Proxy /api/render] Stack:', error.stack);

    // Check if loom-lite server is running
    if (error.code === 'ECONNREFUSED' || error.message.includes('fetch failed')) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Cannot connect to loom-lite server. Please ensure loom-lite is running on port 3100.',
          hint: 'Run: cd loom-lite && npm start'
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { ok: false, error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}
