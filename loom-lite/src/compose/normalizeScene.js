const path = require('path');
const { ffmpeg, ffprobeJson } = require('../utils/ffmpeg');
const { detectWhiteLeadIn } = require('../utils/detectWhiteLeadIn');

async function normalizeScene(inputWebm, ctx, scene) {
  const out = path.join(ctx.workDir, `${scene.id}.mp4`);

  // Analyze the recorded video to detect where white/blank lead-in ends
  console.log(`[normalizeScene] Analyzing video to detect white lead-in for scene ${scene.id}...`);
  const trimDurationMs = await detectWhiteLeadIn(inputWebm);
  const trimStartSec = trimDurationMs / 1000;

  console.log(`[normalizeScene] Trimming first ${trimStartSec.toFixed(3)}s from scene ${scene.id} (content-driven detection)`);
  console.log(`[normalizeScene] Output duration: ${scene.durationSec}s of clean content`);

  // Frame-accurate seeking: -ss AFTER -i for precise frame positioning
  const ffmpegArgs = [
    '-i', inputWebm,
    '-ss', String(trimStartSec), // Skip white lead-in (frame-accurate when after -i)
    '-frames:v', String(Math.round(scene.durationSec * ctx.fps)), // Output exact frame count for precise duration
    '-r', String(ctx.fps),
    '-vf', `scale=${ctx.w}:${ctx.h},setsar=1`,
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-an',
    out
  ];

  await ffmpeg(ffmpegArgs);

  // sanity log
  const meta = await ffprobeJson(out);
  if (meta.streams?.[0]?.width !== ctx.w || meta.streams?.[0]?.height !== ctx.h) {
    throw new Error(`Normalized scene not ${ctx.w}x${ctx.h}: ${out}`);
  }

  const actualDuration = parseFloat(meta.format?.duration || '0');
  console.log(`[normalizeScene] Scene ${scene.id} final duration: ${actualDuration.toFixed(2)}s (target: ${scene.durationSec}s)`);

  return out;
}

module.exports = { normalizeScene };
