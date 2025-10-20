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

  // Path to rounded square mask
  const maskPath = path.join(__dirname, '../assets/masks/rounded_square.png');

  const bgMeta = await ffprobeJson(bgPath);
  const bgDur = parseFloat(bgMeta.format?.duration || '0');

  const faceMeta = await ffprobeJson(faceCfg.path);
  const faceDur = parseFloat(faceMeta.format?.duration || '0');

  // Check if facecam has audio stream
  const faceHasAudio = faceMeta.streams?.some(s => s.codec_type === 'audio');
  console.log(`[overlayFacecam] Facecam has audio: ${faceHasAudio}`);

  const needPadSec = Math.max(0, bgDur - faceDur);
  const startOffset = Math.max(0, faceCfg.startOffsetSec || 0);

  const vPad = (faceCfg.endPadMode === 'freeze' && needPadSec > 0)
    ? `,tpad=stop_mode=clone:stop_duration=${needPadSec}`
    : '';

  const vDelay = startOffset > 0
    ? `,tpad=start_mode=clone:start_duration=${startOffset}`
    : '';

  const shadowOffset = 6; // Shadow offset in pixels

  // Build filter based on whether facecam has audio
  let filter, mapArgs;

  if (faceHasAudio) {
    // Facecam has audio - use Loom-style circular overlay with shadow
    const audioChain = startOffset > 0
      ? `[1:a]adelay=${Math.floor(startOffset * 1000)}:all=1,apad[aud];`
      : `[1:a]apad[aud];`;

    filter = [
      // Step 1: Prepare facecam - crop to square, scale, format RGBA
      `[1:v]setpts=PTS-STARTPTS${vDelay},crop='min(iw,ih)':'min(iw,ih)':(iw-ow)/2:(ih-oh)/2,scale=${pipW}:${pipW}${vPad},format=rgba[cam_raw];`,

      // Step 2: Load and scale mask to match PiP size, split for cam and shadow
      `[2:v]scale=${pipW}:${pipW},format=gray,split[mask1][mask2];`,

      // Step 3: Apply mask to create rounded facecam
      `[cam_raw][mask1]alphamerge[cam];`,

      // Step 4: Create shadow - black color with mask, blurred
      `color=c=black:s=${pipW}x${pipW}:d=${bgDur},format=rgba[black];`,
      `[black][mask2]alphamerge,boxblur=12,colorchannelmixer=aa=0.4[shadow];`,

      // Step 5: Audio chain
      audioChain,

      // Step 6: Overlay shadow first (offset), then facecam on top
      `[0:v][shadow]overlay=${x}+${shadowOffset}:${y}+${shadowOffset}[bg_shadow];`,
      `[bg_shadow][cam]overlay=${x}:${y}[vout]`
    ].join('');

    mapArgs = ['-map', '[vout]', '-map', '[aud]'];
  } else {
    // Facecam has no audio - Loom-style circular overlay with shadow, use background audio
    filter = [
      // Step 1: Prepare facecam - crop to square, scale, format RGBA
      `[1:v]setpts=PTS-STARTPTS${vDelay},crop='min(iw,ih)':'min(iw,ih)':(iw-ow)/2:(ih-oh)/2,scale=${pipW}:${pipW}${vPad},format=rgba[cam_raw];`,

      // Step 2: Load and scale mask to match PiP size, split for cam and shadow
      `[2:v]scale=${pipW}:${pipW},format=gray,split[mask1][mask2];`,

      // Step 3: Apply mask to create rounded facecam
      `[cam_raw][mask1]alphamerge[cam];`,

      // Step 4: Create shadow - black color with mask, blurred
      `color=c=black:s=${pipW}x${pipW}:d=${bgDur},format=rgba[black];`,
      `[black][mask2]alphamerge,boxblur=12,colorchannelmixer=aa=0.4[shadow];`,

      // Step 5: Overlay shadow first (offset), then facecam on top
      `[0:v][shadow]overlay=${x}+${shadowOffset}:${y}+${shadowOffset}[bg_shadow];`,
      `[bg_shadow][cam]overlay=${x}:${y}[vout]`
    ].join('');

    mapArgs = ['-map', '[vout]', '-map', '0:a?']; // Use background audio if available
  }

  const ffmpegArgs = [
    '-i', bgPath,
    '-i', faceCfg.path,
    '-i', maskPath, // Add mask as 3rd input
    '-filter_complex', filter,
    ...mapArgs,
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1',
    '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-movflags', '+faststart',
    '-shortest',
    out
  ];

  await ffmpeg(ffmpegArgs);

  return out;
}

module.exports = { overlayFacecam };
