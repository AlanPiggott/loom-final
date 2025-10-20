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

const requestedPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
const fallbackPort = process.env.FALLBACK_PORT ? parseInt(process.env.FALLBACK_PORT, 10) : 3200;

const portCandidates = [];
if (requestedPort && !Number.isNaN(requestedPort) && requestedPort !== 3000) {
  portCandidates.push(requestedPort);
}
portCandidates.push(3100);
if (!portCandidates.includes(fallbackPort)) portCandidates.push(fallbackPort);

function startServer(ports, idx = 0) {
  if (idx >= ports.length) {
    console.error('Unable to bind to any configured ports:', ports.join(', '));
    process.exit(1);
  }
  const port = ports[idx];
  const server = app.listen(port, () => {
    const note = idx > 0 ? ' (auto-selected)' : '';
    console.log(`UI: http://localhost:${port}${note}`);
  });
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use. Trying next option...`);
      startServer(ports, idx + 1);
    } else {
      console.error('Unable to start server:', err);
      process.exit(1);
    }
  });
}

startServer(portCandidates);
