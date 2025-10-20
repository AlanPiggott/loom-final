const path = require('path');
const { ffmpeg } = require('../utils/ffmpeg');

async function makeThumbnail(finalPath, t = 3) {
  const poster = path.join(path.dirname(finalPath), 'poster.jpg');
  await ffmpeg(['-ss', String(t), '-i', finalPath, '-frames:v', '1', poster]);
  return poster;
}

module.exports = { makeThumbnail };
