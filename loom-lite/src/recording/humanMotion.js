/**
 * Human Motion Engine (HME)
 *
 * Generates realistic, human-like cursor movements and scrolling behavior
 * using physics-based motion models, micro-variability, and DOM awareness.
 */

// ============================================================================
// MATH PRIMITIVES
// ============================================================================

/**
 * Seeded pseudo-random number generator (mulberry32)
 * Ensures reproducible motion across renders
 */
function mulberry32(seed) {
  let t = seed | 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let n = Math.imul(t ^ (t >>> 15), 1 | t);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Low-pass filtered noise generator for smooth micro-jitter
 */
function smoothNoise1D() {
  let y = 0;
  return (rng, sigma = 1, alpha = 0.15) => {
    y = (1 - alpha) * y + alpha * ((rng() * 2 - 1) * sigma);
    return y;
  };
}

/**
 * Minimum-jerk S-curve for smooth acceleration/deceleration
 * Creates natural-looking easing (10u³ - 15u⁴ + 6u⁵)
 */
const sCurve = u => u * u * u * (10 + u * (-15 + 6 * u));

/**
 * Calculate movement duration using Fitts' Law
 * T = a + b * log2(1 + D/W)
 * where D = distance, W = target width
 */
function calculateMoveDuration(distance, targetWidth = 80) {
  const a = 120; // base time (ms)
  const b = 150; // scaling factor
  const T = a + b * Math.log2(1 + distance / targetWidth);
  return Math.max(120, Math.min(1200, T)); // clamp to human range
}

/**
 * Generate a smooth curved path from p0 to p1 using cubic Bézier
 * with added micro-variability and decaying noise
 */
function generatePath(p0, p1, durMs, rng) {
  const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);

  if (d < 2) {
    // Too close, just return single frame
    return [{ x: p1.x, y: p1.y, dt: 16 }];
  }

  // Calculate normal vector for curvature offset
  const nx = (p1.y - p0.y) / d;
  const ny = -(p1.x - p0.x) / d;

  // Small curvature (2-8% of distance), random side
  const k = d * (0.02 + 0.06 * rng()) * (rng() > 0.5 ? 1 : -1);

  // Cubic Bézier control points
  const c1 = {
    x: p0.x + (p1.x - p0.x) * 0.33 + nx * k,
    y: p0.y + (p1.y - p0.y) * 0.33 + ny * k
  };
  const c2 = {
    x: p0.x + (p1.x - p0.x) * 0.66 - nx * k,
    y: p0.y + (p1.y - p0.y) * 0.66 - ny * k
  };

  // Generate smooth noise for micro-jitter
  const jitterX = smoothNoise1D();
  const jitterY = smoothNoise1D();

  const frames = [];
  const hz = 60;
  const n = Math.max(6, Math.round((durMs / 1000) * hz));

  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const s = sCurve(u);

    // Cubic Bézier interpolation
    const bx = Math.pow(1 - s, 3) * p0.x +
               3 * Math.pow(1 - s, 2) * s * c1.x +
               3 * (1 - s) * s * s * c2.x +
               s * s * s * p1.x;
    const by = Math.pow(1 - s, 3) * p0.y +
               3 * Math.pow(1 - s, 2) * s * c1.y +
               3 * (1 - s) * s * s * c2.y +
               s * s * s * p1.y;

    // Decaying jitter (fades as cursor approaches target)
    const fade = (1 - u) * (1 - u);
    const jx = jitterX(rng, 0.9, 0.18) * fade;
    const jy = jitterY(rng, 0.9, 0.18) * fade;

    frames.push({
      x: bx + jx,
      y: by + jy,
      dt: 1000 / hz
    });
  }

  return frames;
}

// ============================================================================
// HUMAN MOTION ENGINE CLASS
// ============================================================================

class HumanMotionEngine {
  constructor(seed = Date.now(), persona = 'trackpad') {
    this.rng = mulberry32(seed);
    this.persona = persona; // 'trackpad' or 'wheel'
    this.currentPos = { x: 200, y: 160 }; // starting position
    this.page = null;
    this.initialized = false;

    console.log(`[HME] Initialized with seed ${seed}, persona: ${persona}`);
  }

  /**
   * Initialize HME with a Playwright page
   */
  async init(page) {
    this.page = page;
    await this.injectCursor(page);
    this.initialized = true;
    console.log('[HME] Cursor overlay injected');
  }

  /**
   * Inject custom cursor overlay (CSS cursor:none + fixed div)
   * Uses page.evaluate() to bypass CSP restrictions
   */
  async injectCursor(page) {
    await page.evaluate((startPos) => {
      // Inject styles directly into the DOM (bypasses CSP)
      const styleEl = document.createElement('style');
      styleEl.id = 'hme-cursor-styles';
      styleEl.textContent = `
        * { cursor: none !important; }
        #hme-cursor {
          position: fixed;
          left: ${startPos.x}px;
          top: ${startPos.y}px;
          width: 20px;
          height: 20px;
          z-index: 2147483647;
          pointer-events: none;
          opacity: 1;
        }
        #hme-cursor svg {
          position: absolute;
          top: 0;
          left: 0;
          width: 20px;
          height: 20px;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));
        }
      `;
      document.head.appendChild(styleEl);

      // Create cursor element
      const el = document.createElement('div');
      el.id = 'hme-cursor';

      // Create SVG cursor - standard white arrow with black outline
      el.innerHTML = `
        <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <!-- Black outline -->
          <path d="M 0 0 L 0 16 L 6 10 L 10 18 L 12 17 L 8 9 L 14 9 Z"
                fill="black" stroke="black" stroke-width="0.5"/>
          <!-- White fill -->
          <path d="M 1 1 L 1 14 L 6 9 L 9.5 16.5 L 10.5 16 L 7 8.5 L 12.5 8.5 Z"
                fill="white"/>
        </svg>
      `;

      document.body.appendChild(el);

      window.__hme = { el, x: startPos.x, y: startPos.y };
    }, this.currentPos);
  }

  /**
   * Re-inject cursor after navigation (DOM reset)
   * Removes old cursor element and styles if present, then injects fresh ones
   */
  async reinject(page) {
    // Remove old cursor element and styles if they exist
    await page.evaluate(() => {
      const oldCursor = document.getElementById('hme-cursor');
      if (oldCursor) {
        oldCursor.remove();
      }
      const oldStyles = document.getElementById('hme-cursor-styles');
      if (oldStyles) {
        oldStyles.remove();
      }
    });

    // Re-inject cursor
    await this.injectCursor(page);
    console.log('[HME] Cursor re-injected after navigation');
  }

  /**
   * Check if cursor element exists in DOM
   */
  async cursorExists() {
    if (!this.page) return false;
    return await this.page.evaluate(() => {
      return !!document.getElementById('hme-cursor');
    });
  }

  /**
   * Ensure cursor exists, reinject if missing (defensive check)
   */
  async ensureCursor() {
    if (!this.page) return;
    const exists = await this.cursorExists();
    if (!exists) {
      console.log('[HME] Cursor missing, re-injecting...');
      await this.reinject(this.page);
    }
  }

  /**
   * Get current cursor position
   */
  getCurrentPosition() {
    return { ...this.currentPos };
  }

  /**
   * Move cursor to absolute coordinates with realistic motion
   */
  async moveTo(x, y, targetWidth = 80) {
    if (!this.initialized) {
      throw new Error('[HME] Not initialized. Call init(page) first.');
    }

    // Defensive check: ensure cursor exists before animating
    await this.ensureCursor();

    const p0 = this.getCurrentPosition();
    const p1 = { x, y };
    const distance = Math.hypot(p1.x - p0.x, p1.y - p0.y);

    if (distance < 2) {
      return; // Too close, skip movement
    }

    const durMs = calculateMoveDuration(distance, targetWidth);
    const frames = generatePath(p0, p1, durMs, this.rng);

    console.log(`[HME] Moving ${Math.round(distance)}px in ${Math.round(durMs)}ms`);

    await this.animateMove(frames);
    this.currentPos = { x, y };
  }

  /**
   * Move cursor to a Playwright locator
   */
  async moveToElement(locator, targetWidth = 90) {
    const box = await locator.boundingBox();
    if (!box) {
      console.warn('[HME] Element not visible, skipping move');
      return;
    }

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.moveTo(x, y, targetWidth);
  }

  /**
   * Hover at current position with subtle jitter
   */
  async hover(durationMs) {
    if (!this.initialized) return;

    // Defensive check: ensure cursor exists
    await this.ensureCursor();

    const startTime = Date.now();
    const basePos = this.getCurrentPosition();

    await this.page.evaluate(async ({ durationMs, baseX, baseY }) => {
      const cur = window.__hme.el;
      const start = performance.now();
      let t = 0;

      function jitter(t, sigma = 0.8, freq = 3) {
        return sigma * Math.sin(t * freq * 2 * Math.PI);
      }

      while (t < durationMs) {
        const dx = jitter(t / 1000, 0.6, 2.8);
        const dy = jitter(t / 1000 + 0.3, 0.6, 3.2);
        const x = baseX + dx;
        const y = baseY + dy;
        cur.style.transform = `translate(${x}px, ${y}px)`;
        cur.style.setProperty('--x', `${x}px`);
        cur.style.setProperty('--y', `${y}px`);

        await new Promise(r => requestAnimationFrame(r));
        t = performance.now() - start;
      }

      // Return to base position
      cur.style.transform = `translate(${baseX}px, ${baseY}px)`;
      cur.style.setProperty('--x', `${baseX}px`);
      cur.style.setProperty('--y', `${baseY}px`);
    }, { durationMs, baseX: basePos.x, baseY: basePos.y });

    const elapsed = Date.now() - startTime;
    console.log(`[HME] Hovered for ${Math.round(elapsed)}ms`);
  }

  /**
   * Animate cursor movement using requestAnimationFrame
   */
  async animateMove(frames) {
    await this.page.evaluate(async (frames) => {
      const cur = window.__hme.el;
      for (const f of frames) {
        cur.style.left = `${f.x}px`;
        cur.style.top = `${f.y}px`;
        window.__hme.x = f.x;
        window.__hme.y = f.y;
        await new Promise(r => requestAnimationFrame(r));
      }
    }, frames);
  }

  /**
   * Perform a scroll burst with inertial trackpad-style motion
   */
  async scrollBurst(amplitude = 360, durationMs = 420) {
    if (!this.initialized) return;

    // Defensive check: ensure cursor exists (scrolling is still visible without cursor, but good to verify)
    await this.ensureCursor();

    const A = amplitude;
    const Tb = durationMs;

    await this.page.evaluate(async ({ A, Tb }) => {
      const scroller = document.scrollingElement || document.documentElement;
      const start = performance.now();
      let t = 0;

      while (t < Tb) {
        const u = t / Tb;
        const dy = A * Math.sin(Math.PI * u) * 0.016; // ramp up then down
        scroller.scrollBy({ top: dy, behavior: 'auto' });

        await new Promise(r => requestAnimationFrame(r));
        t = performance.now() - start;
      }
    }, { A, Tb });

    console.log(`[HME] Scroll burst: ${Math.round(amplitude)}px over ${Math.round(durationMs)}ms`);
  }

  /**
   * Scroll burst WITH coordinated cursor movement
   * Cursor drifts down (or up) the viewport while scrolling
   */
  async scrollBurstWithCursor(amplitude = 600, durationMs = 450) {
    if (!this.initialized) return;

    // Defensive check: ensure cursor exists
    await this.ensureCursor();

    // Determine cursor drift during scroll
    // If scrolling down, cursor moves down viewport (e.g., from y=300 to y=500)
    // If scrolling up, cursor moves up viewport
    const cursorStartY = this.currentPos.y;
    const viewportDrift = Math.sign(amplitude) * (150 + Math.round(100 * this.rng())); // 150-250px drift
    const cursorEndY = Math.max(100, Math.min(620, cursorStartY + viewportDrift)); // Keep cursor in viewport

    // Small horizontal drift too (natural mouse wiggle)
    const cursorStartX = this.currentPos.x;
    const horizontalDrift = (this.rng() - 0.5) * 60; // -30 to +30px
    const cursorEndX = Math.max(100, Math.min(1180, cursorStartX + horizontalDrift));

    // Start scroll and cursor movement simultaneously
    const scrollPromise = this.page.evaluate(async ({ A, Tb }) => {
      const scroller = document.scrollingElement || document.documentElement;
      const start = performance.now();
      let t = 0;

      while (t < Tb) {
        const u = t / Tb;
        const dy = A * Math.sin(Math.PI * u) * 0.016; // ramp up then down
        scroller.scrollBy({ top: dy, behavior: 'auto' });

        await new Promise(r => requestAnimationFrame(r));
        t = performance.now() - start;
      }
    }, { A: amplitude, Tb: durationMs });

    // Move cursor simultaneously (but don't await yet)
    const cursorPromise = this.moveTo(cursorEndX, cursorEndY, 80);

    // Wait for both to complete
    await Promise.all([scrollPromise, cursorPromise]);

    console.log(`[HME] Scroll+cursor: ${Math.round(amplitude)}px scroll, cursor (${Math.round(cursorStartX)},${Math.round(cursorStartY)}) → (${Math.round(cursorEndX)},${Math.round(cursorEndY)})`);
  }

  /**
   * Scroll to reveal an element with margin from top
   */
  async scrollToReveal(locator, topMargin = 120) {
    const box = await locator.boundingBox();
    if (!box) {
      console.warn('[HME] Element not visible for scroll');
      return;
    }

    const currentScroll = await this.page.evaluate(() => {
      return (document.scrollingElement || document.documentElement).scrollTop;
    });

    const targetY = box.y + currentScroll - topMargin;
    const distance = targetY - currentScroll;

    if (Math.abs(distance) < 50) {
      return; // Already in view
    }

    // Perform multiple bursts to reach target
    const numBursts = Math.ceil(Math.abs(distance) / 400);
    for (let i = 0; i < numBursts; i++) {
      const remaining = targetY - await this.page.evaluate(() => {
        return (document.scrollingElement || document.documentElement).scrollTop;
      });

      if (Math.abs(remaining) < 50) break;

      const amp = Math.min(Math.abs(remaining), 320 + 200 * this.rng());
      const dur = 340 + 240 * this.rng();
      await this.scrollBurst(Math.sign(remaining) * amp, dur);

      if (i < numBursts - 1) {
        await this.page.waitForTimeout(900 + Math.round(1200 * this.rng()));
      }
    }
  }

  /**
   * Perform a "peek" - small reverse scroll and continue
   */
  async peek() {
    const peekSize = 80 + Math.round(80 * this.rng());
    const pauseMs = 250 + Math.round(200 * this.rng());

    console.log(`[HME] Peek: ${peekSize}px`);

    // Scroll up
    await this.scrollBurst(-peekSize, 280);
    await this.page.waitForTimeout(pauseMs);
    // Scroll back down
    await this.scrollBurst(peekSize, 280);
  }

  /**
   * Find points of interest in the viewport (headings, nav, CTAs)
   */
  async findPointsOfInterest() {
    return await this.page.evaluate(() => {
      const elements = [];
      const viewport = {
        top: window.scrollY,
        bottom: window.scrollY + window.innerHeight,
        centerY: window.scrollY + window.innerHeight / 2
      };

      // Score headings
      document.querySelectorAll('h1, h2, h3').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top + window.scrollY < viewport.bottom &&
            rect.bottom + window.scrollY > viewport.top) {
          elements.push({
            type: 'heading',
            element: el,
            score: 10,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          });
        }
      });

      // Score nav items with interesting text
      document.querySelectorAll('nav a, header a').forEach(el => {
        const text = el.textContent.toLowerCase();
        if (/pricing|customers|features|demo|about|product/i.test(text)) {
          const rect = el.getBoundingClientRect();
          elements.push({
            type: 'nav',
            element: el,
            score: 8,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          });
        }
      });

      // Score CTAs
      document.querySelectorAll('button, .btn, a.button, [role="button"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top + window.scrollY < viewport.bottom &&
            rect.bottom + window.scrollY > viewport.top) {
          elements.push({
            type: 'cta',
            element: el,
            score: 9,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          });
        }
      });

      return elements.map(e => ({
        type: e.type,
        score: e.score,
        rect: e.rect
      }));
    });
  }

  /**
   * Find and return the best interesting element in current viewport
   * Returns null if no good candidates found
   */
  async findInterestingElement() {
    const elements = await this.findPointsOfInterest();
    if (elements.length === 0) return null;

    // Get viewport info
    const viewport = await this.page.evaluate(() => ({
      centerY: window.innerHeight / 2,
      centerX: window.innerWidth / 2
    }));

    // Score elements by distance from viewport center and element type score
    const scoredElements = elements.map(el => {
      const distFromCenter = Math.hypot(
        el.rect.x + el.rect.width / 2 - viewport.centerX,
        el.rect.y + el.rect.height / 2 - viewport.centerY
      );
      // Prefer elements closer to center, but also consider element type score
      const finalScore = el.score * 100 / (distFromCenter + 100);
      return { ...el, finalScore, distFromCenter };
    });

    // Sort by final score (higher is better)
    scoredElements.sort((a, b) => b.finalScore - a.finalScore);

    // Return the best element
    return scoredElements[0];
  }

  /**
   * Select text in an element by dragging
   */
  async selectTextInElement(locator) {
    const box = await locator.boundingBox();
    if (!box) return;

    // Find start and end of text
    const startX = box.x + 20;
    const endX = box.x + Math.min(box.width - 20, 200);
    const y = box.y + box.height / 2;

    // Move to start
    await this.moveTo(startX, y, 20);
    await this.page.mouse.down();

    // Drag to end
    await this.moveTo(endX, y, 20);
    await this.page.mouse.up();

    console.log('[HME] Text selected');
  }
}

module.exports = { HumanMotionEngine };
