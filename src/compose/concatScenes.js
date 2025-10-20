const fs = require('fs');
const path = require('path');
const { ffmpeg } = require('../utils/ffmpeg');

async function concatScenes(mp4List, ctx) {
  const listPath = path.join(ctx.workDir, 'concat.txt');
  fs.writeFileSync(listPath, mp4List.map(p => `file '${p.replace(/'/g,"'\\''")}'`).join('\n'), 'utf8');
  const out = path.join(ctx.workDir, 'bg.mp4');
  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-r', String(ctx.fps),
    out
  ]);
  return out;
}

module.exports = { concatScenes };
