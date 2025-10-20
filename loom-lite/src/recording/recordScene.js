const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { doGoto, doWait, doClickText, doHighlight, doScroll } = require('./actions');
const { retryWithBackoff } = require('../utils/retryWithBackoff');

function toMs(sec) { return Math.max(0, Math.floor(sec * 1000)); }

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

  // Always goto first (or if action list doesn't include it)
  if (!scene.actions?.length || scene.actions[0]?.type !== 'goto') {
    await doGoto(page, scene.url); consume(1500);
  }

  for (const action of (scene.actions || [])) {
    if (remaining <= 0) break;
    switch (action.type) {
      case 'goto': await doGoto(page, scene.url); consume(1500); break;
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
    return niceName;
  } catch (error) {
    console.error(`[recordScene] Error processing video:`, error.message);
    throw new Error(`Failed to save video for scene ${scene.id}: ${error.message}`);
  }
}

module.exports = { recordScene };
