const path = require('path');
const { ffmpeg, ffprobeJson } = require('../utils/ffmpeg');

async function normalizeScene(inputWebm, ctx, sceneId) {
  const out = path.join(ctx.workDir, `${sceneId}.mp4`);
  await ffmpeg([
    '-i', inputWebm,
    '-r', String(ctx.fps),
    '-vf', `scale=${ctx.w}:${ctx.h},setsar=1`,
    '-pix_fmt', 'yuv420p',
    '-an',
    out
  ]);
  // sanity log
  const meta = await ffprobeJson(out);
  if (meta.streams?.[0]?.width !== ctx.w || meta.streams?.[0]?.height !== ctx.h) {
    throw new Error(`Normalized scene not ${ctx.w}x${ctx.h}: ${out}`);
  }
  return out;
}

module.exports = { normalizeScene };
