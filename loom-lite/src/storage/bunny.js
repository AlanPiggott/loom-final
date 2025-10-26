const fs = require('fs');
const axios = require('axios');

const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env: ${key}`);
  }
  return value;
};

const STORAGE_ZONE = requireEnv('BUNNY_STORAGE_ZONE');
const STORAGE_API_KEY = requireEnv('BUNNY_STORAGE_API_KEY');
const CDN_BASE = requireEnv('BUNNY_CDN_BASE_URL').replace(/\/+$/, '');
const STORAGE_ENDPOINT = (process.env.BUNNY_STORAGE_ENDPOINT || 'https://storage.bunnycdn.com').replace(/\/+$/, '');

async function putFileToBunny(localFile, remotePath, contentType) {
  const url = `${STORAGE_ENDPOINT}/${STORAGE_ZONE}/${remotePath}`;
  const stream = fs.createReadStream(localFile);

  const res = await axios.put(url, stream, {
    headers: {
      AccessKey: STORAGE_API_KEY,
      'Content-Type': contentType,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 10 * 60 * 1000,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Bunny upload failed (${res.status}): ${res.statusText}`);
  }
}

async function uploadVideoAndThumb(localVideoPath, localThumbPath, publicId) {
  if (!fs.existsSync(localVideoPath)) {
    throw new Error(`Video not found: ${localVideoPath}`);
  }
  if (!fs.existsSync(localThumbPath)) {
    throw new Error(`Thumb not found: ${localThumbPath}`);
  }

  const videoKey = `renders/videos/${publicId}.mp4`;
  const thumbKey = `renders/thumbs/${publicId}.jpg`;

  await putFileToBunny(localVideoPath, videoKey, 'video/mp4');
  await putFileToBunny(localThumbPath, thumbKey, 'image/jpeg');

  return {
    videoUrl: `${CDN_BASE}/${videoKey}`,
    thumbUrl: `${CDN_BASE}/${thumbKey}`,
  };
}

async function purgeCdnPaths(urls) {
  const PULL_ZONE_ID = process.env.BUNNY_PULL_ZONE_ID;
  const ACCOUNT_API_KEY = process.env.BUNNY_ACCOUNT_API_KEY;

  if (!PULL_ZONE_ID || !ACCOUNT_API_KEY || !Array.isArray(urls) || urls.length === 0) {
    return;
  }

  const res = await axios.post(
    `https://api.bunny.net/pullzone/${PULL_ZONE_ID}/purgeCache`,
    { Urls: urls },
    {
      headers: {
        AccessKey: ACCOUNT_API_KEY,
      },
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Purge failed (${res.status}): ${res.statusText}`);
  }
}

module.exports = {
  uploadVideoAndThumb,
  purgeCdnPaths,
};
