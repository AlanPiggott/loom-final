/**
 * Seeded Random Number Generator (RNG)
 *
 * Uses Mulberry32 algorithm for deterministic pseudo-random numbers.
 * Given the same seed, always produces the same sequence.
 *
 * Usage:
 *   const rand = createRNG(12345);
 *   const value = rand(); // returns [0, 1)
 */

/**
 * Creates a seeded RNG using Mulberry32 algorithm
 * @param {number} seed - 32-bit integer seed
 * @returns {function(): number} Function that returns random values in [0,1)
 */
function createRNG(seed) {
  let state = seed >>> 0; // Ensure unsigned 32-bit integer

  return function() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a string to a 32-bit seed (FNV-1a algorithm)
 * @param {string} str - String to hash
 * @returns {number} 32-bit unsigned integer
 */
function hashString(str) {
  let hash = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0;
}

module.exports = {
  createRNG,
  hashString
};
