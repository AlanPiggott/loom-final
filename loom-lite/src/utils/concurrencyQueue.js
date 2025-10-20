/**
 * Concurrency Queue Utility
 * Process async tasks with controlled concurrency (parallel batching)
 */

/**
 * Process an array of tasks with limited concurrency
 * @param {Array} items - Array of items to process
 * @param {Function} processor - Async function to process each item
 * @param {number} concurrency - Maximum number of concurrent operations
 * @returns {Promise<Array>} - Array of results
 */
async function processConcurrently(items, processor, concurrency = 1) {
  const results = [];
  const errors = [];

  // Process items in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);

    console.log(`[concurrencyQueue] Processing batch ${Math.floor(i / concurrency) + 1} (items ${i + 1}-${Math.min(i + concurrency, items.length)} of ${items.length})`);

    // Process batch in parallel
    const batchPromises = batch.map(async (item, batchIndex) => {
      const itemIndex = i + batchIndex;
      try {
        const result = await processor(item, itemIndex);
        return { success: true, index: itemIndex, result };
      } catch (error) {
        console.error(`[concurrencyQueue] Item ${itemIndex + 1} failed:`, error.message);
        return { success: false, index: itemIndex, error };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    // Collect results and errors
    batchResults.forEach(({ success, index, result, error }) => {
      if (success) {
        results.push({ index, result });
      } else {
        errors.push({ index, error });
      }
    });
  }

  return { results, errors };
}

module.exports = { processConcurrently };
