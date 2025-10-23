/**
 * Ambient Pause - Human Micro-Activity During Stillness
 *
 * Replaces dead `waitForTimeout()` calls with subtle, human-like micro-movements:
 * - Tiny cursor drifts (±8-20px, 120-220ms moves)
 * - Occasional tiny scroll nudges (20-40px, 300-500ms)
 * - Quiet windows (700-1400ms between micro events)
 *
 * Key properties:
 * - Never exceeds durationMs (hard time clamp)
 * - Deterministic (uses seeded RNG, no Math.random())
 * - No clicks (only cursor moves and micro-scrolls)
 * - Time-budget safe (returns actual elapsed time)
 *
 * Usage:
 *   const elapsed = await ambientPause(page, cursorManager, rand, 5000, { nudgeProb: 0.18 });
 */

const { generatePath } = require('./path');
const { scrollBy } = require('./scroll');

/**
 * Ambient pause with human micro-movements
 * @param {Page} page - Playwright page
 * @param {CursorManager} cursorManager - Cursor manager instance
 * @param {function} rand - Seeded RNG function
 * @param {number} durationMs - Target pause duration in milliseconds
 * @param {Object} [opts={}] - Options
 * @param {number} [opts.nudgeProb=0.18] - Probability of scroll nudge (0-1), max 1 per ambient
 * @returns {Promise<number>} Actual elapsed time in milliseconds
 */
async function ambientPause(page, cursorManager, rand, durationMs, opts = {}) {
  const start = Date.now();
  const endBy = start + durationMs;
  const nudgeProb = opts.nudgeProb ?? 0.18; // Default 18% chance
  let didNudge = false;

  // Minimum duration check
  if (durationMs < 100) {
    await page.waitForTimeout(durationMs);
    return Date.now() - start;
  }

  while (true) {
    const now = Date.now();
    const remaining = endBy - now;

    // Exit if time budget exhausted
    if (remaining <= 0) break;

    // Quiet window: 700-1400ms of stillness between micro events
    const quietMs = Math.min(700 + Math.round(rand() * 700), remaining);
    await page.waitForTimeout(quietMs);

    // Check remaining time after quiet window
    const left = endBy - Date.now();
    if (left < 250) break; // Not enough time for meaningful micro event

    // Decide micro action: nudge or move (seeded)
    const doNudge = !didNudge && rand() < nudgeProb;

    if (doNudge && left >= 350) {
      // Tiny scroll nudge (20-40px over 300-500ms)
      const amp = 20 + Math.round(rand() * 20);
      const dur = Math.min(300 + Math.round(rand() * 200), left);

      try {
        await scrollBy(page, amp, dur);
      } catch (error) {
        // Silently ignore scroll errors (e.g., at page bottom)
      }

      didNudge = true; // Only one nudge per ambient pause
      continue;
    }

    // Micro-move: ±8-20px curved move (120-220ms) + hover (300-500ms)
    const currentPos = await cursorManager.getCurrentPosition();
    const { x, y } = currentPos;

    // Random offset: ±12px average, ±24px max
    const dx = (rand() - 0.5) * 24;
    const dy = (rand() - 0.5) * 24;

    // Move duration: 120-220ms, clamped to remaining budget
    const moveMs = Math.min(120 + Math.round(rand() * 100), Math.max(0, left - 300));

    if (moveMs > 0) {
      const path = generatePath({
        fromX: x,
        fromY: y,
        toX: x + dx,
        toY: y + dy,
        targetWidth: 50, // Small target = slower Fitts' Law duration
        rand,
        sampleRate: 90,
        includeOvershoot: false // No overshoot for micro-moves
      });

      await cursorManager.animatePath(path);
    }

    // Check remaining time after move
    const left2 = endBy - Date.now();
    if (left2 <= 0) break;

    // Hover pause: 300-500ms of stillness after micro-move
    const hoverMs = Math.min(300 + Math.round(rand() * 200), left2);
    if (hoverMs > 0) {
      await page.waitForTimeout(hoverMs);
    }
  }

  // Return actual elapsed time (should be very close to durationMs)
  return Date.now() - start;
}

module.exports = {
  ambientPause
};
