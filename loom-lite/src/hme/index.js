/**
 * Human Motion Engine v2 - Main API
 *
 * Orchestrates natural cursor and scroll behavior for Playwright recordings.
 * Deterministic, time-bounded, and safe.
 *
 * Usage:
 *   const HME = require('./hme');
 *   await HME.runScene(page, scene);
 *
 * Requirements:
 * - scene.url: string (used as RNG seed)
 * - scene.durationSec: number
 */

const { createRNG, hashString } = require('./rng');
const { createCursorManager } = require('./cursor');
const { scheduleBeats, validateSchedule, logSchedule } = require('./scheduler');
const beats = require('./beats');
const { detectAuth } = require('./dom');

/**
 * Main HME entry point
 * @param {Page} page - Playwright page (already navigated)
 * @param {Object} scene - Scene config {url, durationSec}
 * @returns {Promise<Object>} Execution summary
 */
async function runScene(page, scene) {
  const startTime = Date.now();

  console.log(`\n[HME] Starting Human Motion Engine v2`);
  console.log(`[HME] Scene: ${scene.url}`);
  console.log(`[HME] Duration: ${scene.durationSec}s`);

  // Create seeded RNG from URL
  const seed = hashString(scene.url);
  const rand = createRNG(seed);
  console.log(`[HME] RNG seed: ${seed}`);

  // Check for authentication page
  const isAuthPage = await detectAuth(page);
  if (isAuthPage) {
    console.log(`[HME] ⚠️  Authentication page detected - skipping interactions`);
    // Just do minimal behavior: introSettle + idle
    const cursorManager = createCursorManager(page);
    await cursorManager.initialize();

    await beats.introSettle({
      page,
      cursorManager,
      rand,
      budgetMs: 1000
    });

    const remainingMs = scene.durationSec * 1000 - 1000;
    await beats.idle({
      page,
      cursorManager,
      rand,
      budgetMs: remainingMs
    });

    await cursorManager.cleanup();

    const elapsed = Date.now() - startTime;
    console.log(`[HME] ✅ Completed (auth page mode) in ${(elapsed / 1000).toFixed(2)}s`);
    return { completed: true, authPage: true, elapsedMs: elapsed };
  }

  // Initialize cursor manager
  const cursorManager = createCursorManager(page);
  await cursorManager.initialize();
  console.log(`[HME] Cursor manager initialized`);

  // Create time schedule
  const sceneDurationMs = scene.durationSec * 1000;
  const schedule = scheduleBeats({ sceneDurationMs, rand });
  logSchedule(schedule, '[HME]');

  // Validate schedule
  const validation = validateSchedule(schedule, sceneDurationMs);
  if (!validation.valid) {
    console.warn(
      `[HME] ⚠️  Schedule validation warning: ` +
      `${validation.errorMs}ms error (expected ${validation.expectedMs}ms, got ${validation.totalMs}ms)`
    );
  }

  // Execute beats
  const results = [];
  let cumulativeTime = 0;

  for (let i = 0; i < schedule.length; i++) {
    const { beatName, budgetMs } = schedule[i];
    const beatStartTime = Date.now();

    console.log(`\n[HME] [Beat ${i + 1}/${schedule.length}] ${beatName} (budget: ${budgetMs}ms)`);

    try {
      // Get beat function
      const beatFn = beats[beatName];
      if (!beatFn) {
        throw new Error(`Beat function '${beatName}' not found`);
      }

      // Execute beat
      const actualMs = await beatFn({
        page,
        cursorManager,
        rand,
        budgetMs
      });

      const beatElapsed = Date.now() - beatStartTime;
      cumulativeTime += beatElapsed;

      const delta = beatElapsed - budgetMs;
      const status = Math.abs(delta) < 100 ? '✅' : '⚠️';

      console.log(
        `[HME] ${status} ${beatName} completed: ` +
        `${beatElapsed}ms (budget: ${budgetMs}ms, delta: ${delta > 0 ? '+' : ''}${delta}ms)`
      );

      results.push({
        beatName,
        budgetMs,
        actualMs: beatElapsed,
        deltaMs: delta,
        onTime: Math.abs(delta) < 100
      });

    } catch (error) {
      console.error(`[HME] ❌ Error in beat '${beatName}':`, error.message);

      // Continue to next beat (graceful degradation)
      results.push({
        beatName,
        budgetMs,
        actualMs: 0,
        deltaMs: -budgetMs,
        error: error.message,
        onTime: false
      });
    }
  }

  // Clean up cursor
  await cursorManager.cleanup();
  console.log(`[HME] Cursor manager cleaned up`);

  // Final summary
  const totalElapsed = Date.now() - startTime;
  const expectedMs = sceneDurationMs;
  const finalDelta = totalElapsed - expectedMs;
  const finalStatus = Math.abs(finalDelta) < 100 ? '✅' : '⚠️';

  console.log(`\n[HME] ${finalStatus} Scene complete!`);
  console.log(`[HME] Total time: ${(totalElapsed / 1000).toFixed(2)}s`);
  console.log(`[HME] Expected: ${(expectedMs / 1000).toFixed(2)}s`);
  console.log(`[HME] Delta: ${finalDelta > 0 ? '+' : ''}${finalDelta}ms`);

  // Success rate
  const successCount = results.filter(r => r.onTime).length;
  const successRate = (successCount / results.length) * 100;
  console.log(`[HME] Beat success rate: ${successRate.toFixed(0)}% (${successCount}/${results.length})`);

  return {
    completed: true,
    authPage: false,
    elapsedMs: totalElapsed,
    expectedMs,
    deltaMs: finalDelta,
    onTime: Math.abs(finalDelta) < 100,
    beats: results,
    successRate
  };
}

/**
 * Check if HME should be used for a scene
 * @param {Object} scene - Scene config
 * @returns {boolean} True if HME should be used
 */
function shouldUseHME(scene) {
  // Use HME if scene has no actions array
  return !scene.actions || scene.actions.length === 0;
}

module.exports = {
  runScene,
  shouldUseHME
};
