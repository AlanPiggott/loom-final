#!/usr/bin/env node

/**
 * Loom-Lite Background Worker
 * Polls Supabase for render jobs and processes them using the video pipeline
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const {
  supabase,
  claimRenderJob,
  updateRenderProgress,
  updateJobState,
  downloadFile,
  updateRenderComplete,
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

// Configuration
const POLL_INTERVAL = parseInt(process.env.WORKER_POLL_INTERVAL) || 2000;
const CAMPAIGNS_DIR = path.join(process.cwd(), 'campaigns');

// Worker state
let isShuttingDown = false;
let currentJob = null;

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

  try {
    // Update to recording status
    await updateRenderProgress(render_id, 'recording', 10);

    // Create campaign directory
    const safeName = `${campaign_name}-${render_id}`.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    const campaignDir = path.join(CAMPAIGNS_DIR, safeName);
    fs.mkdirSync(campaignDir, { recursive: true });
    console.log(`[worker] Campaign directory: ${campaignDir}`);

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
      await updateRenderProgress(render_id, status, progress);
    };

    // Run the pipeline with progress updates
    const result = await renderCampaignWithProgress(config, progressCallback);

    // Pipeline complete, now uploading
    await updateRenderProgress(render_id, 'uploading', 85);

    console.log('[worker] Uploading assets to storage provider...');
    const { videoUrl, thumbUrl } = await uploadVideoAndThumb(result.final, result.poster, publicId);

    try {
      await purgeCdnPaths?.([videoUrl, thumbUrl]);
    } catch (purgeError) {
      console.warn('[worker] CDN purge failed:', purgeError.message);
    }

    // Update render as complete
    await updateRenderComplete(render_id, videoUrl, thumbUrl);

    // Mark job as completed
    await updateJobState(job_id, 'completed');

    console.log(`[worker] ✓ Job ${job_id} completed successfully`);
    console.log(`[worker] Video URL: ${videoUrl}`);
    console.log(`[worker] Thumb URL: ${thumbUrl}`);

    // Clean up work directory (optional)
    // You might want to keep it for debugging
    // fs.rmSync(campaignDir, { recursive: true, force: true });

  } catch (error) {
    console.error(`[worker] ❌ Job ${job_id} failed:`, error);

    // Update render status to failed
    await updateRenderProgress(render_id, 'failed', 0, error.message);

    // Mark job as failed
    await updateJobState(job_id, 'failed', error.message);

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
      // Try to claim a job
      const job = await claimRenderJob();

      if (job) {
        currentJob = job;
        await processJob(job);
        currentJob = null;
      } else {
        // No jobs available, wait before polling again
        process.stdout.write('.');
      }
    } catch (error) {
      // Log error but keep worker running
      console.error('[worker] Error in worker loop:', error);
      currentJob = null;
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  console.log('[worker] Worker loop stopped');
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal) {
  console.log(`\n[worker] Received ${signal}, shutting down gracefully...`);
  isShuttingDown = true;

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
  process.exit(0);
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
console.log(`\n${'='.repeat(60)}`);
console.log('Loom-Lite Background Worker');
console.log(`${'='.repeat(60)}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Supabase URL: ${process.env.SUPABASE_URL}`);
console.log(`Poll Interval: ${POLL_INTERVAL}ms`);
console.log(`${'='.repeat(60)}\n`);

// Start the worker loop
workerLoop().catch((error) => {
  console.error('[worker] Fatal error in worker loop:', error);
  process.exit(1);
});
