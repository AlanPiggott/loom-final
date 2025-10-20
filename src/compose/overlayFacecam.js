const path = require('path');
const { ffmpeg, ffprobeJson } = require('../utils/ffmpeg');

function overlayExpr(corner, margin) {
  const m = margin;
  switch (corner) {
    case 'top-left': return { x: `${m}`, y: `${m}` };
    case 'top-right': return { x: `W-w-${m}`, y: `${m}` };
    case 'bottom-left': return { x: `${m}`, y: `H-h-${m}` };
    default: return { x: `W-w-${m}`, y: `H-h-${m}` }; // bottom-right
  }
}

async function overlayFacecam(bgPath, faceCfg, ctx) {
  const out = path.join(path.dirname(bgPath), '..', 'final.mp4');
  const pipW = faceCfg.pip?.width || 384;
  const margin = faceCfg.pip?.margin || 24;
  const corner = faceCfg.pip?.corner || 'bottom-right';
  const { x, y } = overlayExpr(corner, margin);

  const bgMeta = await ffprobeJson(bgPath);
  const bgDur = parseFloat(bgMeta.format?.duration || '0');

  const faceMeta = await ffprobeJson(faceCfg.path);
  const faceDur = parseFloat(faceMeta.format?.duration || '0');

  const needPadSec = Math.max(0, bgDur - faceDur);
  const startOffset = Math.max(0, faceCfg.startOffsetSec || 0);

  const vPad = (faceCfg.endPadMode === 'freeze' && needPadSec > 0)
    ? `,tpad=stop_mode=clone:stop_duration=${needPadSec}`
    : '';

  const vDelay = startOffset > 0
    ? `,tpad=start_mode=clone:start_duration=${startOffset}`
    : '';

  const audioChain = startOffset > 0
    ? `[1:a]adelay=${Math.floor(startOffset * 1000)}:all=1,apad[aud];`
    : `[1:a]apad[aud];`;

  const filter = [
    `[1:v]setpts=PTS-STARTPTS${vDelay},scale=${pipW}:-1,setsar=1${vPad}[cam];`,
    audioChain,
    `[0:v][cam]overlay=${x}:${y}:eval=frame[vout]`
  ].join('');

  await ffmpeg([
    '-i', bgPath,
    '-i', faceCfg.path,
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '[aud]',
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1',
    '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-movflags', '+faststart',
    '-shortest',
    out
  ]);

  return out;
}

module.exports = { overlayFacecam };
