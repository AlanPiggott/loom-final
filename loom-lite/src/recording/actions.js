// Tiny action DSL implementations
const { normalizeUrl } = require('../utils/urlNormalizer');
const { retryWithBackoff } = require('../utils/retryWithBackoff');
const { generateContentAwareScrollSegments, executeScrollSegments, generateScrollSegments } = require('../hme/scroll');

async function doGoto(page, url) {
  // Normalize URL to ensure it has a protocol (https:// or http://)
  const normalizedUrl = normalizeUrl(url);
  console.log(`[doGoto] Navigating to: ${normalizedUrl}${url !== normalizedUrl ? ` (normalized from: ${url})` : ''}`);

  // Wrap navigation in retry logic to handle timeouts and transient failures
  await retryWithBackoff(async () => {
    await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }, {
    maxRetries: 3,
    initialDelayMs: 2000,
    shouldRetry: (error) => {
      // Retry on timeout errors or navigation failures
      const isTimeout = error.message?.includes('Timeout') || error.message?.includes('timeout');
      const isNavigationError = error.message?.includes('Navigation') || error.message?.includes('navigate');

      if (isTimeout || isNavigationError) {
        console.log(`[doGoto] Navigation failed (${error.message.split('\n')[0]}), will retry...`);
        return true;
      }
      return false;
    }
  });
}

async function doWait(page, ms) {
  await page.waitForTimeout(ms);
}

async function doClickText(page, text) {
  const locator = page.getByText(text, { exact: false }).first();
  if (await locator.count() === 0) return;
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ timeout: 3000 });
}

async function doHighlight(page, text, ms = 2000) {
  await page.evaluate(async ({ needle, dur }) => {
    const rx = new RegExp(needle, 'i');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let target = null;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (rx.test(n.textContent || '')) { target = n.parentElement; break; }
    }
    if (!target) return;
    const r = target.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; left:${r.left-8}px; top:${r.top-8}px;
      width:${r.width+16}px; height:${r.height+16}px;
      border-radius:8px; box-shadow:0 0 0 4px rgba(255,215,0,.85),0 0 24px rgba(255,215,0,.85) inset;
      pointer-events:none; z-index:2147483647; transition:opacity .3s;
    `;
    document.body.appendChild(overlay);
    await new Promise(r => setTimeout(r, dur));
    overlay.remove();
  }, { needle: text, dur: ms });
}

async function doScroll(page, pattern = 'slow-drift', durationMs = 5000) {
  const startTime = Date.now();
  console.log(`[doScroll] Starting ${pattern} scroll for ${durationMs}ms`);

  // Use seeded RNG for deterministic scrolling (based on timestamp for variety)
  const seed = Date.now();
  let randState = seed;
  const rand = () => {
    randState = (randState * 1103515245 + 12345) & 0x7fffffff;
    return randState / 0x7fffffff;
  };

  // Try content-aware scrolling first (pauses at headings like HME)
  let segments = await generateContentAwareScrollSegments(page, {
    totalDurationMs: durationMs,
    rand
  });

  // Fallback to simple scrolling if no content found
  if (!segments || segments.length === 0) {
    console.log('[doScroll] No headings found, using simple scrolling');

    const viewport = await page.evaluate(() => ({
      height: window.innerHeight,
      maxScroll: Math.max(0, document.body.scrollHeight - window.innerHeight)
    }));

    // Calculate scroll distance based on duration (1.5-2 viewports, not entire page)
    const targetScrollPx = Math.min(
      viewport.height * (1.5 + rand() * 0.5),
      viewport.maxScroll
    );

    segments = generateScrollSegments({
      totalDurationMs: durationMs,
      targetScrollPx,
      rand,
      includePeekBack: pattern === 'pause-peek' || rand() > 0.5
    });

    console.log(`[doScroll] Simple plan: ${segments.length} segments, target=${targetScrollPx.toFixed(0)}px`);
  } else {
    console.log(`[doScroll] Content-aware plan: ${segments.length} segments`);
  }

  // Execute scroll segments with exact timing
  await executeScrollSegments(page, segments, durationMs);

  // CRITICAL: Ensure we always take EXACTLY durationMs by padding if needed
  const elapsed = Date.now() - startTime;
  const remaining = durationMs - elapsed;
  if (remaining > 50) {
    console.log(`[doScroll] Padding ${remaining}ms to match exact duration`);
    await page.waitForTimeout(remaining);
  }

  const totalElapsed = Date.now() - startTime;
  console.log(`[doScroll] Completed in ${totalElapsed}ms (target: ${durationMs}ms, drift: ${totalElapsed - durationMs}ms)`);
}

module.exports = { doGoto, doWait, doClickText, doHighlight, doScroll };
