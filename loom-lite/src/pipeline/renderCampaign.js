const fs = require('fs');
const path = require('path');
const { ensureFfmpeg, ffprobeJson } = require('../utils/ffmpeg');
const { recordScene } = require('../recording/recordScene');
const { normalizeScene } = require('../compose/normalizeScene');
const { concatScenes } = require('../compose/concatScenes');
const { overlayFacecam } = require('../compose/overlayFacecam');
const { makeThumbnail } = require('../compose/thumbnail');

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

  const ctx = {
    w: cfg.output.width || 1920,
    h: cfg.output.height || 1080,
    fps: cfg.output.fps || 30,
    workDir
  };

  // Sanity for facecam path
  cfg.output.facecam.path = path.isAbsolute(cfg.output.facecam.path)
    ? cfg.output.facecam.path
    : path.join(baseDir, cfg.output.facecam.path);

  // 1) Record scenes
  const normalized = [];
  for (const s of cfg.scenes) {
    const webm = await recordScene(s, ctx);
    const mp4 = await normalizeScene(webm, ctx, s.id);
    normalized.push(mp4);
  }

  // 2) Concat bg
  const bg = await concatScenes(normalized, ctx);

  // 3) Overlay facecam with audio
  const final = await overlayFacecam(bg, cfg.output.facecam, ctx);

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
