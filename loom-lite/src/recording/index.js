/**
 * HME Module Exports
 *
 * Public API for Human Motion Engine
 * Includes rollback gate via HME_MODE environment variable
 *
 * Usage:
 *   const { HME } = require('./recording');
 *   await HME.runScene(page, { seed, durationSec, url });
 *
 * Rollback:
 *   export HME_MODE="manual"  # Falls back to manual actions (emergency only)
 */

const { HumanMotionEngine } = require('./humanMotion');
const { runScene, inferScript } = require('./hmeRunner');
const { allocateBeats, getScripts } = require('./hmeScheduler');

/**
 * Public HME API
 */
const HME = {
  runScene,
  inferScript,
  allocateBeats,
  getScripts
};

module.exports = {
  HME,
  HumanMotionEngine
};
