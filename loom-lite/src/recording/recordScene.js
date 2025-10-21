const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { doGoto, doWait, doClickText, doHighlight, doScroll } = require('./actions');
const { retryWithBackoff } = require('../utils/retryWithBackoff');
const { normalizeUrl } = require('../utils/urlNormalizer');
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;
const { PNG } = require('pngjs');

function toMs(sec) { return Math.max(0, Math.floor(sec * 1000)); }

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

  // Use local Chromium (recordVideo doesn't work with remote browsers via CDP)
  const browser = await chromium.launch({
    headless: true,
    args: [
      `--window-size=${w},${h}`,
      '--force-device-scale-factor=1',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    recordVideo: { dir: sceneDir, size: { width: w, height: h } }
  });

  const page = await context.newPage();
  const video = await page.video();

  // Apply actions within the scene duration
  let remaining = toMs(scene.durationSec);
  const consume = v => { remaining = Math.max(0, remaining - v); };

  // Get max wait time (scene override or global default)
  const maxWaitMs = scene.pageLoadWaitMs !== undefined ? scene.pageLoadWaitMs : (ctx.pageLoadWaitMs || 7000);

  // Always goto first (or if action list doesn't include it)
  if (!scene.actions?.length || scene.actions[0]?.type !== 'goto') {
    const normalizedUrl = normalizeUrl(scene.url);
    console.log(`[recordScene] Navigating to ${normalizedUrl}${scene.url !== normalizedUrl ? ` (normalized from: ${scene.url})` : ''}...`);
    await page.goto(normalizedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    console.log(`[recordScene] Navigation to DOM complete`);
  }

  // Wait for page to be visually ready
  console.log(`[recordScene] Waiting for page to be visually ready (max ${maxWaitMs}ms)...`);
  await waitForPageReady(page, maxWaitMs);

  // Record for LONGER than scene.durationSec to ensure we have enough content after trim
  // Add 15s buffer to account for slow-loading pages (video-layer trim will find actual start)
  const recordDurationSec = scene.durationSec + 15;
  console.log(`[recordScene] Recording ${recordDurationSec}s (${scene.durationSec}s content + 15s buffer for slow pages)...`);

  // Adjust remaining time to include buffer
  remaining = toMs(recordDurationSec);

  for (const action of (scene.actions || [])) {
    if (remaining <= 0) break;
    switch (action.type) {
      case 'goto':
        const normalizedUrl = normalizeUrl(scene.url);
        await page.goto(normalizedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });
        // Don't consume navigation time
        break;
      case 'wait': await doWait(page, action.ms || 1000); consume(action.ms || 1000); break;
      case 'clickText': await doClickText(page, action.text || ''); consume(800); break;
      case 'highlight': await doHighlight(page, action.text || '', action.ms || 2000); consume(action.ms || 2000); break;
      case 'scroll': {
        const ms = Math.max(1000, Math.min(remaining - 300, action.ms || remaining - 300));
        await doScroll(page, action.pattern || 'slow-drift', ms);
        consume(ms);
        break;
      }
      default: break;
    }
  }

  // Fill the rest of the scene
  if (remaining > 0) await page.waitForTimeout(remaining);

  console.log(`[recordScene] Scene recording complete, closing context and browser...`);
  await context.close(); // this finalizes the .webm
  await browser.close();

  try {
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

    console.log(`[recordScene] Scene ${scene.id} saved successfully`);
    return { videoPath: niceName };
  } catch (error) {
    console.error(`[recordScene] Error processing video:`, error.message);
    throw new Error(`Failed to save video for scene ${scene.id}: ${error.message}`);
  }
}

module.exports = { recordScene };
