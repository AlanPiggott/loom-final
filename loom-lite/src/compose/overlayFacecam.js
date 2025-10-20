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
  const pipW = faceCfg.pip?.width || 230;
  const margin = faceCfg.pip?.margin || 40;
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
  const shadowSize = pipW + 70; // Add padding for blur (300px for 230px facecam)
  const shadowPadding = (shadowSize - pipW) / 2; // 35px on each side

  // Calculate shadow position (shadow is larger, so needs different positioning)
  let shadowX, shadowY;
  switch (corner) {
    case 'top-left':
      shadowX = `${margin - shadowPadding + shadowOffset}`;
      shadowY = `${margin - shadowPadding + shadowOffset}`;
      break;
    case 'top-right':
      shadowX = `W-${shadowSize}-${margin - shadowPadding + shadowOffset}`;
      shadowY = `${margin - shadowPadding + shadowOffset}`;
      break;
    case 'bottom-left':
      shadowX = `${margin - shadowPadding + shadowOffset}`;
      shadowY = `H-${shadowSize}-${margin - shadowPadding + shadowOffset}`;
      break;
    default: // bottom-right
      shadowX = `W-${shadowSize}-${margin - shadowPadding + shadowOffset}`;
      shadowY = `H-${shadowSize}-${margin - shadowPadding + shadowOffset}`;
  }

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

      // Step 2: Load and scale mask to match PiP size, extract alpha as grayscale, split for cam and shadow
      `[2:v]scale=${pipW}:${pipW},format=rgba,alphaextract,split[mask1][mask2];`,

      // Step 3: Apply mask to create rounded facecam
      `[cam_raw][mask1]alphamerge[cam];`,

      // Step 4: Create shadow with larger canvas to avoid clipping blur
      `[mask2]pad=${shadowSize}:${shadowSize}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,boxblur=16[mask_blurred];`,
      `color=c=black:s=${shadowSize}x${shadowSize}:d=${bgDur},format=rgba[black];`,
      `[black][mask_blurred]alphamerge,colorchannelmixer=aa=0.5[shadow];`,

      // Step 5: Audio chain
      audioChain,

      // Step 6: Overlay shadow first (at calculated position), then facecam on top
      `[0:v][shadow]overlay=${shadowX}:${shadowY}[bg_shadow];`,
      `[bg_shadow][cam]overlay=${x}:${y}[vout]`
    ].join('');

    mapArgs = ['-map', '[vout]', '-map', '[aud]'];
  } else {
    // Facecam has no audio - Loom-style circular overlay with shadow, use background audio
    filter = [
      // Step 1: Prepare facecam - crop to square, scale, format RGBA
      `[1:v]setpts=PTS-STARTPTS${vDelay},crop='min(iw,ih)':'min(iw,ih)':(iw-ow)/2:(ih-oh)/2,scale=${pipW}:${pipW}${vPad},format=rgba[cam_raw];`,

      // Step 2: Load and scale mask to match PiP size, extract alpha as grayscale, split for cam and shadow
      `[2:v]scale=${pipW}:${pipW},format=rgba,alphaextract,split[mask1][mask2];`,

      // Step 3: Apply mask to create rounded facecam
      `[cam_raw][mask1]alphamerge[cam];`,

      // Step 4: Create shadow with larger canvas to avoid clipping blur
      `[mask2]pad=${shadowSize}:${shadowSize}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,boxblur=16[mask_blurred];`,
      `color=c=black:s=${shadowSize}x${shadowSize}:d=${bgDur},format=rgba[black];`,
      `[black][mask_blurred]alphamerge,colorchannelmixer=aa=0.5[shadow];`,

      // Step 5: Overlay shadow first (at calculated position), then facecam on top
      `[0:v][shadow]overlay=${shadowX}:${shadowY}[bg_shadow];`,
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
