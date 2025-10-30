const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { doGoto, doWait, doClickText, doHighlight, doScroll } = require('./actions');
const { normalizeUrl } = require('../utils/urlNormalizer');
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;
const { PNG } = require('pngjs');
const HME = require('../hme');

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitIfResizing(page, targetW, targetH, settleMs = 600, pollMs = 100) {
  const initial = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  if (initial.w === targetW && initial.h === targetH) return;

  let stable = 0;
  while (stable < settleMs) {
    const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    stable = (size.w === targetW && size.h === targetH) ? stable + pollMs : 0;
    await page.waitForTimeout(pollMs);
  }
}

async function lockViewportForPage(page, width, height) {
  await page.setViewportSize({ width, height });

  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 255, g: 255, b: 255, a: 1 }
    });
  } catch (err) {
    console.warn('[recordScene] Failed to override background color:', err.message);
  }

  page.on('framenavigated', async (frame) => {
    if (frame === page.mainFrame()) {
      try {
        await page.setViewportSize({ width, height });
      } catch (err) {
        console.warn('[recordScene] Failed to reapply viewport size after navigation:', err.message);
      }
    }
  });
}

function toMs(sec) { return Math.max(0, Math.floor(sec * 1000)); }

/**
 * Install a navigation mask that will cover the page during navigation
 * This prevents viewport resize glitches from being visible in the recording
 */
async function installNavMask(page) {
  // Install mask ASAP during page load, not waiting for DOMContentLoaded
  await page.addInitScript(() => {
    // Poll for document.documentElement to exist, then install mask immediately
    const installMask = () => {
      if (!document.documentElement) {
        setTimeout(installMask, 10); // Retry quickly
        return;
      }

      // Install mask as soon as <html> exists
      // Using visibility:hidden instead of white background to allow JS visibility detection
      if (!document.getElementById('__ll_mask_style')) {
        const s = document.createElement('style');
        s.id = '__ll_mask_style';
        s.textContent = `#__ll_mask{position:fixed;inset:0;background:#fff;visibility:hidden;z-index:2147483647!important;}`;
        document.documentElement.appendChild(s);
      }

      if (!document.getElementById('__ll_mask')) {
        const m = document.createElement('div');
        m.id = '__ll_mask';
        document.documentElement.appendChild(m);
      }
    };

    // Start polling immediately
    installMask();
  });
}

/**
 * Show the mask immediately on the current page
 */
async function showMaskNow(page) {
  await page.evaluate(() => {
    if (!document.getElementById('__ll_mask_style')) {
      const s = document.createElement('style');
      s.id = '__ll_mask_style';
      s.textContent = `#__ll_mask{position:fixed;inset:0;background:#fff;visibility:hidden;z-index:2147483647!important;}`;
      document.documentElement.appendChild(s);
    }
    if (!document.getElementById('__ll_mask')) {
      const m = document.createElement('div');
      m.id = '__ll_mask';
      document.documentElement.appendChild(m);
    }
  });
}

/**
 * Hide the mask to reveal the page content
 */
async function hideMask(page) {
  await page.evaluate(() => {
    const m = document.getElementById('__ll_mask'); if (m) m.remove();
    const s = document.getElementById('__ll_mask_style'); if (s) s.remove();
  });
}

/**
 * Wait for viewport to stabilize at the target dimensions
 */
async function waitViewportStable(page, targetW, targetH, stableMs = 1000, pollMs = 100, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
    if (s.w === targetW && s.h === targetH) {
      stable += pollMs;
      if (stable >= stableMs) {
        console.log(`[recordScene] Viewport stabilized at ${targetW}x${targetH}`);
        return;
      }
    } else {
      stable = 0;
    }
    await page.waitForTimeout(pollMs);
  }
  // Don't throw; just log and continue so we never "hang"
  console.warn(`[recordScene] Viewport did not stabilize to ${targetW}x${targetH} within ${timeoutMs}ms`);
}

/**
 * Lightweight, deterministic page ready detection
 * Uses FCP + tolerant visual stability instead of brittle networkidle
 * Hard capped at 7s to prevent long waits (video-layer auto-trim will handle any lead-in)
 */
async function waitForPageReady(page, maxWaitMs = 7000) {
  const startTime = Date.now();
  const absoluteMaxMs = 7000; // Hard cap regardless of maxWaitMs parameter

  try {
    // Step 1: Wait for DOM to be ready (not networkidle - too unreliable)
    await page.waitForLoadState('domcontentloaded', { timeout: Math.min(15000, absoluteMaxMs) });
    console.log(`[waitForPageReady] DOM ready after ${Date.now() - startTime}ms`);

    // Step 2: Wait for fonts (with timeout cap)
    const fontsPromise = page.evaluate(async () => {
      try {
        await document.fonts.ready;
        return true;
      } catch(e) {
        return false;
      }
    });

    await Promise.race([
      fontsPromise,
      new Promise(resolve => setTimeout(() => resolve(false), 3000))
    ]);
    console.log(`[waitForPageReady] Fonts ready (or timeout) after ${Date.now() - startTime}ms`);

    // Step 3: First Contentful Paint (FCP) detection with fallback
    await page.evaluate(async () => {
      return await new Promise(res => {
        let done = false;
        const finish = () => { if (!done) { done = true; res(true); } };
        try {
          new PerformanceObserver((list, obs) => {
            if (list.getEntries().some(e => e.name === 'first-contentful-paint')) {
              obs.disconnect();
              finish();
            }
          }).observe({ type: 'paint', buffered: true });
          const paints = performance.getEntriesByType('paint');
          if (paints.some(e => e.name === 'first-contentful-paint')) finish();
        } catch(e) {}
        // Fallback: one rAF + 200ms
        requestAnimationFrame(() => setTimeout(finish, 200));
      });
    });
    console.log(`[waitForPageReady] FCP detected after ${Date.now() - startTime}ms`);

    // Step 4: Tolerant visual stability check with white-screen rejection
    // Downscale to 512x288, use pixelmatch diff%, reject mostly-white screens
    let stableCount = 0;
    let previousPng = null;
    const requiredStableChecks = 3;
    const downscaleWidth = 512;
    const downscaleHeight = 288;

    while (stableCount < requiredStableChecks && (Date.now() - startTime < absoluteMaxMs)) {
      const screenshot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: 1280, height: 720 }
      });

      // Decode PNG and downscale to 512x288
      const fullPng = PNG.sync.read(screenshot);
      const downscaledPng = {
        width: downscaleWidth,
        height: downscaleHeight,
        data: Buffer.alloc(downscaleWidth * downscaleHeight * 4)
      };

      // Simple box sampling downscale
      const scaleX = fullPng.width / downscaleWidth;
      const scaleY = fullPng.height / downscaleHeight;

      for (let y = 0; y < downscaleHeight; y++) {
        for (let x = 0; x < downscaleWidth; x++) {
          const srcX = Math.floor(x * scaleX);
          const srcY = Math.floor(y * scaleY);
          const srcIdx = (srcY * fullPng.width + srcX) * 4;
          const dstIdx = (y * downscaleWidth + x) * 4;
          downscaledPng.data[dstIdx] = fullPng.data[srcIdx];
          downscaledPng.data[dstIdx + 1] = fullPng.data[srcIdx + 1];
          downscaledPng.data[dstIdx + 2] = fullPng.data[srcIdx + 2];
          downscaledPng.data[dstIdx + 3] = fullPng.data[srcIdx + 3];
        }
      }

      // Check if mostly white (reject as unstable)
      let totalLuma = 0;
      const pixelCount = downscaleWidth * downscaleHeight;
      for (let i = 0; i < downscaledPng.data.length; i += 4) {
        const r = downscaledPng.data[i];
        const g = downscaledPng.data[i + 1];
        const b = downscaledPng.data[i + 2];
        const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        totalLuma += luma;
      }
      const avgLuma = totalLuma / pixelCount;

      if (avgLuma > 0.95) {
        // Mostly white screen - not ready, reset stability
        console.log(`[waitForPageReady] Mostly white screen detected (luma: ${avgLuma.toFixed(3)}), waiting...`);
        stableCount = 0;
        previousPng = null; // Don't use white screens for comparison
        await page.waitForTimeout(500);
        continue;
      }

      if (previousPng) {
        const diffPixels = pixelmatch(
          previousPng.data,
          downscaledPng.data,
          null,
          downscaleWidth,
          downscaleHeight,
          { threshold: 0.1 }
        );

        const diffPercent = (diffPixels / pixelCount) * 100;

        if (diffPercent < 1.0) {
          stableCount++;
          console.log(`[waitForPageReady] Visual stability ${stableCount}/${requiredStableChecks} (diff: ${diffPercent.toFixed(2)}%, luma: ${avgLuma.toFixed(3)})`);
        } else {
          stableCount = 0;
          console.log(`[waitForPageReady] Page changing (diff: ${diffPercent.toFixed(2)}%), resetting`);
        }
      }

      previousPng = downscaledPng;
      await page.waitForTimeout(300);
    }

    if (stableCount >= requiredStableChecks) {
      console.log(`[waitForPageReady] Visual stability confirmed after ${Date.now() - startTime}ms`);
    } else {
      console.log(`[waitForPageReady] Timeout at ${Date.now() - startTime}ms, proceeding (video-layer trim will handle any lead-in)`);
    }

  } catch (error) {
    console.log(`[waitForPageReady] Error: ${error.message}, proceeding anyway (video-layer trim will fix it)`);
  }

  return Date.now() - startTime;
}

async function recordScene(scene, ctx) {
  const { w, h, fps, workDir } = ctx;
  const sceneDir = path.join(workDir);
  if (!fs.existsSync(sceneDir)) fs.mkdirSync(sceneDir, { recursive: true });

  // Check if we should use Steel (feature flag)
  const useSteel = String(process.env.USE_STEEL || '').toLowerCase() === 'true';
  const recorderStrategy = process.env.RECORDER || 'psr'; // 'psr' or 'shots'

  let browser, context, page, video;
  let steelSessionId = null;
  let steelClient = null;
  let recorder = null;
  let videoPath = null;
  let frameForceInterval = null; // For keeping CDP screencast active

  if (useSteel) {
    // ===== STEEL REMOTE BROWSER PATH =====
    console.log('[recordScene] Using Steel remote browser with shared context');
    const { getSteelRecordingContext } = require('./steelSession');

    try {
      // Get or create the shared Steel context for this campaign
      // The baseDir should be the parent directory for all scenes
      const campaignDir = path.dirname(sceneDir);
      const sharedSession = await getSteelRecordingContext({
        w,
        h,
        baseDir: campaignDir
      });

      // Store references for cleanup (but won't release until campaign ends)
      browser = sharedSession.browser;
      context = sharedSession.context;
      steelSessionId = sharedSession.steelSessionId;
      steelClient = sharedSession.steelClient;

      // Create a new page for this scene (each page gets its own video file)
      page = await context.newPage();
      console.log('[recordScene] Created new page for scene in shared Steel context');

      // Playwright's recordVideo from the shared context will handle recording
      // Each page gets its own video file automatically

      // Install mask init script - will cover page during navigation
      await installNavMask(page);

      // Set viewport lock immediately (before any navigation)
      await lockViewportForPage(page, w, h);

    } catch (error) {
      // Don't release the session here - it's shared across scenes
      // The session will be cleaned up at the end of the campaign
      console.error('[recordScene] Error creating page in Steel context:', error);
      throw error;
    }

  } else {
    // ===== LOCAL CHROMIUM PATH (EXISTING) =====
    console.log('[recordScene] Using local Chromium');
    browser = await chromium.launch({
      headless: true,
      args: [
        `--window-size=${w},${h}`,
        '--force-device-scale-factor=1',
        '--disable-renderer-backgrounding',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-frame-rate-limit',
        '--disable-gpu-vsync',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    context = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      recordVideo: { dir: sceneDir, size: { width: w, height: h } }
    });

    page = await context.newPage();
    video = await page.video();
  }

  // Apply actions within the scene duration
  let remaining = toMs(scene.durationSec);
  const consume = v => { remaining = Math.max(0, remaining - v); };

  // Get max wait time (scene override or global default)
  const maxWaitMs = scene.pageLoadWaitMs !== undefined ? scene.pageLoadWaitMs : (ctx.pageLoadWaitMs || 7000);

  // ALWAYS navigate first - even if actions include goto, we need page loaded before recording
  const normalizedUrl = normalizeUrl(scene.url);

  if (useSteel) {
    // Navigate directly to target URL (mask will cover initial resize frames)
    console.log(`[recordScene] Navigating to ${normalizedUrl}...`);

    await page.goto(normalizedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    console.log(`[recordScene] Navigation to DOM complete`);

    // Wait for viewport to stabilize after navigation
    await waitViewportStable(page, w, h, /*stableMs*/ 1000, /*poll*/ 100, /*timeout*/ 10000);

    // Wait for page to be fully ready (including 'load' event for third-party scripts)
    await page.waitForLoadState('load').catch(() => {});
    console.log(`[recordScene] 'load' event complete`);

    // Extended wait for third-party embeds (Calendly, etc.)
    await Promise.race([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.waitForTimeout(5000) // Extended from 2s to 5s for embed loading
    ]);
    console.log(`[recordScene] Network idle or 5s timeout reached`);

    // Remove mask to reveal the page content
    await hideMask(page);
    console.log(`[recordScene] Mask removed`);

    // Additional wait after mask removal for lazy-loaded content to trigger
    const embedWaitMs = Number(process.env.STEEL_EMBED_WAIT_MS || 3000);
    console.log(`[recordScene] Waiting ${embedWaitMs}ms for lazy-loaded embeds...`);
    await page.waitForTimeout(embedWaitMs);
    console.log(`[recordScene] Page fully ready with embeds`);

  } else {
    // Local Chromium path - no mask needed
    console.log(`[recordScene] Navigating to ${normalizedUrl}${scene.url !== normalizedUrl ? ` (normalized from: ${scene.url})` : ''}...`);

    await page.goto(normalizedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    console.log(`[recordScene] Navigation to DOM complete`);

    // Wait for page to be visually ready
    console.log(`[recordScene] Waiting for page to be visually ready (max ${maxWaitMs}ms)...`);
    await Promise.race([
      waitForPageReady(page, maxWaitMs).catch(() => {}),
      page.waitForTimeout(4000) // hard cap to prevent hanging
    ]);
  }

  // Record for LONGER than scene.durationSec to ensure we have enough content after trim
  // Add 15s buffer to account for slow-loading pages (video-layer trim will find actual start)
  const recordDurationSec = scene.durationSec + 15;
  console.log(`[recordScene] Recording ${recordDurationSec}s (${scene.durationSec}s content + 15s buffer for slow pages)...`);

  // CHECK IF SCENE HAS ACTIONS OR SHOULD USE HME
  if (!scene.actions || scene.actions.length === 0) {
    // Use Human Motion Engine v2 for natural behavior
    console.log(`[recordScene] Using Human Motion Engine v2 (no actions defined)...`);

    if (useSteel) {
      await waitIfResizing(page, w, h);
    }

    // HME handles exact timing, so we record for the actual scene duration
    // (not recordDurationSec which has buffer - HME doesn't need it)
    await HME.runScene(page, {
      url: scene.url,
      durationSec: scene.durationSec
    });

    // After HME completes, record buffer time (15s) for safety
    const bufferSec = 15;
    console.log(`[recordScene] Recording ${bufferSec}s buffer after HME...`);
    await page.waitForTimeout(toMs(bufferSec));
  } else {
    // MANUAL ACTION SYSTEM
    console.log(`[recordScene] Using manual action system...`);

    // Adjust remaining time to include buffer
    remaining = toMs(recordDurationSec);

    for (const action of (scene.actions || [])) {
      if (remaining <= 0) break;
      switch (action.type) {
        case 'goto':
          // Skip - we already navigated before starting recorder
          console.log('[recordScene] Skipping goto action (already navigated)');
          break;
        case 'wait': await doWait(page, action.ms || 1000); consume(action.ms || 1000); break;
        case 'clickText': await doClickText(page, action.text || ''); consume(800); break;
        case 'highlight': await doHighlight(page, action.text || '', action.ms || 2000); consume(action.ms || 2000); break;
        case 'scroll': {
          if (useSteel) {
            await waitIfResizing(page, w, h);
          }
          const ms = Math.max(1000, Math.min(remaining - 300, action.ms || remaining - 300));
          await doScroll(page, action.pattern || 'slow-drift', ms);
          consume(ms);
          break;
        }
        default: break;
      }
    }

    // Fill the rest of the scene
    if (remaining > 0) {
      console.log(`[recordScene] Waiting ${remaining}ms to fill buffer time...`);
      await page.waitForTimeout(remaining);
      console.log(`[recordScene] Buffer wait complete`);
    } else {
      console.log(`[recordScene] No remaining time to wait (remaining=${remaining}ms)`);
    }
  }

  console.log(`[recordScene] Scene recording complete, closing context and browser...`);

  try {
    let finalVideoPath;

    if (useSteel) {
      // Get video from Playwright's built-in recording
      const video = page.video();

      // Close only the page - Do NOT close context or browser (they're shared across scenes)
      await page.close();
      console.log('[recordScene] Page closed');

      // Get the video path after page closes
      const webmPath = await video.path();
      console.log(`[recordScene] Video saved to: ${webmPath}`);

      // Wait a moment for file to be fully written
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check the video file exists
      if (!fs.existsSync(webmPath)) {
        throw new Error(`Video not found at ${webmPath}`);
      }

      const stats = fs.statSync(webmPath);
      if (stats.size === 0) {
        throw new Error(`Video is empty: ${webmPath}`);
      }
      console.log(`[recordScene] Video file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      finalVideoPath = webmPath;

    } else {
      // ===== LOCAL CHROMIUM CLEANUP (EXISTING) =====
      await context.close(); // this finalizes the .webm
      await browser.close();

      const webmPath = await video.path();
      console.log(`[recordScene] Video saved to: ${webmPath}`);

      // Verify the video file actually exists
      if (!fs.existsSync(webmPath)) {
        throw new Error(`Video file not found at path: ${webmPath}`);
      }

      // Check file size to ensure it's not empty
      const stats = fs.statSync(webmPath);
      if (stats.size === 0) {
        throw new Error(`Video file is empty: ${webmPath}`);
      }
      console.log(`[recordScene] Video file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      // Give it a friendly name in the same folder
      const niceName = path.join(sceneDir, `${scene.id}.webm`);
      if (webmPath !== niceName) {
        fs.renameSync(webmPath, niceName);
        console.log(`[recordScene] Video renamed to: ${niceName}`);
      }

      finalVideoPath = niceName;
    }

    console.log(`[recordScene] Scene ${scene.id} saved successfully`);
    return { videoPath: finalVideoPath };

  } catch (error) {
    // Ensure Steel session cleanup on error
    if (useSteel && steelSessionId) {
      const { releaseSteelSession } = require('../providers/steel');
      await releaseSteelSession({
        client: steelClient,
        apiKey: process.env.STEEL_API_KEY,
        sessionId: steelSessionId
      }).catch(() => {}); // Ignore cleanup errors
    }

    console.error(`[recordScene] Error processing video:`, error.message);
    throw new Error(`Failed to save video for scene ${scene.id}: ${error.message}`);
  }
}

module.exports = { recordScene };
