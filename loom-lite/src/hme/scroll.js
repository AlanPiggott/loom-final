/**
 * Inertial Scrolling Engine with rAF
 *
 * Simulates trackpad-like scrolling with natural bursts and pauses.
 * Uses requestAnimationFrame for smooth animation.
 *
 * Key features:
 * - Sin/exp envelope functions for natural deceleration
 * - Burst duration: 320-540ms, amplitude: 240-480px
 * - Pause between bursts: 600-1200ms (reading time)
 * - Peek-back support: one reverse burst 80-160px
 * - Velocity capping to prevent teleporting
 * - Deterministic with seeded RNG
 */

/**
 * Generate content-aware scroll segments that pause at headings/sections
 * @param {Page} page - Playwright page
 * @param {Object} params - Scroll parameters
 * @param {number} params.totalDurationMs - Total time for scrolling
 * @param {function} params.rand - Seeded RNG
 * @returns {Promise<Array<Object>>} Array of scroll segments with target positions
 */
async function generateContentAwareScrollSegments(page, { totalDurationMs, rand }) {
  // Find all headings on the page
  const headings = await page.evaluate(() => {
    const elements = [];
    document.querySelectorAll('h1, h2, h3').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0 && rect.width > 0) {
        elements.push({
          y: rect.top + window.scrollY,
          text: el.textContent.trim().substring(0, 50)
        });
      }
    });
    // Sort by vertical position
    return elements.sort((a, b) => a.y - b.y);
  });

  if (headings.length === 0) {
    // Fallback to simple scrolling if no headings found
    return null;
  }

  const segments = [];
  let elapsed = 0;
  const currentScrollY = await page.evaluate(() => window.scrollY);

  // Select 1-2 headings to visit (BUDGET-AWARE)
  const numStops = Math.min(headings.length, 1 + Math.floor(rand() * 2));
  const selectedHeadings = [];
  for (let i = 0; i < numStops; i++) {
    const idx = Math.floor(rand() * headings.length);
    if (!selectedHeadings.includes(headings[idx])) {
      selectedHeadings.push(headings[idx]);
    }
  }
  // Sort by Y position
  selectedHeadings.sort((a, b) => a.y - b.y);

  console.log(`[scrollDrift] Planning ${selectedHeadings.length} heading stops, budget: ${totalDurationMs}ms`);

  // Create segments to each heading (BUDGET-AWARE)
  let currentY = currentScrollY;
  let totalBurstMs = 0;
  let totalPauseMs = 0;

  for (let i = 0; i < selectedHeadings.length; i++) {
    const heading = selectedHeadings[i];
    const targetY = heading.y - 200; // Stop slightly above heading
    const distance = Math.max(100, targetY - currentY);

    // Break into 1-2 bursts (REDUCED from 2+)
    const numBursts = Math.min(2, Math.max(1, Math.floor(distance / 200)));
    const amplitudePerBurst = distance / numBursts;

    for (let j = 0; j < numBursts; j++) {
      // Check if we have budget left
      if (elapsed >= totalDurationMs * 0.9) break;

      const burstDuration = 900 + rand() * 700; // 900-1600ms
      const pauseAfter = 900 + rand() * 900; // 900-1800ms

      // Clamp to remaining budget
      const remaining = totalDurationMs * 0.9 - elapsed;
      const actualBurst = Math.min(burstDuration, remaining);
      const actualPause = Math.min(pauseAfter, remaining - actualBurst);

      if (actualBurst < 300) break; // Don't add if too short

      segments.push({
        durationMs: actualBurst,
        amplitudePx: amplitudePerBurst,
        envelope: 'sin',
        pauseAfterMs: actualPause
      });

      elapsed += actualBurst + actualPause;
      totalBurstMs += actualBurst;
      totalPauseMs += actualPause;
    }

    // Reading pause at heading (1200-2200ms)
    if (elapsed < totalDurationMs * 0.85) {
      const readingPause = 1200 + rand() * 1000;
      const remaining = totalDurationMs * 0.9 - elapsed;
      const actualReading = Math.min(readingPause, remaining);

      if (actualReading >= 500 && segments.length > 0) {
        segments[segments.length - 1].pauseAfterMs = actualReading;
        elapsed += actualReading - totalPauseMs; // Adjust (already counted pause)
        totalPauseMs += actualReading;
      }
    }

    currentY = targetY;

    // Stop if budget is tight
    if (elapsed >= totalDurationMs * 0.85) break;
  }

  console.log(`[scrollDrift] Plan: ${segments.length} segments, totalBurst=${totalBurstMs}ms, totalPause=${totalPauseMs}ms, total=${elapsed}ms`);

  return segments;
}

/**
 * Generate scroll segments for a given duration
 * @param {Object} params - Scroll parameters
 * @param {number} params.totalDurationMs - Total time for scrolling
 * @param {number} params.targetScrollPx - Approximate scroll distance
 * @param {function} params.rand - Seeded RNG
 * @param {boolean} [params.includePeekBack=true] - Include peek-back burst
 * @returns {Array<Object>} Array of scroll segments
 */
function generateScrollSegments({
  totalDurationMs,
  targetScrollPx,
  rand,
  includePeekBack = true
}) {
  const segments = [];
  let elapsed = 0;
  let accumulatedScroll = 0;

  // Reserve time for peek-back if enabled
  const peekBackTime = includePeekBack ? (80 + rand() * 80) + (600 + rand() * 600) : 0; // burst + pause
  const availableTime = totalDurationMs - peekBackTime;

  // Generate forward bursts
  while (elapsed < availableTime && accumulatedScroll < targetScrollPx) {
    // Burst duration: 900-1600ms (SLOW, SMOOTH)
    const burstDuration = 900 + rand() * 700;

    // Burst amplitude: 60-140px (SMALL for slow reading pace)
    // Result: ~0.06-0.12 px/ms = 60-120 px/s
    const burstAmplitude = 60 + rand() * 80;

    // Choose envelope (prefer sin for natural bursts)
    const envelope = rand() > 0.2 ? 'sin' : 'exp';

    // Pause after burst: 900-1800ms (READING TIME)
    const pauseAfter = 900 + rand() * 900;

    segments.push({
      durationMs: burstDuration,
      amplitudePx: burstAmplitude,
      envelope,
      pauseAfterMs: pauseAfter
    });

    elapsed += burstDuration + pauseAfter;
    accumulatedScroll += burstAmplitude;
  }

  // Add peek-back burst (reverse scroll)
  if (includePeekBack && segments.length > 0) {
    const peekBackAmplitude = -(60 + rand() * 60); // Negative = scroll up, 60-120px
    const peekBackDuration = 500 + rand() * 400; // 500-900ms

    segments.push({
      durationMs: peekBackDuration,
      amplitudePx: peekBackAmplitude,
      envelope: 'sin',
      pauseAfterMs: 250 + rand() * 200 // 250-450ms pause after peek-back
    });
  }

  return segments;
}

/**
 * Sin envelope function: Δy(t) = A × sin(πt/T)
 * Natural burst with smooth start and end
 * @param {number} t - Elapsed time in ms
 * @param {number} T - Total duration in ms
 * @param {number} A - Amplitude in px
 * @returns {number} Instantaneous velocity (px/ms)
 */
function sinEnvelope(t, T, A) {
  const u = Math.min(1, t / T); // Normalized time [0, 1]
  const velocity = (A / T) * Math.PI * Math.cos(Math.PI * u);
  return velocity;
}

/**
 * Exp envelope function: starts fast, exponential decay
 * @param {number} t - Elapsed time in ms
 * @param {number} T - Total duration in ms
 * @param {number} A - Amplitude in px
 * @param {number} [lambda=4] - Decay rate
 * @returns {number} Instantaneous velocity (px/ms)
 */
function expEnvelope(t, T, A, lambda = 4) {
  const u = Math.min(1, t / T);
  const velocity = (A / T) * lambda * Math.exp(-lambda * u);
  return velocity;
}

/**
 * Min-jerk easing function for smooth motion
 * @param {number} u - Normalized time [0, 1]
 * @returns {number} Eased value [0, 1]
 */
function minJerkEase(u) {
  return 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;
}

/**
 * Execute scroll segments using displacement-based easing (time-exact, smooth)
 * @param {Page} page - Playwright page
 * @param {Array<Object>} segments - Scroll segments
 * @param {number} [maxBudgetMs] - Maximum time budget (optional, for clamping)
 * @returns {Promise<void>}
 */
async function executeScrollSegments(page, segments, maxBudgetMs = null) {
  if (!segments || segments.length === 0) return;

  await page.evaluate(({ segmentsData, budgetMs }) => {
    return new Promise((resolve) => {
      const beatStartTime = performance.now();
      let segmentIndex = 0;
      let segmentStartTime = null;
      let segmentStartY = null;
      let pauseStartTime = null;
      let inPause = false;

      const maxScroll = Math.max(0, document.body.scrollHeight - window.innerHeight);

      // Min-jerk easing (smooth acceleration/deceleration)
      function minJerk(u) {
        return 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;
      }

      function frame(timestamp) {
        const currentSegment = segmentsData[segmentIndex];
        if (!currentSegment) {
          resolve();
          return;
        }

        // Check budget
        if (budgetMs) {
          const elapsed = timestamp - beatStartTime;
          if (elapsed >= budgetMs) {
            resolve();
            return;
          }
        }

        // Start segment
        if (segmentStartTime === null) {
          segmentStartTime = timestamp;
          segmentStartY = window.scrollY || window.pageYOffset;
        }

        // Handle pause
        if (inPause) {
          const pauseElapsed = timestamp - pauseStartTime;
          if (pauseElapsed >= currentSegment.pauseAfterMs) {
            // Pause complete, move to next segment
            segmentIndex++;
            segmentStartTime = null;
            segmentStartY = null;
            inPause = false;
          }
          requestAnimationFrame(frame);
          return;
        }

        // Active scroll burst (displacement-based)
        const elapsed = timestamp - segmentStartTime;
        const u = Math.min(1, elapsed / currentSegment.durationMs);

        if (u >= 1) {
          // Burst complete - snap to exact final position
          const finalY = Math.max(0, Math.min(maxScroll, segmentStartY + currentSegment.amplitudePx));
          window.scrollTo(0, finalY);

          // Enter pause or next segment
          if (currentSegment.pauseAfterMs > 0) {
            inPause = true;
            pauseStartTime = timestamp;
          } else {
            segmentIndex++;
            segmentStartTime = null;
            segmentStartY = null;
          }
          requestAnimationFrame(frame);
          return;
        }

        // Displacement-based easing (smooth, time-exact)
        const eased = minJerk(u);
        const currentY = segmentStartY + currentSegment.amplitudePx * eased;
        const clampedY = Math.max(0, Math.min(maxScroll, currentY));

        window.scrollTo(0, clampedY);

        requestAnimationFrame(frame);
      }

      requestAnimationFrame(frame);
    });
  }, { segmentsData: segments, budgetMs: maxBudgetMs });
}

/**
 * Scroll to reveal an element (accounting for topMargin)
 * @param {Page} page - Playwright page
 * @param {Object} element - Element with y coordinate
 * @param {number} [topMargin=120] - Top margin for sticky headers
 * @param {number} [durationMs=600] - Scroll duration
 * @returns {Promise<void>}
 */
async function scrollToReveal(page, element, topMargin = 120, durationMs = 600) {
  if (!element) return;

  await page.evaluate(({ targetY, topMargin, duration }) => {
    return new Promise((resolve) => {
      const startY = window.scrollY;
      const endY = Math.max(0, targetY + window.scrollY - topMargin - window.innerHeight / 2);
      const distance = endY - startY;

      if (Math.abs(distance) < 10) {
        resolve();
        return;
      }

      const startTime = performance.now();

      function frame() {
        const elapsed = performance.now() - startTime;
        const u = Math.min(1, elapsed / duration);

        // Ease out cubic
        const s = 1 - Math.pow(1 - u, 3);
        const currentY = startY + distance * s;

        window.scrollTo({
          top: currentY,
          behavior: 'instant'
        });

        if (u >= 1) {
          resolve();
        } else {
          requestAnimationFrame(frame);
        }
      }

      requestAnimationFrame(frame);
    });
  }, { targetY: element.y, topMargin, duration: durationMs });
}

/**
 * Simple scroll by a delta amount
 * @param {Page} page - Playwright page
 * @param {number} deltaY - Scroll distance in pixels (positive = down)
 * @param {number} [durationMs=300] - Duration
 * @returns {Promise<void>}
 */
async function scrollBy(page, deltaY, durationMs = 300) {
  await page.evaluate(({ delta, duration }) => {
    return new Promise((resolve) => {
      const startY = window.scrollY;
      const endY = Math.max(0, Math.min(
        startY + delta,
        document.body.scrollHeight - window.innerHeight
      ));
      const distance = endY - startY;

      if (Math.abs(distance) < 1) {
        resolve();
        return;
      }

      const startTime = performance.now();

      function frame() {
        const elapsed = performance.now() - startTime;
        const u = Math.min(1, elapsed / duration);
        const s = 1 - Math.pow(1 - u, 3); // Ease out cubic

        const currentY = startY + distance * s;
        window.scrollTo({
          top: currentY,
          behavior: 'instant'
        });

        if (u >= 1) {
          resolve();
        } else {
          requestAnimationFrame(frame);
        }
      }

      requestAnimationFrame(frame);
    });
  }, { delta: deltaY, duration: durationMs });
}

module.exports = {
  generateScrollSegments,
  generateContentAwareScrollSegments,
  executeScrollSegments,
  scrollToReveal,
  scrollBy,
  sinEnvelope,
  expEnvelope
};
