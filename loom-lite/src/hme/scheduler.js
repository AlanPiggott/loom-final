/**
 * Time Budget Scheduler
 *
 * Allocates time budgets across behavior beats.
 * Makes final 'idle' beat elastic to consume exact remaining time.
 * Deterministic with seeded RNG.
 *
 * Beat budget ranges (typical):
 * - introSettle: 800-1200ms
 * - hoverNav: 1500-2500ms
 * - scrollDrift: 3000-6000ms (elastic, scales with scene duration)
 * - hoverHeadingNearCenter: 1200-2000ms
 * - highlightSentence: 1800-3000ms
 * - moveToCTAandHover: 1500-2500ms
 * - idle: elastic (fills remaining time exactly)
 */

/**
 * Generate time budget schedule for all beats
 * @param {Object} params - Scheduler parameters
 * @param {number} params.sceneDurationMs - Total scene duration in milliseconds
 * @param {function} params.rand - Seeded RNG
 * @returns {Array<{beatName: string, budgetMs: number}>} Time allocation schedule
 */
function createSchedule({ sceneDurationMs, rand }) {
  const schedule = [];
  let remaining = sceneDurationMs;

  // Beat 1: introSettle (800-1200ms)
  const introSettle = 800 + rand() * 400;
  schedule.push({ beatName: 'introSettle', budgetMs: Math.round(introSettle) });
  remaining -= introSettle;

  // Beat 2: hoverNav (2500-4000ms - INCREASED for micro-movements)
  const hoverNav = 2500 + rand() * 1500;
  schedule.push({ beatName: 'hoverNav', budgetMs: Math.round(hoverNav) });
  remaining -= hoverNav;

  // Beat 3: scrollDrift (use 40-50% of remaining time for slower scrolling)
  const scrollDriftRatio = 0.4 + rand() * 0.1; // 40-50% of remaining time
  const scrollDrift = Math.min(remaining * scrollDriftRatio, 12000); // Cap at 12s
  schedule.push({ beatName: 'scrollDrift', budgetMs: Math.round(scrollDrift) });
  remaining -= scrollDrift;

  // Beat 4: hoverHeadingNearCenter (2500-4000ms - INCREASED for micro-movements)
  const hoverHeading = 2500 + rand() * 1500;
  schedule.push({ beatName: 'hoverHeadingNearCenter', budgetMs: Math.round(hoverHeading) });
  remaining -= hoverHeading;

  // Beat 5: highlightSentence (1800-3000ms)
  const highlightSentence = 1800 + rand() * 1200;
  schedule.push({ beatName: 'highlightSentence', budgetMs: Math.round(highlightSentence) });
  remaining -= highlightSentence;

  // Beat 6: moveToCTAandHover (1500-2500ms)
  const moveToCTA = 1500 + rand() * 1000;
  schedule.push({ beatName: 'moveToCTAandHover', budgetMs: Math.round(moveToCTA) });
  remaining -= moveToCTA;

  // Beat 7: idle (elastic - fills exact remaining time)
  // Ensure at least 1000ms for idle beat
  const idle = Math.max(1000, remaining);
  schedule.push({ beatName: 'idle', budgetMs: Math.round(idle) });

  return schedule;
}

/**
 * Create a simplified schedule (fewer beats) for very short scenes
 * @param {Object} params - Scheduler parameters
 * @param {number} params.sceneDurationMs - Total scene duration in milliseconds
 * @param {function} params.rand - Seeded RNG
 * @returns {Array<{beatName: string, budgetMs: number}>} Time allocation schedule
 */
function createSimplifiedSchedule({ sceneDurationMs, rand }) {
  const schedule = [];
  let remaining = sceneDurationMs;

  // For scenes <10s, only do: introSettle, scrollDrift, idle

  // Beat 1: introSettle (800-1000ms)
  const introSettle = 800 + rand() * 200;
  schedule.push({ beatName: 'introSettle', budgetMs: Math.round(introSettle) });
  remaining -= introSettle;

  // Beat 2: scrollDrift (use 40-50% of remaining time)
  const scrollDrift = remaining * (0.4 + rand() * 0.1);
  schedule.push({ beatName: 'scrollDrift', budgetMs: Math.round(scrollDrift) });
  remaining -= scrollDrift;

  // Beat 3: idle (elastic - fills exact remaining time)
  const idle = Math.max(500, remaining);
  schedule.push({ beatName: 'idle', budgetMs: Math.round(idle) });

  return schedule;
}

/**
 * Main scheduler function - selects appropriate schedule based on scene duration
 * @param {Object} params - Scheduler parameters
 * @param {number} params.sceneDurationMs - Total scene duration in milliseconds
 * @param {function} params.rand - Seeded RNG
 * @returns {Array<{beatName: string, budgetMs: number}>} Time allocation schedule
 */
function scheduleBeats({ sceneDurationMs, rand }) {
  // For very short scenes (<10s), use simplified schedule
  if (sceneDurationMs < 10000) {
    return createSimplifiedSchedule({ sceneDurationMs, rand });
  }

  // For normal scenes (>=10s), use full schedule
  return createSchedule({ sceneDurationMs, rand });
}

/**
 * Validate schedule - ensure total matches scene duration within tolerance
 * @param {Array} schedule - Beat schedule
 * @param {number} expectedDurationMs - Expected total duration
 * @returns {Object} Validation result {valid: boolean, totalMs: number, errorMs: number}
 */
function validateSchedule(schedule, expectedDurationMs) {
  const totalMs = schedule.reduce((sum, beat) => sum + beat.budgetMs, 0);
  const errorMs = Math.abs(totalMs - expectedDurationMs);
  const valid = errorMs < 100; // Within 100ms tolerance

  return {
    valid,
    totalMs,
    errorMs,
    expectedMs: expectedDurationMs
  };
}

/**
 * Log schedule for debugging
 * @param {Array} schedule - Beat schedule
 * @param {string} prefix - Log prefix
 */
function logSchedule(schedule, prefix = '[Schedule]') {
  console.log(`${prefix} Beat schedule:`);
  let cumulative = 0;
  schedule.forEach((beat, idx) => {
    cumulative += beat.budgetMs;
    console.log(
      `  ${idx + 1}. ${beat.beatName.padEnd(25)} ` +
      `${(beat.budgetMs / 1000).toFixed(2)}s ` +
      `(cumulative: ${(cumulative / 1000).toFixed(2)}s)`
    );
  });

  const total = schedule.reduce((sum, b) => sum + b.budgetMs, 0);
  console.log(`${prefix} Total: ${(total / 1000).toFixed(2)}s`);
}

module.exports = {
  scheduleBeats,
  createSchedule,
  createSimplifiedSchedule,
  validateSchedule,
  logSchedule
};
