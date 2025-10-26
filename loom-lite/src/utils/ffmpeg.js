const path = require('path');
const { execFile } = require('./exec');

async function ensureFfmpeg() {
  await execFile('ffmpeg', ['-version']).catch(() => {
    throw new Error('FFmpeg not found on PATH. Please install ffmpeg & ffprobe.');
  });
  await execFile('ffprobe', ['-version']).catch(() => {
    throw new Error('ffprobe not found on PATH. Please install ffprobe (part of FFmpeg).');
  });
}

async function ffprobeJson(file) {
  const { stdout } = await execFile('ffprobe', [
    '-v','error','-show_entries','stream=width,height,avg_frame_rate,duration,codec_name,codec_type,channels,sample_rate',
    '-show_format','-of','json', file
  ]);
  return JSON.parse(stdout);
}

async function ffmpeg(args, opts = {}) {
  return execFile('ffmpeg', ['-y', ...args], opts);
}

module.exports = { ensureFfmpeg, ffprobeJson, ffmpeg };
