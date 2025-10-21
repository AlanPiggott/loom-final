const { spawn } = require('child_process');

/**
 * Analyzes a recorded video to detect the first significant frame change
 * Uses FFmpeg's scene detection to find when actual content appears
 * Works for both light and dark themed pages
 *
 * @param {string} videoPath - Path to the recorded webm file
 * @returns {Promise<number>} - Timestamp in milliseconds where content starts
 */
async function detectWhiteLeadIn(videoPath) {
  return new Promise((resolve, reject) => {
    // Use scene detection to find first major visual change
    // This works regardless of whether the initial screen is white, dark, or colored
    const args = [
      '-hide_banner',
      '-i', videoPath,
      '-vf', 'fps=10,scale=320:-1,select=\'gt(scene,0.3)\',showinfo',
      '-vsync', 'vfr',
      '-f', 'null',
      '-'
    ];

    const ffmpeg = spawn('ffmpeg', args);
    let stderrOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0 && code !== null) {
        return reject(new Error(`FFmpeg detectWhiteLeadIn exited with code ${code}`));
      }

      // Parse stderr for first showinfo output (first frame after scene change)
      // Looking for: pts_time:1.234
      const ptsTimeRegex = /pts_time:(\d+\.?\d*)/;
      const matches = stderrOutput.match(ptsTimeRegex);

      if (matches && matches[1]) {
        const contentStartSec = parseFloat(matches[1]);
        const trimMs = Math.round(contentStartSec * 1000);

        console.log(`[detectWhiteLeadIn] Content start detected at ${contentStartSec.toFixed(3)}s (${trimMs}ms) via scene change`);
        resolve(trimMs);
      } else {
        // No significant scene change detected - page might load instantly
        console.log(`[detectWhiteLeadIn] No scene change detected, using minimal trim (500ms)`);
        resolve(500);
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

module.exports = { detectWhiteLeadIn };
