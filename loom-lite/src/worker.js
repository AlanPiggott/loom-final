#!/usr/bin/env node

/**
 * Loom-Lite Background Worker
 * Polls Supabase for render jobs and processes them using the video pipeline
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { parse } = require('csv-parse/sync');
const {
  supabase,
  claimRenderJob,
  updateRenderProgress,
  updateJobState,
  downloadFile,
  updateRenderComplete,
  rescueStuckRenders,
} = require('./lib/supabase');
const { uploadVideoAndThumb, purgeCdnPaths } = require('./storage');
const { renderCampaignWithProgress } = require('./pipeline/renderCampaignWithProgress');

const csvCache = new Map();

async function getCsvRows(csvUrl) {
  if (!csvUrl) return [];

  if (csvCache.has(csvUrl)) {
    return csvCache.get(csvUrl);
  }

  console.log(`[worker] Downloading lead CSV: ${csvUrl}`);
  const buffer = await downloadFile(csvUrl);

  let rows;
  try {
    rows = parse(buffer.toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (error) {
    console.error('[worker] Failed to parse CSV:', error.message);
    throw new Error(`Failed to parse lead CSV (${error.message})`);
  }

  console.log(`[worker] Parsed ${rows.length} lead rows from CSV`);
  csvCache.set(csvUrl, rows);
  return rows;
}

function ensureAbsoluteUrl(raw) {
  if (!raw) return raw;
  const value = String(raw).trim();
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
}

/**
 * Clean up campaign directory based on retention policy
 * @param {string} campaignDir - Directory to clean up
 * @param {boolean} wasSuccessful - Whether render succeeded
 */
async function cleanupCampaignDir(campaignDir, wasSuccessful) {
  if (!CLEANUP_ENABLED) {
    console.log('[worker] Cleanup disabled, keeping directory:', campaignDir);
    return;
  }

  if (!campaignDir || !fs.existsSync(campaignDir)) {
    return; // Already cleaned or doesn't exist
  }

  try {
    if (wasSuccessful) {
      // Successful renders: cleanup after short delay (allow for debugging if needed)
      console.log(`[worker] Scheduling cleanup of successful render in ${SUCCESS_RENDER_RETENTION_HOURS}h: ${campaignDir}`);
      setTimeout(() => {
        if (fs.existsSync(campaignDir)) {
          fs.rmSync(campaignDir, { recursive: true, force: true });
          console.log('[worker] ✓ Cleaned up successful render:', campaignDir);
        }
      }, SUCCESS_RENDER_RETENTION_HOURS * 3600 * 1000);
    } else {
      // Failed renders: keep for debugging based on retention policy
      const retentionMs = FAILED_RENDER_RETENTION_DAYS * 24 * 3600 * 1000;
      console.log(`[worker] Failed render will be kept for ${FAILED_RENDER_RETENTION_DAYS} days: ${campaignDir}`);

      // Schedule cleanup after retention period
      setTimeout(() => {
        if (fs.existsSync(campaignDir)) {
          fs.rmSync(campaignDir, { recursive: true, force: true });
          console.log('[worker] ✓ Cleaned up failed render after retention:', campaignDir);
        }
      }, retentionMs);
    }
  } catch (error) {
    console.error('[worker] Error scheduling cleanup:', error);
    // Don't throw - cleanup failure shouldn't break render
  }
}

// Cleanup configuration
const CLEANUP_ENABLED = process.env.CLEANUP_ENABLED !== 'false'; // Default: true
const FAILED_RENDER_RETENTION_DAYS = parseInt(process.env.FAILED_RENDER_RETENTION_DAYS, 10) || 7;
const SUCCESS_RENDER_RETENTION_HOURS = parseInt(process.env.SUCCESS_RENDER_RETENTION_HOURS, 10) || 1;

// Health/monitoring configuration
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT, 10) || 3001;
const HEARTBEAT_TIMEOUT_MS = parseInt(process.env.HEARTBEAT_TIMEOUT_MS, 10) || 60000;
const DEFAULT_MAX_CONCURRENT_JOBS = 3;
const ENV_MAX_CONCURRENT_JOBS = (() => {
  const parsed = parseInt(process.env.MAX_CONCURRENT_JOBS, 10);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return parsed;
  }
  return DEFAULT_MAX_CONCURRENT_JOBS;
})();
const WORKER_CONFIG_REFRESH_MS = parseInt(process.env.WORKER_CONFIG_REFRESH_MS, 10) || 15000;
const RESCUE_STUCK_RENDERS = process.env.RESCUE_STUCK_RENDERS !== 'false';
const RENDER_STUCK_TIMEOUT_MS = parseInt(process.env.RENDER_STUCK_TIMEOUT_MS, 10) || 10 * 60 * 1000;
const RENDER_STUCK_SWEEP_INTERVAL_MS = parseInt(process.env.RENDER_STUCK_SWEEP_INTERVAL_MS, 10) || 60 * 1000;

// Configuration
const POLL_INTERVAL = parseInt(process.env.WORKER_POLL_INTERVAL, 10) || 2000;
const CAMPAIGNS_DIR = path.join(process.cwd(), 'campaigns');

// Worker state
let isShuttingDown = false;
let currentJob = null;
let lastHeartbeat = Date.now();
let currentJobInfo = null;
let lastRescueCheck = 0;

const workerConfigCache = {
  fetchedAt: 0,
  config: {
    maxConcurrentJobs: ENV_MAX_CONCURRENT_JOBS,
    source: 'env',
  },
};

let hasLoggedMissingSettingsTable = false;

function getCachedWorkerConfig() {
  return workerConfigCache.config;
}

async function refreshWorkerConfig(force = false) {
  const now = Date.now();
  if (!force && now - workerConfigCache.fetchedAt < WORKER_CONFIG_REFRESH_MS) {
    return workerConfigCache.config;
  }

  workerConfigCache.fetchedAt = now;

  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value, updated_at')
      .eq('key', 'max_concurrent_jobs')
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('system_settings')) {
        if (!hasLoggedMissingSettingsTable) {
          console.warn(
            '[worker] system_settings table not found; continuing with MAX_CONCURRENT_JOBS from environment'
          );
          hasLoggedMissingSettingsTable = true;
        }
      } else {
        console.error('[worker] Failed to load system settings:', error);
      }
      return workerConfigCache.config;
    }

    let limit = ENV_MAX_CONCURRENT_JOBS;
    let source = 'env';

    if (data?.value !== undefined && data?.value !== null) {
      const raw =
        data.value.limit ??
        data.value.maxConcurrentJobs ??
        data.value.max_concurrent_jobs ??
        data.value.value ??
        data.value;

      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 1) {
        limit = parsed;
        source = 'db';
      }
    }

    workerConfigCache.config = {
      maxConcurrentJobs: limit,
      source,
      updatedAt: data?.updated_at ?? null,
    };
    return workerConfigCache.config;
  } catch (err) {
    console.error('[worker] Error refreshing worker config:', err);
    return workerConfigCache.config;
  }
}

/**
 * Update worker heartbeat (and optionally current job info)
 * @param {object|null|undefined} jobInfo
 */
function updateHeartbeat(jobInfo) {
  lastHeartbeat = Date.now();
  if (jobInfo !== undefined) {
    if (jobInfo && typeof jobInfo === 'object') {
      currentJobInfo = {
        ...jobInfo,
        concurrencyLimit: getCachedWorkerConfig().maxConcurrentJobs,
      };
    } else {
      currentJobInfo = jobInfo;
    }
  }
}

/**
 * HTTP server request handler (shared across potential server restarts)
 */
const handleHealthRequest = async (req, res) => {
  try {
    if (req.url === '/health') {
      const now = Date.now();
      const timeSinceHeartbeat = now - lastHeartbeat;
      const isHealthy = !isShuttingDown && timeSinceHeartbeat < HEARTBEAT_TIMEOUT_MS;

      let activeJobCount = null;
      try {
        const { count } = await supabase
          .from('render_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('state', 'processing');
        activeJobCount = count ?? 0;
      } catch (countError) {
        console.error('[health] Error fetching active job count:', countError);
      }

      const config = getCachedWorkerConfig();
      const limit = config?.maxConcurrentJobs ?? ENV_MAX_CONCURRENT_JOBS;
      const available =
        activeJobCount != null ? Math.max(0, limit - activeJobCount) : null;

      const statusPayload = {
        status: isHealthy ? 'healthy' : 'unhealthy',
        uptimeSeconds: process.uptime(),
        lastHeartbeat: new Date(lastHeartbeat).toISOString(),
        timeSinceHeartbeatMs: timeSinceHeartbeat,
        heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
        currentJob: currentJobInfo,
        isShuttingDown,
        memory: process.memoryUsage(),
        concurrency: {
          limit,
          active: activeJobCount,
          available,
          source: config?.source ?? 'env',
          lastRefreshedAt: workerConfigCache.fetchedAt
            ? new Date(workerConfigCache.fetchedAt).toISOString()
            : null,
          updatedAt: config?.updatedAt ?? null,
        },
      };

      res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(statusPayload, null, 2));
      return;
    }

    if (req.url === '/metrics') {
      const uptime = process.uptime();
      const secondsSinceHeartbeat = (Date.now() - lastHeartbeat) / 1000;
      const heapUsed = process.memoryUsage().heapUsed;
      const isProcessing = currentJob ? 1 : 0;
      let activeJobCount = 0;

      try {
        const { count } = await supabase
          .from('render_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('state', 'processing');
        activeJobCount = count ?? 0;
      } catch (countError) {
        console.error('[health] Error fetching active job count for metrics:', countError);
      }

      const config = getCachedWorkerConfig();
      const limit = config?.maxConcurrentJobs ?? ENV_MAX_CONCURRENT_JOBS;
      const available = Math.max(0, limit - activeJobCount);

      const metrics = [
        '# HELP worker_uptime_seconds Worker uptime in seconds',
        '# TYPE worker_uptime_seconds gauge',
        `worker_uptime_seconds ${uptime}`,
        '# HELP worker_last_heartbeat_seconds Seconds since last heartbeat',
        '# TYPE worker_last_heartbeat_seconds gauge',
        `worker_last_heartbeat_seconds ${secondsSinceHeartbeat}`,
        '# HELP worker_memory_used_bytes Memory usage in bytes',
        '# TYPE worker_memory_used_bytes gauge',
        `worker_memory_used_bytes ${heapUsed}`,
        '# HELP worker_is_processing Indicates if worker is processing a job (1=yes, 0=no)',
        '# TYPE worker_is_processing gauge',
        `worker_is_processing ${isProcessing}`,
        '# HELP worker_concurrency_active Active jobs currently processing',
        '# TYPE worker_concurrency_active gauge',
        `worker_concurrency_active ${activeJobCount}`,
        '# HELP worker_concurrency_limit Configured maximum concurrent jobs',
        '# TYPE worker_concurrency_limit gauge',
        `worker_concurrency_limit ${limit}`,
        '# HELP worker_concurrency_available Remaining concurrency capacity',
        '# TYPE worker_concurrency_available gauge',
        `worker_concurrency_available ${available}`,
      ].join('\n');

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${metrics}\n`);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  } catch (error) {
    console.error('[health] Error handling request:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
};

let healthServer = null;
let healthPort = null;
const HEALTH_PORT_MAX_ATTEMPTS = parseInt(process.env.HEALTH_PORT_MAX_ATTEMPTS, 10) || 5;

/**
 * Attempt to start the health server, retrying on consecutive ports if needed.
 */
async function startHealthServer(preferredPort = HEALTH_PORT) {
  const attemptLimit = Math.max(1, HEALTH_PORT_MAX_ATTEMPTS);

  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const portToTry = preferredPort + attempt;
    const server = http.createServer(handleHealthRequest);

    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(portToTry);
      });

      healthServer = server;
      healthPort = portToTry;
      process.env.HEALTH_PORT_ACTIVE = String(portToTry);

      console.log(`[worker] Health check server listening on :${portToTry}`);
      console.log(`[worker] Health endpoint: http://localhost:${portToTry}/health`);
      console.log(`[worker] Metrics endpoint: http://localhost:${portToTry}/metrics`);

      server.on('error', (error) => {
        console.error('[worker] Health check server error:', error);
      });

      updateHeartbeat({ state: 'starting', healthPort: portToTry });
      return;
    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        console.warn(`[worker] Health port ${portToTry} is in use; trying ${portToTry + 1}`);
        try {
          server.close();
        } catch (closeError) {
          console.warn('[worker] Error closing health server after EADDRINUSE:', closeError.message);
        }
        continue;
      }

      console.error(`[worker] Failed to start health server on port ${portToTry}:`, error);
      try {
        server.close();
      } catch (closeError) {
        console.warn('[worker] Error closing health server after failure:', closeError.message);
      }
      break;
    }
  }

  console.error(
    `[worker] Unable to start health server after ${Math.max(1, HEALTH_PORT_MAX_ATTEMPTS)} attempt(s); continuing without health endpoints`
  );
  healthServer = null;
  healthPort = null;
}

/**
 * Process a single render job
 */
async function processJob(job) {
  const {
    job_id,
    render_id,
    campaign_id,
    campaign_name,
    scenes,
    facecam_url,
    lead_csv_url,
    lead_row_index,
    output_settings,
  } = job;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[worker] Processing job: ${job_id}`);
  console.log(`[worker] Campaign: ${campaign_name} (${campaign_id})`);
  console.log(`[worker] Render: ${render_id}`);
  console.log(`[worker] Scenes: ${scenes.length}`);
  console.log(`${'='.repeat(60)}\n`);

  const jobSummaryBase = {
    jobId: job_id,
    renderId: render_id,
    campaignId: campaign_id,
    campaignName: campaign_name,
  };

  updateHeartbeat({ ...jobSummaryBase, state: 'preparing' });

  let campaignDir;

  try {
    // Update to recording status
    await updateRenderProgress(render_id, 'recording', 10);

    // Create campaign directory
    const safeName = `${campaign_name}-${render_id}`.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    campaignDir = path.join(CAMPAIGNS_DIR, safeName);
    fs.mkdirSync(campaignDir, { recursive: true });
    console.log(`[worker] Campaign directory: ${campaignDir}`);
    updateHeartbeat({ ...jobSummaryBase, state: 'preparing', campaignDir });

    // Download facecam if URL provided
    let facecamPath = null;
    if (facecam_url) {
      console.log(`[worker] Downloading facecam from: ${facecam_url}`);
      try {
        const facecamBuffer = await downloadFile(facecam_url);
        facecamPath = path.join(campaignDir, 'facecam.mp4');
        fs.writeFileSync(facecamPath, facecamBuffer);
        console.log(`[worker] Facecam saved to: ${facecamPath}`);
      } catch (error) {
        console.warn('[worker] Failed to download facecam:', error.message);
        console.warn('[worker] Continuing without facecam');
        facecamPath = null;
      }
    } else {
      console.log('[worker] No facecam URL provided, rendering without facecam overlay');
      facecamPath = null;
    }

    const leadIndexLabel = Number.isInteger(lead_row_index) ? lead_row_index + 1 : null;
    let csvRow = null;

    if (lead_csv_url && Number.isInteger(lead_row_index)) {
      const rows = await getCsvRows(lead_csv_url);

      if (lead_row_index < 0 || lead_row_index >= rows.length) {
        throw new Error(`Lead row ${lead_row_index + 1} is out of bounds (found ${rows.length})`);
      }

      csvRow = rows[lead_row_index];
      console.log(`[worker] Using CSV row ${leadIndexLabel}/${rows.length}`);
    }

    const firstCsvScene = scenes.find((scene) => scene.entry_type === 'csv' && scene.csv_column);
    let leadIdentifier = null;

    if (csvRow) {
      if (firstCsvScene?.csv_column && csvRow[firstCsvScene.csv_column]) {
        leadIdentifier = String(csvRow[firstCsvScene.csv_column]).trim();
      }

      if (!leadIdentifier) {
        leadIdentifier = `Lead ${leadIndexLabel}`;
      }

      try {
        await supabase
          .from('renders')
          .update({ lead_identifier: leadIdentifier })
          .eq('id', render_id);
      } catch (error) {
        console.warn('[worker] Failed to persist lead identifier:', error.message);
      }

      console.log(`[worker] Lead identifier: ${leadIdentifier}`);
    }

    const { data: renderRow, error: publicIdError } = await supabase
      .from('renders')
      .select('public_id')
      .eq('id', render_id)
      .single();

    if (publicIdError || !renderRow) {
      throw new Error(`Failed to fetch render public_id: ${publicIdError?.message || 'not found'}`);
    }

    const publicId = renderRow.public_id || render_id;

    // Build campaign config for renderCampaign
    const config = {
      title: leadIndexLabel ? `${campaign_name} - Lead ${leadIndexLabel}` : campaign_name,
      output: {
        width: output_settings.width || 1920,
        height: output_settings.height || 1080,
        fps: output_settings.fps || 60,
        pageLoadWaitMs: output_settings.pageLoadWaitMs || 3000, // Add default page load wait
        facecam: facecamPath ? {
          path: './facecam.mp4',
          pip: output_settings.facecam?.pip || {
            width: 320,
            margin: 24,
            corner: 'bottom-right',
          },
          endPadMode: output_settings.facecam?.endPadMode || 'freeze',
        } : null,
      },
      scenes: scenes.map((scene, index) => {
        let resolvedUrl = scene.url;

        if (scene.entry_type === 'csv') {
          if (!csvRow) {
            throw new Error(`Scene ${index + 1} requires CSV data but no row was loaded`);
          }
          if (!scene.csv_column) {
            throw new Error(`Scene ${index + 1} is missing csv_column metadata`);
          }

          const columnValue = csvRow[scene.csv_column];
          if (!columnValue) {
            throw new Error(
              `CSV column "${scene.csv_column}" is empty for lead row ${leadIndexLabel ?? 'unknown'}`
            );
          }

          resolvedUrl = ensureAbsoluteUrl(columnValue);
          console.log(
            `[worker] Scene ${index + 1} resolved CSV column "${scene.csv_column}" -> ${resolvedUrl}`
          );
        } else {
          resolvedUrl = ensureAbsoluteUrl(resolvedUrl);
        }

        if (!resolvedUrl) {
          throw new Error(`Scene ${index + 1} resolved URL is empty`);
        }

        return {
          id: `scene-${index + 1}`,
          url: resolvedUrl,
          durationSec: scene.duration_sec,
          entryType: scene.entry_type || 'manual',
          csvColumn: scene.csv_column || null,
        };
      }),
      __baseDir: campaignDir,
    };

    // Write config for debugging
    fs.writeFileSync(
      path.join(campaignDir, 'config.json'),
      JSON.stringify(config, null, 2),
      'utf8'
    );

    // Execute pipeline with progress updates
    console.log('[worker] Starting video pipeline...');

    // Create progress callback
    const progressCallback = async (status, progress) => {
      updateHeartbeat({
        ...jobSummaryBase,
        state: 'processing',
        status,
        progress,
      });
      await updateRenderProgress(render_id, status, progress);
    };

    // Run the pipeline with progress updates
    const result = await renderCampaignWithProgress(config, progressCallback);

    // Pipeline complete, now uploading
    await updateRenderProgress(render_id, 'uploading', 85);
    updateHeartbeat({ ...jobSummaryBase, state: 'uploading', progress: 85 });

    console.log('[worker] Uploading assets to storage provider...');
    const { videoUrl, thumbUrl } = await uploadVideoAndThumb(result.final, result.poster, publicId);
    updateHeartbeat({ ...jobSummaryBase, state: 'uploading', progress: 95 });

    try {
      await purgeCdnPaths?.([videoUrl, thumbUrl]);
    } catch (purgeError) {
      console.warn('[worker] CDN purge failed:', purgeError.message);
    }

    // Update render as complete
    await updateRenderComplete(render_id, videoUrl, thumbUrl);
    updateHeartbeat({
      ...jobSummaryBase,
      state: 'completed',
      progress: 100,
      completedAt: new Date().toISOString(),
      videoUrl,
      thumbUrl,
    });

    // Mark job as completed
    await updateJobState(job_id, 'completed');

    console.log(`[worker] ✓ Job ${job_id} completed successfully`);
    console.log(`[worker] Video URL: ${videoUrl}`);
    console.log(`[worker] Thumb URL: ${thumbUrl}`);

    // Clean up work directory based on retention policy
    await cleanupCampaignDir(campaignDir, true); // true = successful render

  } catch (error) {
    console.error(`[worker] ❌ Job ${job_id} failed:`, error);
    updateHeartbeat({
      ...jobSummaryBase,
      state: 'error',
      error: error.message,
    });

    // Update render status to failed
    await updateRenderProgress(render_id, 'failed', 0, error.message);

    // Mark job as failed
    await updateJobState(job_id, 'failed', error.message);

    // Clean up failed render (with retention)
    if (campaignDir) {
      await cleanupCampaignDir(campaignDir, false); // false = failed render
    }

    throw error; // Re-throw to handle in the polling loop
  }
}

/**
 * Main worker loop
 */
async function workerLoop() {
  console.log(`[worker] Worker started - polling every ${POLL_INTERVAL}ms`);

  while (!isShuttingDown) {
    try {
      // Update heartbeat while idle/waiting
      updateHeartbeat({ state: 'idle' });

      // Refresh worker configuration periodically
      const config = await refreshWorkerConfig(false);

      // Attempt to rescue stale renders if enabled
      if (
        RESCUE_STUCK_RENDERS &&
        Date.now() - lastRescueCheck >= RENDER_STUCK_SWEEP_INTERVAL_MS
      ) {
        lastRescueCheck = Date.now();
        try {
          const rescued = await rescueStuckRenders({
            staleAfterMs: RENDER_STUCK_TIMEOUT_MS,
            limit: 10,
          });
          if (rescued.length) {
            console.warn(
              `[worker] Marked ${rescued.length} render(s) as failed due to inactivity`,
              rescued
            );
          }
        } catch (rescueError) {
          console.error('[worker] Error rescuing stuck renders:', rescueError);
        }
      }

      // Try to claim a job using configured concurrency limit
      const job = await claimRenderJob(config?.maxConcurrentJobs);

      if (job) {
        currentJob = job;
        updateHeartbeat({
          jobId: job.job_id,
          renderId: job.render_id,
          campaignId: job.campaign_id,
          campaignName: job.campaign_name,
          state: 'processing',
          startedAt: new Date().toISOString(),
        });
        await processJob(job);
        currentJob = null;
        updateHeartbeat(null);
      } else {
        // No jobs available, wait before polling again
        process.stdout.write('.');
      }
    } catch (error) {
      // Log error but keep worker running
      console.error('[worker] Error in worker loop:', error);
      currentJob = null;
      updateHeartbeat({ state: 'error', error: error.message });
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  console.log('[worker] Worker loop stopped');
  updateHeartbeat({ state: 'stopped' });
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal) {
  console.log(`\n[worker] Received ${signal}, shutting down gracefully...`);
  isShuttingDown = true;
  updateHeartbeat({ state: 'shutting_down', signal });

  // If currently processing a job, wait for it to complete
  if (currentJob) {
    console.log('[worker] Waiting for current job to complete...');
    // Give it max 30 seconds to complete
    const timeout = setTimeout(() => {
      console.log('[worker] Timeout waiting for job, forcing exit');
      process.exit(1);
    }, 30000);

    while (currentJob) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    clearTimeout(timeout);
  }

  console.log('[worker] Worker shutdown complete');
  if (healthServer && healthServer.listening) {
    const forceExitTimer = setTimeout(() => {
      console.warn('[worker] Health server close timed out, forcing exit');
      process.exit(0);
    }, 5000);
    forceExitTimer.unref();

    healthServer.close(() => {
      console.log('[worker] Health check server closed');
      clearTimeout(forceExitTimer);
      healthServer = null;
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[worker] Uncaught exception:', error);
  // Don't exit - let the worker continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[worker] Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit - let the worker continue
});

// Start the worker
(async () => {
  updateHeartbeat({ state: 'starting' });
  await refreshWorkerConfig(true);
  await startHealthServer(HEALTH_PORT);

  console.log(`\n${'='.repeat(60)}`);
  console.log('Loom-Lite Background Worker');
  console.log(`${'='.repeat(60)}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Supabase URL: ${process.env.SUPABASE_URL}`);
  console.log(`Poll Interval: ${POLL_INTERVAL}ms`);
  if (healthPort) {
    console.log(`Health Port: ${healthPort}`);
  }
  console.log(`${'='.repeat(60)}\n`);

  // Start the worker loop
  workerLoop().catch((error) => {
    console.error('[worker] Fatal error in worker loop:', error);
    process.exit(1);
  });
})();
