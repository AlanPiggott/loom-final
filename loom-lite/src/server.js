const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { renderCampaign } = require('./pipeline/renderCampaign');

const app = express();
const ROOT = process.cwd();
const CAMPAIGNS_DIR = path.join(ROOT, 'campaigns');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024*1024*1024 } }); // 1 GB

app.use(express.json({ limit: '10mb' }));
app.use('/campaigns', express.static(CAMPAIGNS_DIR)); // serve outputs
app.use('/', express.static(path.join(__dirname, 'public')));

// Simple health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Render endpoint: accepts multipart (facecam + config JSON)
app.post('/api/render', upload.fields([{ name: 'facecam', maxCount: 1 }, { name: 'config', maxCount: 1 }]), async (req, res) => {
  try {
    const configStr = req.body.config;
    if (!configStr) throw new Error('Missing config field');
    const config = JSON.parse(configStr);
    const face = req.files?.facecam?.[0];
    if (!face) throw new Error('Missing facecam file');

    // Make campaign dir
    const safeName = String(config.title || 'campaign').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    const campaignDir = path.join(CAMPAIGNS_DIR, safeName);
    fs.mkdirSync(campaignDir, { recursive: true });

    // Save facecam
    const facePath = path.join(campaignDir, 'facecam.mp4');
    fs.writeFileSync(facePath, face.buffer);

    // Write normalized config.json pointing to relative facecam
    const normalizedCfg = {
      ...config,
      output: {
        ...config.output,
        facecam: {
          ...config.output.facecam,
          path: './facecam.mp4'
        }
      }
    };
    fs.writeFileSync(path.join(campaignDir, 'config.json'), JSON.stringify(normalizedCfg, null, 2), 'utf8');

    // Kick render
    const result = await renderCampaign({ ...normalizedCfg, __baseDir: campaignDir });

    // Return URLs for browser
    const finalUrl = `/campaigns/${encodeURIComponent(safeName)}/final.mp4`;
    const posterUrl = `/campaigns/${encodeURIComponent(safeName)}/poster.jpg`;
    res.json({ ok: true, finalUrl, posterUrl, meta: result.meta });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`UI: http://localhost:${PORT}`);
});
