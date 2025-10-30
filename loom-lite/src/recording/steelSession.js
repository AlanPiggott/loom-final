/**
 * Steel Session Manager
 *
 * Manages a shared Steel browser context across all scenes in a campaign
 * to avoid resize glitches that occur when creating new contexts.
 *
 * The root cause: Steel's compositor/streamer re-negotiates the backing surface
 * size when creating new contexts, causing brief "small page in top-left" frames.
 * By keeping one context alive for the entire campaign and only creating new pages
 * per scene, we avoid this re-negotiation.
 */

const { chromium } = require('playwright');
const { createSteelSession, releaseSteelSession } = require('../providers/steel');

async function waitForStableWindow(page, width, height, stableMs = 1500, pollMs = 100, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let stable = 0;
  while (Date.now() < end) {
    const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    stable = (size.w === width && size.h === height) ? stable + pollMs : 0;
    if (stable >= stableMs) return;
    await page.waitForTimeout(pollMs);
  }
  throw new Error(`Steel window never stabilized to ${width}x${height}`);
}

// Cache for the shared session
let cached = null;

/**
 * Get or create a shared Steel recording context for the entire campaign
 *
 * @param {Object} options
 * @param {number} options.w - Video width
 * @param {number} options.h - Video height
 * @param {string} options.baseDir - Base directory for all video recordings
 * @returns {Promise<Object>} Shared session with context, browser, and cleanup method
 */
async function getSteelRecordingContext({ w, h, baseDir }) {
  // Check if existing session is still valid
  if (cached) {
    try {
      // Test if context is actually usable by trying to call a method on it
      // This will fail immediately if the context is closed or disconnected
      await cached.context.pages();

      // Also check browser is still connected
      const contexts = cached.browser.contexts();
      if (contexts.includes(cached.context)) {
        console.log('[steelSession] Reusing existing Steel context');
        return cached;
      } else {
        console.log('[steelSession] Cached context not in browser contexts, creating new session');
        cached = null; // Clear invalid cache
      }
    } catch (error) {
      console.log('[steelSession] Cached context is unusable, creating new session:', error.message);

      // Try to cleanup the dead session before clearing cache
      const oldCached = cached;
      cached = null; // Clear invalid cache

      try {
        if (oldCached?.browser) {
          await oldCached.browser.close().catch(() => {});
        }
        if (oldCached?.steelClient && oldCached?.steelSessionId) {
          await releaseSteelSession({
            client: oldCached.steelClient,
            sessionId: oldCached.steelSessionId,
            apiKey: process.env.STEEL_API_KEY
          }).catch(() => {});
        }
      } catch (cleanupError) {
        console.log('[steelSession] Error cleaning up dead session:', cleanupError.message);
      }
    }
  }

  console.log('[steelSession] Creating new shared Steel context for campaign');

  // Create Steel session with pinned dimensions
  const { id, wsUrl, client } = await createSteelSession({
    apiKey: process.env.STEEL_API_KEY,
    regionId: process.env.STEEL_REGION,
    timeoutMs: Number(process.env.STEEL_SESSION_TTL_MS || 600000),
    width: w,
    height: h
  });

  console.log(`[steelSession] Steel session ${id} created`);

  // Connect to Steel via CDP
  const browser = await chromium.connectOverCDP(wsUrl, { timeout: 60000 });
  console.log('[steelSession] Connected to Steel browser');

  // Skip window stabilization check for CDP recording
  // CDP screencast captures at specified resolution regardless of actual window size
  console.log('[steelSession] Skipping window stabilization check (using CDP recording)');

  // Try to set browser window size via CDP (best effort)
  try {
    const cdpSession = await browser.newBrowserCDPSession();
    const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
    await cdpSession.send('Browser.setWindowBounds', {
      windowId,
      bounds: { width: w, height: h, windowState: 'normal' }
    });
    console.log(`[steelSession] Set browser window to ${w}x${h} via CDP`);
  } catch (cdpError) {
    console.log('[steelSession] Could not set window bounds via CDP:', cdpError.message);
    // Continue anyway - the pinned session dimensions should help
  }

  // Create shared context WITH recordVideo for the entire campaign
  // Using a single context minimizes resize glitches between scenes
  const context = await browser.newContext({
    viewport: null,  // No viewport emulation
    recordVideo: {
      dir: baseDir,  // Base directory for all recordings
      size: { width: w, height: h }  // Fixed size for all recordings
    }
  });

  console.log(`[steelSession] Context created with recordVideo (${w}x${h})`);

  // Cache the session
  cached = {
    steelSessionId: id,
    steelClient: client,
    browser,
    context,
    w,
    h,
    baseDir,

    /**
     * Cleanup the shared session - call this at the end of the campaign
     */
    async cleanup() {
      console.log('[steelSession] Cleaning up shared Steel session...');
      try {
        await context.close();
        console.log('[steelSession] Context closed');
      } catch (e) {
        console.warn('[steelSession] Error closing context:', e.message);
      }

      try {
        await browser.close();
        console.log('[steelSession] Browser closed');
      } catch (e) {
        console.warn('[steelSession] Error closing browser:', e.message);
      }

      try {
        await releaseSteelSession({
          client,
          sessionId: id,
          apiKey: process.env.STEEL_API_KEY
        });
        console.log('[steelSession] Steel session released');
      } catch (e) {
        console.warn('[steelSession] Error releasing session:', e.message);
      }

      cached = null;
      console.log('[steelSession] Cleanup complete');
    }
  };

  return cached;
}

/**
 * Force cleanup of any existing session
 * Call this if you need to ensure a fresh start
 */
async function cleanupSteelSession() {
  if (cached) {
    await cached.cleanup();
  }
}

module.exports = {
  getSteelRecordingContext,
  cleanupSteelSession
};
