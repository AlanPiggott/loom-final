const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureFfmpeg, ffprobeJson } = require('../utils/ffmpeg');
const { recordScene } = require('../recording/recordScene');
const { normalizeScene } = require('../compose/normalizeScene');
const { concatScenes } = require('../compose/concatScenes');
const { overlayFacecam } = require('../compose/overlayFacecam');
const { makeThumbnail } = require('../compose/thumbnail');

/**
 * Generate cache key from scene URL
 */
function getCacheKey(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

/**
 * Retry scene recording with exponential backoff
 */
async function retrySceneRecording(scene, ctx, maxAttempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[renderCampaign] Recording ${scene.url} (attempt ${attempt}/${maxAttempts})...`);
      const result = await recordScene(scene, ctx);
      console.log(`[renderCampaign] Successfully recorded ${scene.url}`);
      return result;
    } catch (error) {
      lastError = error;
      console.error(`[renderCampaign] Attempt ${attempt}/${maxAttempts} failed for ${scene.url}:`, error.message);

      if (attempt < maxAttempts) {
        const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        console.log(`[renderCampaign] Retrying in ${delayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(`Failed to record scene ${scene.id} (${scene.url}) after ${maxAttempts} attempts: ${lastError.message}`);
}

async function renderCampaign(configPathOrObj) {
  await ensureFfmpeg();

  let cfg, baseDir;
  if (typeof configPathOrObj === 'string') {
    const abs = path.resolve(configPathOrObj);
    cfg = JSON.parse(fs.readFileSync(abs, 'utf8'));
    baseDir = path.dirname(abs);
  } else {
    cfg = configPathOrObj;
    baseDir = cfg.__baseDir;
  }

  const workDir = path.join(baseDir, 'work');
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  // Create cache directory for reusable scene recordings
  const cacheDir = path.join(baseDir, 'cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const ctx = {
    w: cfg.output.width || 1920,
    h: cfg.output.height || 1080,
    fps: cfg.output.fps || 30,
    pageLoadWaitMs: cfg.output.pageLoadWaitMs !== undefined ? cfg.output.pageLoadWaitMs : 7000,
    workDir,
    cacheDir
  };

  // Sanity for facecam path
  cfg.output.facecam.path = path.isAbsolute(cfg.output.facecam.path)
    ? cfg.output.facecam.path
    : path.join(baseDir, cfg.output.facecam.path);

  // Validate duration matching: sum(scenes) must equal facecam duration
  console.log('[renderCampaign] Validating duration matching...');
  const facecamMeta = await ffprobeJson(cfg.output.facecam.path);
  const facecamDur = Math.floor(parseFloat(facecamMeta.format?.duration || '0'));
  const scenesTotalDur = cfg.scenes.reduce((sum, s) => sum + (s.durationSec || 0), 0);

  console.log(`[renderCampaign] Facecam duration: ${facecamDur}s, Scenes total: ${scenesTotalDur}s`);

  if (scenesTotalDur !== facecamDur) {
    const errorMsg = `Duration mismatch: Scenes total ${scenesTotalDur}s must equal facecam ${facecamDur}s. ` +
                     `Adjust durations or use Auto-fill.`;
    console.error(`[renderCampaign] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  console.log('[renderCampaign] ✓ Duration validation passed');

  // 1) Record scenes (with caching)
  // Fail entire render if ANY scene fails after retries
  // Cache only raw webm; trim is always recomputed from video content
  const normalized = [];
  try {
    for (const s of cfg.scenes) {
      const cacheKey = getCacheKey(s.url);
      const cachedWebm = path.join(cacheDir, `${cacheKey}.webm`);

      let videoPath;

      // Check if we have a cached recording for this URL
      if (fs.existsSync(cachedWebm)) {
        console.log(`[renderCampaign] Using cached recording for ${s.url}`);

        // Copy cached webm to work directory for this scene
        const workWebm = path.join(workDir, `${s.id}.webm`);
        fs.copyFileSync(cachedWebm, workWebm);
        videoPath = workWebm;
        console.log(`[renderCampaign] Copied from cache (trim will be recomputed from video)`);
      } else {
        console.log(`[renderCampaign] Recording ${s.url} (will be cached for future use)`);
        const result = await retrySceneRecording(s, ctx);
        videoPath = result.videoPath;

        // Save to cache for future renders (webm only, no metadata)
        fs.copyFileSync(videoPath, cachedWebm);
        console.log(`[renderCampaign] Saved to cache for future reuse`);
      }

      // normalizeScene will auto-detect trim from video content
      const mp4 = await normalizeScene(videoPath, ctx, s);
      normalized.push(mp4);
    }
  } catch (error) {
    throw new Error(`Video render aborted - scene recording failed: ${error.message}`);
  }

  // 2) Concat bg
  const bg = await concatScenes(normalized, ctx);

  // 3) Overlay facecam with audio
  // No trimming needed - scenes are already trimmed individually in normalizeScene
  const final = await overlayFacecam(bg, cfg.output.facecam, ctx, 0);

  // 4) Poster
  const poster = await makeThumbnail(final, 3);

  // Probe final
  const meta = await ffprobeJson(final);

  return { final, poster, meta };
}

// CLI usage: node src/pipeline/renderCampaign.js campaigns/sample/config.json
if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node src/pipeline/renderCampaign.js <config.json>');
    process.exit(1);
  }
  renderCampaign(arg)
    .then(o => {
      console.log('Rendered:', o.final);
      console.log('Poster:', o.poster);
      process.exit(0);
    })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { renderCampaign };
