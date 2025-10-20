// Tiny action DSL implementations
const { normalizeUrl } = require('../utils/urlNormalizer');
const { retryWithBackoff } = require('../utils/retryWithBackoff');

async function doGoto(page, url, hme = null) {
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

  // Wait a moment for page to settle after navigation
  await page.waitForTimeout(500);

  // Re-inject cursor after navigation if HME is initialized
  // (Navigation resets the DOM, wiping any injected elements)
  if (hme && hme.initialized) {
    await hme.reinject(page);
  }
}

async function doWait(page, ms) {
  await page.waitForTimeout(ms);
}

async function doClickText(page, text, hme = null) {
  const locator = page.getByText(text, { exact: false }).first();
  if (await locator.count() === 0) return;
  await locator.scrollIntoViewIfNeeded();

  // Use HME for realistic cursor movement before clicking
  if (hme) {
    await hme.moveToElement(locator, 90);
    await hme.hover(300 + Math.round(200 * Math.random()));
  }

  await locator.click({ timeout: 3000 });
}

async function doHighlight(page, text, ms = 2000, hme = null) {
  // Use HME to move cursor to the element before highlighting
  if (hme) {
    try {
      const targetRect = await page.evaluate((needle) => {
        const rx = new RegExp(needle, 'i');
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const n = walker.currentNode;
          if (rx.test(n.textContent || '')) {
            const target = n.parentElement;
            const r = target.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
          }
        }
        return null;
      }, text);

      if (targetRect) {
        await hme.moveTo(
          targetRect.x + targetRect.width / 2,
          targetRect.y + targetRect.height / 2,
          targetRect.width
        );
        await hme.hover(400);
      }
    } catch (err) {
      console.log(`[doHighlight] Error moving to element: ${err.message}`);
    }
  }

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

async function doScroll(page, pattern = 'slow-drift', durationMs = 5000, hme = null) {
  // Use HME for realistic scrolling if available
  if (hme) {
    const targetSeconds = durationMs / 1000;
    const startTime = Date.now();
    let elapsed = 0;
    let burstCount = 0;
    let scrollBackCount = 0;

    while (elapsed < durationMs) {
      // Faster scroll burst with human-like variation (2-3x faster than before)
      const amplitude = 600 + Math.round(600 * Math.random()); // 600-1200px (was 240-480px)
      const duration = 300 + Math.round(300 * Math.random()); // 300-600ms (was 320-540ms)

      // Use coordinated scroll+cursor movement
      await hme.scrollBurstWithCursor(amplitude, duration);
      burstCount++;

      elapsed = Date.now() - startTime;
      if (elapsed >= durationMs) break;

      // Variable pause duration - sometimes quick glance, sometimes longer highlight
      const isLongPause = Math.random() < 0.4; // 40% long pauses
      const pauseMs = isLongPause
        ? 1500 + Math.round(1500 * Math.random()) // Long: 1500-3000ms
        : 400 + Math.round(400 * Math.random());  // Short: 400-800ms

      const actualPauseMs = Math.min(pauseMs, durationMs - elapsed);

      // During pause, 60% chance to hover over an interesting element
      if (Math.random() < 0.6) {
        const element = await hme.findInterestingElement();
        if (element) {
          const targetX = element.rect.x + element.rect.width / 2;
          const targetY = element.rect.y + element.rect.height / 2;
          await hme.moveTo(targetX, targetY, element.rect.width);
          await hme.hover(Math.min(actualPauseMs, 600 + Math.round(400 * Math.random())));
          console.log(`[doScroll] Hovered over ${element.type} during pause`);
        } else {
          // Fallback to regular pause if no element found
          await page.waitForTimeout(actualPauseMs);
        }
      } else {
        // 40% chance: just idle with small cursor drift
        await page.waitForTimeout(actualPauseMs);
      }

      elapsed = Date.now() - startTime;
      if (elapsed >= durationMs) break;

      // More frequent scroll-backs (2-3 times per session instead of just once)
      const shouldScrollBack = scrollBackCount < 3 && Math.random() < 0.25; // 25% chance each burst
      if (shouldScrollBack) {
        // Scroll back up to re-highlight something
        const scrollBackAmount = 150 + Math.round(150 * Math.random()); // 150-300px
        await hme.scrollBurstWithCursor(-scrollBackAmount, 300);
        await page.waitForTimeout(400 + Math.round(300 * Math.random()));
        scrollBackCount++;
        console.log(`[doScroll] Scroll-back #${scrollBackCount}: ${scrollBackAmount}px`);
        elapsed = Date.now() - startTime;
      }
    }

    console.log(`[doScroll] HME scrolling complete: ${burstCount} bursts, ${scrollBackCount} scroll-backs over ${elapsed}ms`);
    return;
  }

  // Fallback to old behavior if HME not available
  const stepMs = 120;
  await page.evaluate(async ({ pattern, durationMs, stepMs }) => {
    const t0 = performance.now();
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const total = Math.max(0, document.body.scrollHeight - window.innerHeight);
    let y = window.scrollY;
    while (performance.now() - t0 < durationMs) {
      if (pattern === 'pause-peek') {
        window.scrollBy(0, window.innerHeight * 0.35);
        await pause(stepMs * 8);
        window.scrollBy(0, -window.innerHeight * 0.1);
        await pause(stepMs * 5);
      } else {
        // slow-drift
        const step = Math.max(1, total / 300);
        y += step;
        window.scrollTo({ top: y, behavior: 'instant' });
        await pause(stepMs);
      }
    }
  }, { pattern, durationMs, stepMs });
}

module.exports = { doGoto, doWait, doClickText, doHighlight, doScroll };
