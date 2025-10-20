/**
 * URL Normalizer Utility
 * Ensures URLs have a valid protocol (http:// or https://)
 */

/**
 * Normalize a URL by adding https:// if no protocol is present
 * @param {string} url - The URL to normalize
 * @returns {string} - Normalized URL with protocol
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL: URL must be a non-empty string');
  }

  const trimmedUrl = url.trim();

  // Check if URL already has a protocol
  if (/^https?:\/\//i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  // Add https:// as default protocol
  return `https://${trimmedUrl}`;
}

module.exports = { normalizeUrl };
