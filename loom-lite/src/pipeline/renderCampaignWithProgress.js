const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureFfmpeg, ffprobeJson } = require('../utils/ffmpeg');
const { recordScene } = require('../recording/recordScene');
const { normalizeScene } = require('../compose/normalizeScene');
const { concatScenes } = require('../compose/concatScenes');
const { overlayFacecam } = require('../compose/overlayFacecam');
const { makeThumbnail } = require('../compose/thumbnail');
const { logSection, logStep } = require('../instrumentation');

/**
 * Generate cache key from scene metadata
 */
function getCacheKey(scene, ctx) {
  const seedParts = [
    ctx.cacheNamespace || '',
    scene.cacheKeySalt || '',
    scene.url,
    scene.entryType || 'manual',
  ]
    .filter(Boolean)
    .join('|');

  return crypto.createHash('md5').update(seedParts).digest('hex');
}

/**
 * Retry scene recording with exponential backoff
 */
async function retrySceneRecording(scene, ctx, maxAttempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logStep('recordScene:attempt', { url: scene.url, attempt, maxAttempts });
      const result = await recordScene(scene, ctx);
      logStep('recordScene:success', { url: scene.url, attempt });
      return result;
    } catch (error) {
      lastError = error;
      console.error(`[renderCampaign] Attempt ${attempt}/${maxAttempts} failed for ${scene.url}:`, error.message);

      if (attempt < maxAttempts) {
        const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        logStep('recordScene:retryDelay', { delayMs, attempt });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(`Failed to record scene ${scene.id} (${scene.url}) after ${maxAttempts} attempts: ${lastError.message}`);
}

/**
 * Render campaign with progress callbacks
 * @param {Object} configPathOrObj - Campaign configuration
 * @param {Function} onProgress - Progress callback function(status, progress)
 */
async function renderCampaignWithProgress(configPathOrObj, onProgress = () => {}) {
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

  logSection('renderCampaignWithProgress:start', {
    baseDir,
    sceneCount: cfg.scenes?.length || 0,
    output: cfg.output,
    cacheNamespace: cfg.cacheNamespace || null,
  });

  // Create cache directory for reusable scene recordings
  const cacheDir = path.join(baseDir, 'cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const ctx = {
    w: cfg.output.width || 1920,
    h: cfg.output.height || 1080,
    fps: cfg.output.fps || 60,
    pageLoadWaitMs: cfg.output.pageLoadWaitMs !== undefined ? cfg.output.pageLoadWaitMs : 7000,
    workDir,
    cacheDir,
    cacheNamespace: cfg.cacheNamespace || null,
  };

  // Sanity for facecam path (if provided)
  if (cfg.output.facecam?.path) {
    cfg.output.facecam.path = path.isAbsolute(cfg.output.facecam.path)
      ? cfg.output.facecam.path
      : path.join(baseDir, cfg.output.facecam.path);

    // Validate duration matching: sum(scenes) must equal facecam duration
    logStep('renderCampaign:durationValidation:start');
    const facecamMeta = await ffprobeJson(cfg.output.facecam.path);
    const facecamDur = Math.floor(parseFloat(facecamMeta.format?.duration || '0'));
    const scenesTotalDur = cfg.scenes.reduce((sum, s) => sum + (s.durationSec || 0), 0);
    logStep('renderCampaign:durationValidation:data', { facecamDur, scenesTotalDur });

    if (scenesTotalDur !== facecamDur) {
      const errorMsg = `Duration mismatch: Scenes total ${scenesTotalDur}s must equal facecam ${facecamDur}s. ` +
                       `Adjust durations or use Auto-fill.`;
      console.error(`[renderCampaign] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    logStep('renderCampaign:durationValidation:passed');
  }

  // Enforce maximum campaign duration of 5 minutes
  const scenesTotalDur = cfg.scenes.reduce((sum, s) => sum + (s.durationSec || 0), 0);
  const MAX_CAMPAIGN_DURATION_SEC = 300; // 5 minutes
  if (scenesTotalDur > MAX_CAMPAIGN_DURATION_SEC) {
    const errorMsg = `Campaign too long: ${scenesTotalDur}s exceeds maximum ${MAX_CAMPAIGN_DURATION_SEC}s (5 minutes). ` +
                     `Reduce scene durations or number of scenes.`;
    console.error(`[renderCampaign] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  logStep('renderCampaign:campaignDuration:ok', { scenesTotalDur, MAX_CAMPAIGN_DURATION_SEC });

  // 1) Record scenes (with caching)
  // Progress: 10-40% (30% of total progress for recording)
  onProgress('recording', 10);

  const normalized = [];
  const progressPerScene = 30 / cfg.scenes.length; // Distribute 30% progress across scenes

  try {
    for (let i = 0; i < cfg.scenes.length; i++) {
      const s = cfg.scenes[i];
      s.isFirstScene = (i === 0); // Flag first scene for special scroll behavior
      const cacheKey = getCacheKey(s, ctx);
      logStep('recordScene:start', {
        index: i,
        sceneId: s.id,
        url: s.url,
        cacheKey,
        cacheNamespace: ctx.cacheNamespace,
      });
      const cachedWebm = path.join(cacheDir, `${cacheKey}.webm`);
      const cachedMeta = path.join(cacheDir, `${cacheKey}.json`);

      let videoPath;
      let trimHintMs = null;

      // Update progress for this scene
      const sceneProgress = 10 + (i * progressPerScene);
      onProgress('recording', Math.round(sceneProgress));

      // Check if we have a cached recording for this URL
      if (fs.existsSync(cachedWebm)) {
        logStep('recordScene:cacheHit', { cacheKey, cachedWebm });

        // Validate cached recording before using it
        let cacheValid = false;
        try {
          const cachedMeta_probe = await ffprobeJson(cachedWebm);
          const cachedDuration = parseFloat(cachedMeta_probe.format?.duration || '0');
          const minExpectedDuration = Math.min(2, s.durationSec * 0.2); // At least 2s or 20% of expected

          if (cachedDuration >= minExpectedDuration && cachedMeta_probe.streams?.length > 0) {
            cacheValid = true;
            logStep('recordScene:cacheValidated', { cacheKey, cachedDuration, minExpectedDuration });
          } else {
            console.warn(`[renderCampaign] Cached recording invalid for ${s.id}: ${cachedDuration.toFixed(2)}s < ${minExpectedDuration.toFixed(2)}s`);
            logStep('recordScene:cacheInvalid', { cacheKey, cachedDuration, minExpectedDuration });
          }
        } catch (err) {
          console.warn(`[renderCampaign] Failed to validate cache for ${s.id}:`, err.message);
          logStep('recordScene:cacheValidationError', { cacheKey, error: err.message });
        }

        if (cacheValid) {
          // Copy cached webm to work directory for this scene
          const workWebm = path.join(workDir, `${s.id}.webm`);
          fs.copyFileSync(cachedWebm, workWebm);
          videoPath = workWebm;
          logStep('recordScene:cacheCopy', { cacheKey, trimHintMs });

          if (fs.existsSync(cachedMeta)) {
            try {
              const meta = JSON.parse(fs.readFileSync(cachedMeta, 'utf8'));
              if (Number.isFinite(meta.trimHintMs)) {
                trimHintMs = Math.max(0, Math.round(meta.trimHintMs));
              }
            } catch (err) {
              console.warn(`[renderCampaign] Failed to read cached metadata ${cachedMeta}:`, err.message);
            }
          }
        } else {
          // Cache invalid - delete it and record fresh
          console.warn(`[renderCampaign] Deleting invalid cache for ${s.id}`);
          try {
            fs.unlinkSync(cachedWebm);
            if (fs.existsSync(cachedMeta)) fs.unlinkSync(cachedMeta);
          } catch (err) {
            console.warn(`[renderCampaign] Failed to delete invalid cache:`, err.message);
          }
          logStep('recordScene:cacheDeleted', { cacheKey });

          // Fall through to cache miss logic
          logStep('recordScene:cacheMiss', { cacheKey, reason: 'invalid' });
          const result = await retrySceneRecording(s, ctx);
          videoPath = result.videoPath;
          trimHintMs = Number.isFinite(result.trimHintMs) ? Math.max(0, Math.round(result.trimHintMs)) : null;

          // Save to cache for future renders
          fs.copyFileSync(videoPath, cachedWebm);
          logStep('recordScene:cacheStore', { cacheKey, trimHintMs });

          try {
            fs.writeFileSync(cachedMeta, JSON.stringify({ trimHintMs }, null, 2));
          } catch (err) {
            console.warn(`[renderCampaign] Failed to write cache metadata ${cachedMeta}:`, err.message);
          }
        }
      } else {
        logStep('recordScene:cacheMiss', { cacheKey });
        const result = await retrySceneRecording(s, ctx);
        videoPath = result.videoPath;
        trimHintMs = Number.isFinite(result.trimHintMs) ? Math.max(0, Math.round(result.trimHintMs)) : null;

        // Save to cache for future renders (webm only, no metadata)
        fs.copyFileSync(videoPath, cachedWebm);
        logStep('recordScene:cacheStore', { cacheKey, trimHintMs });

        try {
          fs.writeFileSync(cachedMeta, JSON.stringify({ trimHintMs }, null, 2));
        } catch (err) {
          console.warn(`[renderCampaign] Failed to write cache metadata ${cachedMeta}:`, err.message);
        }
      }

      s.trimHintMs = trimHintMs;

      // normalizeScene will auto-detect trim from video content
      const mp4 = await normalizeScene(videoPath, ctx, s);
      logStep('normalizeScene:done', {
        sceneId: s.id,
        mp4,
        trimHintMs,
      });
      normalized.push(mp4);
    }
  } catch (error) {
    throw new Error(`Video render aborted - scene recording failed: ${error.message}`);
  }

  // 2) Normalizing scenes (40-60%)
  onProgress('normalizing', 50);
  logStep('renderCampaign:normalize:complete', { count: normalized.length });

  // 3) Concat bg (60-70%)
  onProgress('concatenating', 60);
  const bg = await concatScenes(normalized, ctx);
  logStep('renderCampaign:concat:complete', { output: bg });
  onProgress('concatenating', 70);

  // 4) Overlay facecam with audio (70-80%)
  let final;
  if (cfg.output.facecam?.path && fs.existsSync(cfg.output.facecam.path)) {
    onProgress('overlaying', 70);
    final = await overlayFacecam(bg, cfg.output.facecam, ctx, 0);
    logStep('renderCampaign:overlay:complete', { output: final });
    onProgress('overlaying', 80);
  } else {
    logStep('renderCampaign:overlay:skipped');
    final = bg;
    onProgress('overlaying', 80);
  }

  // 5) Create poster/thumbnail (80-85%)
  onProgress('creating_thumbnail', 80);
  const poster = await makeThumbnail(final, 3);
  logStep('renderCampaign:thumbnail:complete', { poster });
  onProgress('creating_thumbnail', 85);

  // Probe final
  const meta = await ffprobeJson(final);
  logSection('renderCampaignWithProgress:complete', { final, poster, meta });

  return { final, poster, meta };
}

module.exports = { renderCampaignWithProgress };
