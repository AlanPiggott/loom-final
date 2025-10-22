/**
 * Deterministic string hashing for reproducible seeds
 * Uses FNV-1a algorithm - stable across Node versions
 */

/**
 * Hash a string to a 32-bit unsigned integer
 * @param {string} str - Input string
 * @returns {number} 32-bit unsigned hash
 */
function hashString(str) {
  let h = 0x811c9dc5; // FNV-1a offset basis (32-bit)

  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime (32-bit)
  }

  return h >>> 0; // Convert to unsigned 32-bit integer
}

module.exports = { hashString };
