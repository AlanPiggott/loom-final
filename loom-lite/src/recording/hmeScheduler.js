/**
 * HME Scheduler - Time budget allocation for motion beats
 *
 * Ensures exact scene duration by:
 * 1. Reserving MIN_BEAT × beatsRemaining for upcoming beats
 * 2. Capping each allocation to prevent overshoot
 * 3. Giving all remaining time to last beat
 */

const MIN_BEAT_MS = 400; // Minimum duration for any beat (prevents rushed interactions)

/**
 * Script templates define beat sequences for different page types
 * Each beat has: name, function reference, and duration range [min, max] in ms
 */
const SCRIPTS = {
  'saas-default': [
    { name: 'introSettle', durationRange: [900, 1400] },
    { name: 'hoverNav', durationRange: [800, 1600], navText: 'Pricing' },
    { name: 'scrollDrift', durationRange: [5000, 8000] }, // ~40% of typical 15s scene
    { name: 'hoverHeadingNearCenter', durationRange: [900, 1500] },
    { name: 'highlightSentence', durationRange: [1200, 1800] },
    { name: 'moveToCTAandHover', durationRange: [900, 1400] },
    { name: 'idle', durationRange: [400, 700] }
  ],

  'pricing-default': [
    { name: 'introSettle', durationRange: [900, 1400] },
    { name: 'hoverHeadingNearCenter', durationRange: [900, 1500] },
    { name: 'scrollDrift', durationRange: [4000, 6000] }, // ~30% of typical 15s scene
    { name: 'moveToCTAandHover', durationRange: [900, 1400] },
    { name: 'idle', durationRange: [400, 700] }
  ],

  'generic': [
    { name: 'introSettle', durationRange: [900, 1400] },
    { name: 'scrollDrift', durationRange: [8000, 12000] }, // ~60% of typical 15s scene
    { name: 'hoverHeadingNearCenter', durationRange: [900, 1500] },
    { name: 'moveToCTAandHover', durationRange: [900, 1400] },
    { name: 'idle', durationRange: [400, 700] }
  ]
};

/**
 * Allocate time budget to beats with deterministic randomness
 *
 * FIX #1: Budget overshoot prevention via 3-layer enforcement
 * - Layer 1 (here): Reserve MIN_BEAT × beatsRemaining when allocating
 * - Layer 2 (runner): Pass maxBudgetMs to each beat
 * - Layer 3 (beats): Respect maxBudgetMs with hard stops
 *
 * @param {string} scriptName - Script template name (saas-default, pricing-default, generic)
 * @param {number} durationMs - Total scene duration in milliseconds
 * @param {Function} rng - Seeded random number generator [0,1)
 * @returns {Array} Array of beat configs with allocated durations
 */
function allocateBeats(scriptName, durationMs, rng) {
  const template = SCRIPTS[scriptName];
  if (!template) {
    console.warn(`[Scheduler] Unknown script "${scriptName}", using generic`);
    return allocateBeats('generic', durationMs, rng);
  }

  const beats = [];
  let remaining = durationMs;

  for (let i = 0; i < template.length; i++) {
    const beat = template[i];
    const isLast = (i === template.length - 1);
    const beatsRemaining = template.length - i - 1;

    // Reserve time for upcoming beats (prevents overshoot)
    const mustReserve = beatsRemaining * MIN_BEAT_MS;
    const availableForThis = Math.max(MIN_BEAT_MS, remaining - mustReserve);

    if (isLast) {
      // CRITICAL: Give ALL remaining time to final beat
      // (reservation logic already ensures remaining >= MIN_BEAT_MS)
      beats.push({
        ...beat,
        duration: remaining  // Exactly remaining, not Math.max(MIN_BEAT_MS, remaining)
      });
      remaining = 0;
    } else {
      // Pick duration from range, capped by available time
      const [min, max] = beat.durationRange;
      const want = Math.max(MIN_BEAT_MS, min + (max - min) * rng());
      const allocated = Math.min(want, availableForThis);

      beats.push({
        ...beat,
        duration: allocated
      });
      remaining -= allocated;
    }
  }

  // Log allocation for debugging
  const totalAllocated = beats.reduce((sum, b) => sum + b.duration, 0);
  console.log(`[Scheduler] Script: ${scriptName}, Target: ${durationMs}ms, Allocated: ${totalAllocated}ms, Drift: ${totalAllocated - durationMs}ms`);

  return beats;
}

/**
 * Get script template names (for debugging/introspection)
 */
function getScripts() {
  return Object.keys(SCRIPTS);
}

module.exports = {
  allocateBeats,
  getScripts,
  MIN_BEAT_MS
};
