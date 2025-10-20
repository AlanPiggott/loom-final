/**
 * Retry with Exponential Backoff Utility
 * Retries async operations with increasing delays between attempts
 */

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retry attempts (default: 5)
 * @param {number} options.initialDelayMs - Initial delay in milliseconds (default: 2000)
 * @param {number} options.multiplier - Backoff multiplier (default: 2)
 * @param {number} options.maxDelayMs - Maximum delay cap (default: 32000)
 * @param {Function} options.shouldRetry - Custom function to determine if error should be retried
 * @returns {Promise} - Result of the function or throws last error
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = parseInt(process.env.BROWSERLESS_MAX_RETRIES) || 5,
    initialDelayMs = parseInt(process.env.BROWSERLESS_INITIAL_RETRY_DELAY_MS) || 2000,
    multiplier = 2,
    maxDelayMs = 32000,
    shouldRetry = () => true
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if this is the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Check if we should retry this error
      if (!shouldRetry(error)) {
        throw error;
      }

      // Check for rate limiting (429 error)
      const is429 = error.message && error.message.includes('429');
      const isTooManyRequests = error.message && error.message.toLowerCase().includes('too many requests');

      if (is429 || isTooManyRequests) {
        console.log(`[retryWithBackoff] Rate limit detected (429), attempt ${attempt + 1}/${maxRetries}`);
      } else {
        console.log(`[retryWithBackoff] Retry attempt ${attempt + 1}/${maxRetries} after error:`, error.message);
      }

      // Calculate delay with exponential backoff
      const baseDelay = initialDelayMs * Math.pow(multiplier, attempt);
      // Add jitter (random 0-25%) to prevent thundering herd
      const jitter = Math.random() * 0.25 * baseDelay;
      const delay = Math.min(baseDelay + jitter, maxDelayMs);

      console.log(`[retryWithBackoff] Waiting ${Math.round(delay)}ms before retry...`);
      await sleep(delay);
    }
  }

  // All retries exhausted
  console.error(`[retryWithBackoff] All ${maxRetries} retry attempts failed`);
  throw lastError;
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Resolves after delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { retryWithBackoff, sleep };
