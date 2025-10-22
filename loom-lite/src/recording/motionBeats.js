/**
 * Motion Beats
 *
 * High-level behavior compositions that combine HME primitives
 * into realistic, purposeful cursor interactions.
 */

/**
 * Intro settle - cursor enters from off-screen and settles
 * Duration: ~1.2s
 * @param {HumanMotionEngine} hme
 * @param {Page} page
 * @param {number} maxBudgetMs - Maximum time budget for this beat (FIX #3)
 */
async function introSettle(hme, page, maxBudgetMs = 1400) {
  const startTime = Date.now();

  // Get viewport center
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));

  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;

  // Enter from slightly off to the side
  const startX = centerX - 100;
  const startY = centerY - 80;

  await hme.moveTo(startX, startY, 120);

  // FIX #3: Respect budget
  if (Date.now() - startTime >= maxBudgetMs) {
    return Date.now() - startTime;
  }

  await hme.hover(Math.min(400, maxBudgetMs - (Date.now() - startTime)));

  const elapsed = Date.now() - startTime;
  console.log(`[Beat] introSettle completed in ${elapsed}ms`);
  return elapsed;
}

/**
 * Hover on navigation item by text
 * Duration: ~1.0-1.5s
 * @param {HumanMotionEngine} hme
 * @param {Page} page
 * @param {string} navText - Text to search for in navigation
 * @param {number} maxBudgetMs - Maximum time budget for this beat (FIX #3)
 */
async function hoverNav(hme, page, navText, maxBudgetMs = 1600) {
  const startTime = Date.now();

  try {
    // Find nav item with matching text
    const navItem = page.locator(`nav a, header a`).filter({ hasText: new RegExp(navText, 'i') }).first();
    const isVisible = await navItem.isVisible().catch(() => false);

    if (isVisible) {
      // FIX #3: Check budget before move
      if (Date.now() - startTime >= maxBudgetMs) {
        return Date.now() - startTime;
      }

      await hme.moveToElement(navItem, 90);

      // FIX #3: Calculate remaining budget for hover
      const remaining = maxBudgetMs - (Date.now() - startTime);
      if (remaining > 0) {
        await hme.hover(Math.min(700 + Math.round(200 * Math.random()), remaining));
      }
    } else {
      console.log(`[Beat] Nav item "${navText}" not found`);
    }
  } catch (err) {
    console.log(`[Beat] hoverNav error: ${err.message}`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Beat] hoverNav("${navText}") completed in ${elapsed}ms`);
  return elapsed;
}

/**
 * Natural scrolling drift with bursts and pauses
 * Cursor follows scroll and hovers over interesting elements
 * Duration: ~targetSeconds
 * @param {HumanMotionEngine} hme
 * @param {Page} page
 * @param {number} targetSeconds - Target duration in seconds
 * @param {number} maxBudgetMs - Maximum time budget for this beat (FIX #3)
 */
async function scrollDrift(hme, page, targetSeconds = 6, maxBudgetMs = null) {
  const startTime = Date.now();
  const targetMs = targetSeconds * 1000;
  // FIX #3: Use maxBudgetMs if provided, otherwise use targetMs
  const budget = maxBudgetMs !== null ? maxBudgetMs : targetMs;

  let elapsed = 0;
  let burstCount = 0;
  let scrollBackCount = 0;

  while (elapsed < budget) {
    // FIX #3: Check budget FIRST (hard stop)
    if (Date.now() - startTime >= budget) {
      console.log('[Beat] scrollDrift budget exceeded, exiting gracefully');
      break;
    }

    // Faster scroll burst with coordinated cursor movement
    const amplitude = 600 + Math.round(600 * Math.random()); // 600-1200px
    const duration = 300 + Math.round(300 * Math.random()); // 300-600ms
    await hme.scrollBurstWithCursor(amplitude, duration);
    burstCount++;

    elapsed = Date.now() - startTime;
    if (elapsed >= budget) break;

    // Variable pause duration
    const isLongPause = Math.random() < 0.4;
    const pauseMs = isLongPause
      ? 1500 + Math.round(1500 * Math.random())
      : 400 + Math.round(400 * Math.random());

    // FIX #3: Cap pause to remaining budget
    const actualPauseMs = Math.min(pauseMs, budget - elapsed);

    // During pause, 60% chance to hover over an interesting element
    if (Math.random() < 0.6) {
      const element = await hme.findInterestingElement();
      if (element) {
        const targetX = element.rect.x + element.rect.width / 2;
        const targetY = element.rect.y + element.rect.height / 2;
        await hme.moveTo(targetX, targetY, element.rect.width);
        await hme.hover(Math.min(actualPauseMs, 600 + Math.round(400 * Math.random())));
      } else {
        await page.waitForTimeout(actualPauseMs);
      }
    } else {
      // Just pause without element interaction
      await page.waitForTimeout(actualPauseMs);
    }

    elapsed = Date.now() - startTime;
    if (elapsed >= budget) break;

    // Occasional scroll-back to re-highlight content
    const shouldScrollBack = scrollBackCount < 3 && Math.random() < 0.25;
    if (shouldScrollBack) {
      // FIX #3: Check budget before scroll-back
      if (Date.now() - startTime >= budget) break;

      const scrollBackAmount = 150 + Math.round(150 * Math.random());
      await hme.scrollBurstWithCursor(-scrollBackAmount, 300);

      const pauseBudget = Math.min(400 + Math.round(300 * Math.random()), budget - (Date.now() - startTime));
      if (pauseBudget > 0) {
        await page.waitForTimeout(pauseBudget);
      }
      scrollBackCount++;
      elapsed = Date.now() - startTime;
    }
  }

  const finalElapsed = Date.now() - startTime;
  console.log(`[Beat] scrollDrift completed in ${finalElapsed}ms (${burstCount} bursts, ${scrollBackCount} scroll-backs)`);
  return finalElapsed;
}

/**
 * Hover on a heading near the center of viewport
 * Duration: ~1.5-2.0s
 * @param {HumanMotionEngine} hme
 * @param {Page} page
 * @param {number} maxBudgetMs - Maximum time budget for this beat (FIX #3)
 */
async function hoverHeadingNearCenter(hme, page, maxBudgetMs = 1500) {
  const startTime = Date.now();

  try {
    // Find headings in viewport
    const headings = await page.evaluate(() => {
      const viewport = {
        centerY: window.innerHeight / 2,
        top: window.scrollY,
        bottom: window.scrollY + window.innerHeight
      };

      const found = [];
      document.querySelectorAll('h1, h2, h3').forEach(el => {
        const rect = el.getBoundingClientRect();
        const elemY = rect.top + window.scrollY;

        if (elemY > viewport.top && elemY < viewport.bottom) {
          const distFromCenter = Math.abs(rect.top - viewport.centerY);
          found.push({
            text: el.textContent.substring(0, 50),
            distFromCenter,
            y: rect.top,
            x: rect.left,
            width: rect.width
          });
        }
      });

      // Sort by distance from center
      found.sort((a, b) => a.distFromCenter - b.distFromCenter);
      return found[0]; // closest to center
    });

    if (headings) {
      // FIX #3: Check budget before move
      if (Date.now() - startTime >= maxBudgetMs) {
        return Date.now() - startTime;
      }

      const targetX = headings.x + headings.width / 2;
      const targetY = headings.y + 20;
      await hme.moveTo(targetX, targetY, headings.width);

      // FIX #3: Calculate remaining budget for hover
      const remaining = maxBudgetMs - (Date.now() - startTime);
      if (remaining > 0) {
        await hme.hover(Math.min(900 + Math.round(600 * Math.random()), remaining));
      }
    }
  } catch (err) {
    console.log(`[Beat] hoverHeadingNearCenter error: ${err.message}`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Beat] hoverHeadingNearCenter completed in ${elapsed}ms`);
  return elapsed;
}

/**
 * Highlight a sentence by drag-selecting text
 * Duration: ~2.0-2.5s
 * @param {HumanMotionEngine} hme
 * @param {Page} page
 * @param {number} maxBudgetMs - Maximum time budget for this beat (FIX #3)
 */
async function highlightSentence(hme, page, maxBudgetMs = 1800) {
  const startTime = Date.now();

  try {
    // Find a paragraph with enough text
    const paragraph = await page.evaluate(() => {
      const paragraphs = Array.from(document.querySelectorAll('p'));
      for (const p of paragraphs) {
        const text = p.textContent.trim();
        const words = text.split(/\s+/).length;
        if (words >= 10 && words <= 30) {
          const rect = p.getBoundingClientRect();
          const inView = rect.top < window.innerHeight && rect.bottom > 0;
          if (inView) {
            return {
              text: text.substring(0, 100),
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height
            };
          }
        }
      }
      return null;
    });

    if (paragraph) {
      // FIX #3: Check budget before starting selection
      if (Date.now() - startTime >= maxBudgetMs) {
        return Date.now() - startTime;
      }

      // Drag-select a portion of the text
      const startX = paragraph.x + 10;
      const endX = Math.min(paragraph.x + paragraph.width - 10, startX + 250);
      const y = paragraph.y + paragraph.height / 2;

      await hme.moveTo(startX, y, 30);

      // FIX #3: Check budget before continuing
      if (Date.now() - startTime >= maxBudgetMs) {
        return Date.now() - startTime;
      }

      await page.waitForTimeout(Math.min(200, maxBudgetMs - (Date.now() - startTime)));
      await page.mouse.down();
      await hme.moveTo(endX, y, 30);
      await page.mouse.up();

      // FIX #3: Calculate remaining budget for hover
      const remaining = maxBudgetMs - (Date.now() - startTime);
      if (remaining > 100) {
        await hme.hover(Math.min(1400, remaining - 100)); // Reserve 100ms for deselect
      }

      // Click somewhere else to deselect
      await hme.moveTo(paragraph.x + paragraph.width + 50, y, 50);
      await page.mouse.click(paragraph.x + paragraph.width + 50, y);
    }
  } catch (err) {
    console.log(`[Beat] highlightSentence error: ${err.message}`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Beat] highlightSentence completed in ${elapsed}ms`);
  return elapsed;
}

/**
 * Move to a CTA button with micro-overshoot and hover
 * Duration: ~1.2-1.5s
 * @param {HumanMotionEngine} hme
 * @param {Page} page
 * @param {number} maxBudgetMs - Maximum time budget for this beat (FIX #3)
 */
async function moveToCTAandHover(hme, page, maxBudgetMs = 1400) {
  const startTime = Date.now();

  try {
    // Find a prominent CTA button
    const cta = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll(
        'button, .btn, a.button, [role="button"]'
      ));

      for (const btn of buttons) {
        const rect = btn.getBoundingClientRect();
        const inView = rect.top < window.innerHeight && rect.bottom > 0;
        const text = btn.textContent.toLowerCase();
        const isCTA = /get started|sign up|try|demo|learn more|contact/i.test(text);

        if (inView && isCTA) {
          return {
            text: text.substring(0, 30),
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          };
        }
      }
      return null;
    });

    if (cta) {
      // FIX #3: Check budget before move
      if (Date.now() - startTime >= maxBudgetMs) {
        return Date.now() - startTime;
      }

      const targetX = cta.x + cta.width / 2;
      const targetY = cta.y + cta.height / 2;

      // Approach with slight overshoot
      const overshootX = targetX + (Math.random() > 0.5 ? 3 : -3);
      const overshootY = targetY + (Math.random() > 0.5 ? 2 : -2);

      await hme.moveTo(overshootX, overshootY, cta.width);

      // FIX #3: Check budget before correction
      if (Date.now() - startTime >= maxBudgetMs) {
        return Date.now() - startTime;
      }

      await page.waitForTimeout(Math.min(80, maxBudgetMs - (Date.now() - startTime)));

      // Micro-correction
      await hme.moveTo(targetX, targetY, cta.width);

      // FIX #3: Calculate remaining budget for hover
      const remaining = maxBudgetMs - (Date.now() - startTime);
      if (remaining > 0) {
        await hme.hover(Math.min(800 + Math.round(400 * Math.random()), remaining));
      }
    }
  } catch (err) {
    console.log(`[Beat] moveToCTAandHover error: ${err.message}`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Beat] moveToCTAandHover completed in ${elapsed}ms`);
  return elapsed;
}

/**
 * Idle motion - small cursor movements while "reading"
 * Duration: fills remaining time exactly using wall-clock timing
 * @param {HumanMotionEngine} hme
 * @param {Page} page
 * @param {number} targetMs - Target duration in milliseconds
 * @param {number} maxBudgetMs - Maximum time budget (hard cap)
 */
async function idle(hme, page, targetMs, maxBudgetMs = null) {
  const start = Date.now();
  const budget = Math.min(targetMs, maxBudgetMs ?? targetMs);
  const rand = hme.rng; // CRITICAL: Use seeded RNG for determinism

  while (true) {
    const elapsed = Date.now() - start;
    const remaining = budget - elapsed;

    // Exit if no time left or not enough for meaningful interaction
    if (remaining <= 0 || remaining < 250) break;

    // CRITICAL: Get CURRENT position each iteration (not static)
    const { x, y } = hme.getCurrentPosition();

    // Small natural wander (±20-40px) using seeded RNG
    const dx = (rand() - 0.5) * 40;
    const dy = (rand() - 0.5) * 40;

    // CRITICAL: Clamp move duration to remaining budget
    // Reserve 300ms for hover after move
    const moveMs = Math.min(
      120 + Math.round(120 * rand()),
      Math.max(0, remaining - 300)
    );

    if (moveMs > 0) {
      await hme.moveTo(x + dx, y + dy, 60); // 60 = target width (Fitts' Law)
    }

    // Recompute remaining after move
    const remaining2 = budget - (Date.now() - start);
    if (remaining2 <= 0) break;

    // CRITICAL: Clamp hover to remaining budget
    const hoverMs = Math.min(
      400 + Math.round(400 * rand()),
      remaining2
    );

    if (hoverMs > 0) {
      await hme.hover(hoverMs);
    }
  }

  const elapsed = Date.now() - start;
  const drift = elapsed - budget;
  console.log(`[Beat] idle budget=${budget}ms elapsed=${elapsed}ms drift=${drift}ms`);
  return elapsed;
}

module.exports = {
  introSettle,
  hoverNav,
  scrollDrift,
  hoverHeadingNearCenter,
  highlightSentence,
  moveToCTAandHover,
  idle
};
