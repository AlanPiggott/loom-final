const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/**
 * Generate a grayscale PNG mask where white = visible and black = transparent.
 * shape: 'rounded' | 'circle' | 'rect'
 */
async function makeMask({ w, h, radius = 32, shape = 'rounded', outPath }) {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(outPath)) return outPath;

  let svg;
  if (shape === 'circle') {
    const r = Math.floor(Math.min(w, h) / 2);
    svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="white"/>
    </svg>`;
  } else if (shape === 'rect') {
    svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${w}" height="${h}" fill="white"/>
    </svg>`;
  } else {
    svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="white"/>
    </svg>`;
  }

  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath);
  return outPath;
}

module.exports = { makeMask };
