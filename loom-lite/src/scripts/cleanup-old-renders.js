#!/usr/bin/env node
/**
 * Cleanup old render directories
 * Run this as a cron job: 0 2 * * * (daily at 2am)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CAMPAIGNS_DIR = path.join(process.cwd(), 'campaigns');
const MAX_AGE_DAYS = parseInt(process.env.CLEANUP_MAX_AGE_DAYS) || 30;

async function cleanupOldDirectories() {
  console.log('[cleanup] Starting cleanup of old render directories...');
  console.log(`[cleanup] Campaigns directory: ${CAMPAIGNS_DIR}`);
  console.log(`[cleanup] Max age: ${MAX_AGE_DAYS} days`);

  if (!fs.existsSync(CAMPAIGNS_DIR)) {
    console.log('[cleanup] Campaigns directory does not exist, nothing to clean');
    return;
  }

  const now = Date.now();
  const maxAgeMs = MAX_AGE_DAYS * 24 * 3600 * 1000;
  let cleanedCount = 0;
  let freedBytes = 0;

  const dirs = fs.readdirSync(CAMPAIGNS_DIR);

  for (const dir of dirs) {
    const fullPath = path.join(CAMPAIGNS_DIR, dir);

    try {
      const stats = fs.statSync(fullPath);

      if (!stats.isDirectory()) continue;

      const ageMs = now - stats.mtimeMs;

      if (ageMs > maxAgeMs) {
        // Calculate directory size before deletion
        const size = getDirectorySize(fullPath);

        console.log(`[cleanup] Deleting ${dir} (age: ${Math.floor(ageMs / (24 * 3600 * 1000))} days, size: ${formatBytes(size)})`);
        fs.rmSync(fullPath, { recursive: true, force: true });

        cleanedCount++;
        freedBytes += size;
      }
    } catch (error) {
      console.error(`[cleanup] Error processing ${dir}:`, error.message);
    }
  }

  console.log(`[cleanup] ✓ Cleanup complete:`);
  console.log(`[cleanup]   - Directories deleted: ${cleanedCount}`);
  console.log(`[cleanup]   - Space freed: ${formatBytes(freedBytes)}`);
}

function getDirectorySize(dirPath) {
  let size = 0;

  try {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        size += getDirectorySize(filePath);
      } else {
        size += stats.size;
      }
    }
  } catch (error) {
    console.error(`Error calculating size for ${dirPath}:`, error.message);
  }

  return size;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Run cleanup
cleanupOldDirectories().catch(error => {
  console.error('[cleanup] Fatal error:', error);
  process.exit(1);
});
