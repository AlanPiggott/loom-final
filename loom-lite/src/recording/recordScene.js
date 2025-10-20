const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { doGoto, doWait, doClickText, doHighlight, doScroll } = require('./actions');
const { retryWithBackoff } = require('../utils/retryWithBackoff');
const { HumanMotionEngine } = require('./humanMotion');
const { introSettle, idle } = require('./motionBeats');

function toMs(sec) { return Math.max(0, Math.floor(sec * 1000)); }

// Browserless.io API key - REQUIRED environment variable
const BROWSERLESS_API_KEY = process.env.BROWSERLESS_API_KEY || '2TGiNxRQiIe1Ujqc0a9b59a0a1936d8893b70fec46d01c4ab';
if (!BROWSERLESS_API_KEY) {
  throw new Error('BROWSERLESS_API_KEY environment variable is required');
}

async function recordScene(scene, ctx) {
  const { w, h, fps, workDir } = ctx;
  const sceneDir = path.join(workDir);
  if (!fs.existsSync(sceneDir)) fs.mkdirSync(sceneDir, { recursive: true });

  // Properly format launch arguments for browserless.io v2 API
  const launchArgs = {
    headless: true,
    args: [
      `--window-size=${w},${h}`,
      '--force-device-scale-factor=1',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled', // Anti-detection
      '--disable-dev-shm-usage', // Prevent shared memory issues
      '--no-sandbox' // Required for cloud environments
    ]
  };

  // Use v2 API format with JSON-encoded launch parameter
  const browserlessUrl = `wss://production-sfo.browserless.io?token=${BROWSERLESS_API_KEY}&launch=${encodeURIComponent(JSON.stringify(launchArgs))}`;

  console.log(`[recordScene] Connecting to browserless.io for scene: ${scene.id} (${w}x${h})`);

  // Wrap browserless.io connection in retry logic to handle rate limiting
  const browser = await retryWithBackoff(async () => {
    // Use connectOverCDP for better compatibility with Playwright
    const browserInstance = await chromium.connectOverCDP(browserlessUrl, {
      timeout: 60000 // 60 second timeout for connection
    });
    console.log(`[recordScene] Connected successfully to browserless.io via CDP`);
    return browserInstance;
  }, {
    // Retry all errors (including 429 rate limiting)
    shouldRetry: (error) => {
      // Retry on all errors - the retryWithBackoff utility handles logging
      return true;
    }
  });

  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    recordVideo: { dir: sceneDir, size: { width: w, height: h } }
  });
  console.log(`[recordScene] Browser context created with viewport ${w}x${h}, recording to: ${sceneDir}`);

  const page = await context.newPage();
  const video = await page.video();

  // Initialize Human Motion Engine for realistic cursor behavior
  const seed = scene.id ? scene.id.split('-').reduce((acc, part) => acc + part.charCodeAt(0), 0) : Date.now();
  const hme = new HumanMotionEngine(seed, 'trackpad');
  await hme.init(page);
  console.log('[recordScene] Human Motion Engine initialized');

  // Apply actions within the scene duration
  let remaining = toMs(scene.durationSec);
  const consume = v => { remaining = Math.max(0, remaining - v); };

  // Always goto first (or if action list doesn't include it)
  if (!scene.actions?.length || scene.actions[0]?.type !== 'goto') {
    await doGoto(page, scene.url, hme); consume(1500);
  }

  // Intro settle - cursor enters naturally
  if (remaining > 1200) {
    const elapsed = await introSettle(hme, page);
    consume(elapsed);
  }

  for (const action of (scene.actions || [])) {
    if (remaining <= 0) break;
    switch (action.type) {
      case 'goto': await doGoto(page, scene.url, hme); consume(1500); break;
      case 'wait': await doWait(page, action.ms || 1000); consume(action.ms || 1000); break;
      case 'clickText': await doClickText(page, action.text || '', hme); consume(800); break;
      case 'highlight': await doHighlight(page, action.text || '', action.ms || 2000, hme); consume(action.ms || 2000); break;
      case 'scroll': {
        const ms = Math.max(1000, Math.min(remaining - 300, action.ms || remaining - 300));
        await doScroll(page, action.pattern || 'slow-drift', ms, hme);
        consume(ms);
        break;
      }
      default: break;
    }
  }

  // Fill the rest of the scene with intelligent idle motion
  if (remaining > 1000) {
    const elapsed = await idle(hme, page, remaining);
    consume(elapsed);
  } else if (remaining > 0) {
    await page.waitForTimeout(remaining);
  }

  console.log(`[recordScene] Scene recording complete, closing context and browser...`);
  await context.close(); // this finalizes the .webm and downloads it from browserless.io
  await browser.close();

  // Download and validate video file
  try {
    const webmPath = await video.path();
    console.log(`[recordScene] Video downloaded from browserless.io to: ${webmPath}`);

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
    return niceName;
  } catch (error) {
    console.error(`[recordScene] Error processing video:`, error.message);
    throw new Error(`Failed to save video for scene ${scene.id}: ${error.message}`);
  }
}

module.exports = { recordScene };
