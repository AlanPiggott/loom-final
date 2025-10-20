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
  console.log('[/api/render] Request received');

  try {
    // Config is sent as a file, so read from req.files
    console.log('[/api/render] Extracting config file...');
    const configFile = req.files?.config?.[0];
    if (!configFile) {
      console.error('[/api/render] Missing config file');
      throw new Error('Missing config file');
    }

    const configStr = configFile.buffer.toString('utf8');
    console.log('[/api/render] Config file read, parsing JSON...');
    const config = JSON.parse(configStr);
    console.log('[/api/render] Config parsed:', config.title);

    console.log('[/api/render] Extracting facecam file...');
    const face = req.files?.facecam?.[0];
    if (!face) {
      console.error('[/api/render] Missing facecam file');
      throw new Error('Missing facecam file');
    }
    console.log('[/api/render] Facecam file received:', face.originalname, `(${(face.size / 1024 / 1024).toFixed(2)} MB)`);

    // Make campaign dir
    const safeName = String(config.title || 'campaign').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    const campaignDir = path.join(CAMPAIGNS_DIR, safeName);
    console.log('[/api/render] Creating campaign directory:', campaignDir);
    fs.mkdirSync(campaignDir, { recursive: true });

    // Save facecam
    const facePath = path.join(campaignDir, 'facecam.mp4');
    console.log('[/api/render] Saving facecam to:', facePath);
    fs.writeFileSync(facePath, face.buffer);
    console.log('[/api/render] Facecam saved successfully');

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
    console.log('[/api/render] Writing config.json...');
    fs.writeFileSync(path.join(campaignDir, 'config.json'), JSON.stringify(normalizedCfg, null, 2), 'utf8');
    console.log('[/api/render] Config.json saved');

    // Kick render
    console.log('[/api/render] Starting renderCampaign...');
    console.log('[/api/render] This may take several minutes depending on video length and scenes...');
    const result = await renderCampaign({ ...normalizedCfg, __baseDir: campaignDir });
    console.log('[/api/render] Render completed successfully');

    // Return URLs for browser
    const finalUrl = `/campaigns/${encodeURIComponent(safeName)}/final.mp4`;
    const posterUrl = `/campaigns/${encodeURIComponent(safeName)}/poster.jpg`;
    console.log('[/api/render] Sending success response');
    res.json({ ok: true, finalUrl, posterUrl, meta: result.meta });
  } catch (e) {
    console.error('[/api/render] ERROR:', e.message);
    console.error('[/api/render] Stack trace:', e.stack);

    // Make sure we always send a response
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: e.message, stack: e.stack });
    }
  }
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`✓ Server started successfully`);
  console.log(`✓ UI: http://localhost:${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/api/health`);
  console.log('='.repeat(50));
});

// Global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  console.error('Stack:', error.stack);
  // Don't exit - keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
  // Don't exit - keep server running
});
