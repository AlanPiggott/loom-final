/**
 * Steel Browser Provider
 *
 * Creates and manages remote browser sessions via Steel SDK.
 * Handles session lifecycle to prevent credit leaks.
 */

const Steel = require('steel-sdk');

/**
 * Create a new Steel browser session
 *
 * @param {Object} options - Session options
 * @param {string} options.apiKey - Steel API key
 * @param {string} options.regionId - Region (optional - not used in current API)
 * @param {number} options.timeoutMs - Session timeout in milliseconds
 * @param {number} options.width - Browser viewport width (optional)
 * @param {number} options.height - Browser viewport height (optional)
 * @returns {Promise<{id: string, wsUrl: string, viewerUrl: string, client: Steel}>}
 */
async function createSteelSession({
  apiKey,
  regionId = process.env.STEEL_REGION || 'sfo',
  timeoutMs = 600000,
  width = null,
  height = null
} = {}) {
  if (!apiKey) {
    throw new Error('Steel API key is required');
  }

  console.log(`[Steel] Creating session via SDK (timeout: ${timeoutMs}ms${width && height ? `, dimensions: ${width}x${height}` : ''})...`);

  try {
    // Initialize Steel client
    const steel = new Steel({ steelAPIKey: apiKey });

    // Build session options
    const sessionOptions = {
      useProxy: false,
      solveCaptcha: false,
      sessionTimeout: Math.floor(timeoutMs / 1000), // Convert to seconds
      sessionViewer: { enabled: false },
      allowSessionViewer: false,
      headless: true
    };

    // Add dimensions if provided - this pins the browser window size at the Steel level
    if (width && height) {
      sessionOptions.dimensions = { width, height };
    }

    // Create session with SDK
    const session = await steel.sessions.create(sessionOptions);

    // Build WebSocket URL with API key authentication (required for direct connections)
    const wsUrl = `wss://connect.steel.dev?apiKey=${apiKey}&sessionId=${session.id}`;

    console.log(`[Steel] Session created: ${session.id}`);
    console.log(`[Steel] WebSocket URL: ${wsUrl}`);
    if (session.sessionViewerUrl) {
      console.log(`[Steel] Live viewer: ${session.sessionViewerUrl}`);
    }

    return {
      id: session.id,
      wsUrl: wsUrl, // Use corrected URL with API key
      viewerUrl: session.sessionViewerUrl,
      client: steel // Return client for release
    };
  } catch (error) {
    console.error(`[Steel] Failed to create session:`, error.message);
    throw error;
  }
}

/**
 * Release a Steel session to avoid credit leaks
 *
 * @param {Object} options - Release options
 * @param {Steel} options.client - Steel SDK client instance
 * @param {string} options.sessionId - Session ID to release
 * @param {string} options.apiKey - Steel API key (fallback if no client)
 */
async function releaseSteelSession({ client, sessionId, apiKey }) {
  if (!sessionId) {
    console.warn('[Steel] Cannot release session: missing sessionId');
    return;
  }

  console.log(`[Steel] Releasing session: ${sessionId}`);

  try {
    // Use client if provided, otherwise create new client
    const steel = client || new Steel({ steelAPIKey: apiKey });

    await steel.sessions.release(sessionId);
    console.log(`[Steel] Session ${sessionId} released successfully`);
  } catch (error) {
    console.warn(`[Steel] Failed to release session ${sessionId}:`, error.message);
    // Don't throw - this is cleanup, we don't want to mask the original error
  }
}

module.exports = {
  createSteelSession,
  releaseSteelSession
};
