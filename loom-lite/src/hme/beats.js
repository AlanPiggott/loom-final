/**
 * Behavior Beats - 7 Human Motion Primitives
 *
 * Each beat accepts (page, cursorManager, rand, budgetMs) and returns actual elapsed time.
 * Uses wall-clock timing (Date.now()) for accuracy.
 * Safe: no destructive clicks, hover is default.
 *
 * Beats:
 * 1. introSettle - Cursor to viewport center (800-1200ms)
 * 2. hoverNav - Hover nav item, prefer "pricing" (1500-2500ms)
 * 3. scrollDrift - Inertial scroll bursts (variable)
 * 4. hoverHeadingNearCenter - Hover prominent heading (1200-2000ms)
 * 5. highlightSentence - Text selection (1800-3000ms)
 * 6. moveToCTAandHover - Move to CTA, hover (1500-2500ms)
 * 7. idle - Elastic time filler (exact remaining time)
 */

const { generatePath, generateIdlePath } = require('./path');
const { findNavItem, findHeadingNearCenter, findTextForSelection, findCTA, scrollToReveal } = require('./dom');
const { generateScrollSegments, generateContentAwareScrollSegments, executeScrollSegments, scrollBy } = require('./scroll');
const { ambientPause } = require('./ambient');

/**
 * Beat 1: introSettle
 * Move cursor from offscreen to viewport center with natural path
 * @param {Object} params - Beat parameters
 * @param {Page} params.page - Playwright page
 * @param {CursorManager} params.cursorManager - Cursor manager
 * @param {function} params.rand - Seeded RNG
 * @param {number} params.budgetMs - Time budget
 * @returns {Promise<number>} Actual elapsed time in ms
 */
async function introSettle({ page, cursorManager, rand, budgetMs }) {
  const startTime = Date.now();

  // Get viewport dimensions
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));

  // Start cursor offscreen (top-left corner)
  const fromX = -50;
  const fromY = -50;

  // Target: viewport center with slight offset
  const toX = viewport.width / 2 + (rand() - 0.5) * 100;
  const toY = viewport.height / 2 + (rand() - 0.5) * 100;

  // Generate and animate path
  const path = generatePath({
    fromX,
    fromY,
    toX,
    toY,
    targetWidth: 200,
    rand,
    sampleRate: 90,
    includeOvershoot: true
  });

  await cursorManager.animatePath(path);

  // Small idle movement
  const idlePath = generateIdlePath({
    centerX: toX,
    centerY: toY,
    radius: 15,
    rand
  });
  await cursorManager.animatePath(idlePath);

  const elapsed = Date.now() - startTime;

  // Pad to budget if under
  const remaining = budgetMs - elapsed;
  if (remaining > 0) {
    await page.waitForTimeout(remaining);
  }

  return Date.now() - startTime;
}

/**
 * Beat 2: hoverNav
 * Find and hover over nav item (prefer "pricing")
 * @param {Object} params - Beat parameters
 * @returns {Promise<number>} Actual elapsed time in ms
 */
async function hoverNav({ page, cursorManager, rand, budgetMs }) {
  const startTime = Date.now();

  // Find nav item
  const navItem = await findNavItem(page);

  if (!navItem) {
    // No nav item found, idle movement
    const currentPos = await cursorManager.getCurrentPosition();
    const idlePath = generateIdlePath({
      centerX: currentPos.x,
      centerY: currentPos.y,
      radius: 30,
      rand
    });
    await cursorManager.animatePath(idlePath);

    const elapsed = Date.now() - startTime;
    const remaining = budgetMs - elapsed;
    if (remaining > 0) {
      await page.waitForTimeout(remaining);
    }
    return Date.now() - startTime;
  }

  // Scroll to reveal if needed
  await scrollToReveal(page, navItem, 120, 400);

  // Get current cursor position
  const currentPos = await cursorManager.getCurrentPosition();

  // Generate path to nav item
  const path = generatePath({
    fromX: currentPos.x,
    fromY: currentPos.y,
    toX: navItem.x,
    toY: navItem.y,
    targetWidth: navItem.width || 100,
    rand,
    sampleRate: 90,
    includeOvershoot: true
  });

  await cursorManager.animatePath(path);

  // Hover pause (800-2000ms - LONGER for reading)
  const hoverDuration = 800 + rand() * 1200;
  await page.waitForTimeout(hoverDuration);

  // Multiple small idle movements while hovering (3-5 movements)
  const numMicroMovements = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < numMicroMovements; i++) {
    const idlePath = generateIdlePath({
      centerX: navItem.x,
      centerY: navItem.y,
      radius: 8 + rand() * 7, // 8-15px radius
      rand
    });
    await cursorManager.animatePath(idlePath);
    await page.waitForTimeout(100 + rand() * 200);
  }

  const elapsed = Date.now() - startTime;
  const remaining = budgetMs - elapsed;
  if (remaining > 0) {
    await page.waitForTimeout(remaining);
  }

  return Date.now() - startTime;
}

/**
 * Beat 3: scrollDrift
 * Content-aware scrolling with time-exact budget enforcement
 * @param {Object} params - Beat parameters
 * @returns {Promise<number>} Actual elapsed time in ms
 */
async function scrollDrift({ page, cursorManager, rand, budgetMs }) {
  const beatStart = Date.now();

  console.log(`\n[scrollDrift] Starting with budget: ${budgetMs}ms`);

  // Try content-aware scrolling first
  let segments = await generateContentAwareScrollSegments(page, {
    totalDurationMs: budgetMs * 0.95, // Use 95% of budget for segments
    rand
  });

  // Fallback to simple scrolling if no content found
  if (!segments || segments.length === 0) {
    console.log('[scrollDrift] No headings found, using simple scrolling');

    const viewport = await page.evaluate(() => ({
      height: window.innerHeight,
      maxScroll: Math.max(0, document.body.scrollHeight - window.innerHeight)
    }));

    const targetScrollPx = Math.min(
      viewport.height * (1.5 + rand() * 0.5), // Reduced from 2-3 to 1.5-2 viewports
      viewport.maxScroll
    );

    segments = generateScrollSegments({
      totalDurationMs: budgetMs * 0.95,
      targetScrollPx,
      rand,
      includePeekBack: rand() > 0.5
    });

    console.log(`[scrollDrift] Simple plan: ${segments.length} segments, target=${targetScrollPx}px`);
  }

  // Execute scroll segments with budget enforcement
  await executeScrollSegments(page, segments, budgetMs);

  const elapsed = Date.now() - beatStart;
  const drift = elapsed - budgetMs;

  console.log(`[scrollDrift] Completed: elapsed=${elapsed}ms, budget=${budgetMs}ms, drift=${drift > 0 ? '+' : ''}${drift}ms`);

  // If under budget, fill remaining time
  const remaining = budgetMs - elapsed;
  if (remaining > 50) {
    console.log(`[scrollDrift] Padding ${remaining}ms to match budget`);
    await page.waitForTimeout(remaining);
  }

  return Date.now() - beatStart;
}

/**
 * Beat 4: hoverHeadingNearCenter
 * Find and hover over prominent heading near viewport center
 * @param {Object} params - Beat parameters
 * @returns {Promise<number>} Actual elapsed time in ms
 */
async function hoverHeadingNearCenter({ page, cursorManager, rand, budgetMs }) {
  const startTime = Date.now();

  // Find heading near center
  const heading = await findHeadingNearCenter(page, 120);

  if (!heading) {
    // No heading found, idle movement
    const currentPos = await cursorManager.getCurrentPosition();
    const idlePath = generateIdlePath({
      centerX: currentPos.x,
      centerY: currentPos.y,
      radius: 30,
      rand
    });
    await cursorManager.animatePath(idlePath);

    const elapsed = Date.now() - startTime;
    const remaining = budgetMs - elapsed;
    if (remaining > 0) {
      await page.waitForTimeout(remaining);
    }
    return Date.now() - startTime;
  }

  // Scroll to reveal if needed
  await scrollToReveal(page, heading, 120, 400);

  // Get current cursor position
  const currentPos = await cursorManager.getCurrentPosition();

  // Generate path to heading
  const path = generatePath({
    fromX: currentPos.x,
    fromY: currentPos.y,
    toX: heading.x,
    toY: heading.y,
    targetWidth: heading.width || 200,
    rand,
    sampleRate: 90,
    includeOvershoot: true
  });

  await cursorManager.animatePath(path);

  // Hover pause (800-2000ms - LONGER for reading)
  const hoverDuration = 800 + rand() * 1200;
  await page.waitForTimeout(hoverDuration);

  // Multiple small idle movements while hovering (2-4 movements)
  const numMicroMovements = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < numMicroMovements; i++) {
    const idlePath = generateIdlePath({
      centerX: heading.x,
      centerY: heading.y,
      radius: 10 + rand() * 10, // 10-20px radius
      rand
    });
    await cursorManager.animatePath(idlePath);
    await page.waitForTimeout(150 + rand() * 250);
  }

  const elapsed = Date.now() - startTime;
  const remaining = budgetMs - elapsed;
  if (remaining > 0) {
    await page.waitForTimeout(remaining);
  }

  return Date.now() - startTime;
}

/**
 * Beat 5: highlightSentence
 * Find text paragraph and simulate text selection highlight
 * @param {Object} params - Beat parameters
 * @returns {Promise<number>} Actual elapsed time in ms
 */
async function highlightSentence({ page, cursorManager, rand, budgetMs }) {
  const startTime = Date.now();

  // Find text for selection
  const textElement = await findTextForSelection(page);

  if (!textElement) {
    // No text found, idle movement
    const currentPos = await cursorManager.getCurrentPosition();
    const idlePath = generateIdlePath({
      centerX: currentPos.x,
      centerY: currentPos.y,
      radius: 30,
      rand
    });
    await cursorManager.animatePath(idlePath);

    const elapsed = Date.now() - startTime;
    const remaining = budgetMs - elapsed;
    if (remaining > 0) {
      await page.waitForTimeout(remaining);
    }
    return Date.now() - startTime;
  }

  // Scroll to reveal if needed
  await scrollToReveal(page, textElement, 120, 400);

  // Get current cursor position
  const currentPos = await cursorManager.getCurrentPosition();

  // Start position: left edge of text
  const startX = textElement.x - textElement.width / 2 + 10;
  const startY = textElement.y;

  // Move to start of text
  const pathToStart = generatePath({
    fromX: currentPos.x,
    fromY: currentPos.y,
    toX: startX,
    toY: startY,
    targetWidth: 50,
    rand,
    sampleRate: 90,
    includeOvershoot: false
  });
  await cursorManager.animatePath(pathToStart);

  // Pause before selection (100-200ms)
  await page.waitForTimeout(100 + rand() * 100);

  // End position: drag across text (40-70% of width)
  const dragDistance = textElement.width * (0.4 + rand() * 0.3);
  const endX = startX + dragDistance;
  const endY = startY + (rand() - 0.5) * 3; // Slight vertical variation

  // Simulate drag (slower movement)
  const dragPath = generatePath({
    fromX: startX,
    fromY: startY,
    toX: endX,
    toY: endY,
    targetWidth: 200,
    rand,
    sampleRate: 60,
    includeOvershoot: false
  });
  await cursorManager.animatePath(dragPath);

  // Hold selection (500-900ms)
  const holdDuration = 500 + rand() * 400;
  await page.waitForTimeout(holdDuration);

  // Deselect (small movement away)
  const deselectPath = generatePath({
    fromX: endX,
    fromY: endY,
    toX: endX + (rand() - 0.5) * 50,
    toY: endY + (rand() - 0.5) * 50,
    targetWidth: 100,
    rand,
    sampleRate: 90,
    includeOvershoot: false
  });
  await cursorManager.animatePath(deselectPath);

  const elapsed = Date.now() - startTime;
  const remaining = budgetMs - elapsed;
  if (remaining > 0) {
    await page.waitForTimeout(remaining);
  }

  return Date.now() - startTime;
}

/**
 * Beat 6: moveToCTAandHover
 * Find CTA element and hover (no click - safe)
 * @param {Object} params - Beat parameters
 * @returns {Promise<number>} Actual elapsed time in ms
 */
async function moveToCTAandHover({ page, cursorManager, rand, budgetMs }) {
  const startTime = Date.now();

  // Find CTA element
  const cta = await findCTA(page);

  if (!cta) {
    // No CTA found, idle movement
    const currentPos = await cursorManager.getCurrentPosition();
    const idlePath = generateIdlePath({
      centerX: currentPos.x,
      centerY: currentPos.y,
      radius: 30,
      rand
    });
    await cursorManager.animatePath(idlePath);

    const elapsed = Date.now() - startTime;
    const remaining = budgetMs - elapsed;
    if (remaining > 0) {
      await page.waitForTimeout(remaining);
    }
    return Date.now() - startTime;
  }

  // Scroll to reveal if needed
  await scrollToReveal(page, cta, 120, 400);

  // Get current cursor position
  const currentPos = await cursorManager.getCurrentPosition();

  // Generate path to CTA
  const path = generatePath({
    fromX: currentPos.x,
    fromY: currentPos.y,
    toX: cta.x,
    toY: cta.y,
    targetWidth: cta.width || 120,
    rand,
    sampleRate: 90,
    includeOvershoot: true
  });

  await cursorManager.animatePath(path);

  // Hover pause (600-1000ms)
  const hoverDuration = 600 + rand() * 400;
  await page.waitForTimeout(hoverDuration);

  // Small idle movement while hovering
  const idlePath = generateIdlePath({
    centerX: cta.x,
    centerY: cta.y,
    radius: 8,
    rand
  });
  await cursorManager.animatePath(idlePath);

  const elapsed = Date.now() - startTime;
  const remaining = budgetMs - elapsed;
  if (remaining > 0) {
    await page.waitForTimeout(remaining);
  }

  return Date.now() - startTime;
}

/**
 * Beat 7: idle
 * Elastic final beat - fills exact remaining time with ambient micro-movements
 * NEW: Uses ambientPause for natural fidgeting during long idle periods
 * @param {Object} params - Beat parameters
 * @returns {Promise<number>} Actual elapsed time in ms
 */
async function idle({ page, cursorManager, rand, budgetMs }) {
  const startTime = Date.now();

  // Long idle (>= 5s): use ambient pause with higher nudge probability
  if (budgetMs >= 5000) {
    return await ambientPause(page, cursorManager, rand, budgetMs, {
      nudgeProb: 0.25 // 25% chance of scroll nudge during long idle
    });
  }

  // Short idle (< 5s): single micro-move + hover
  const currentPos = await cursorManager.getCurrentPosition();
  const { x, y } = currentPos;

  // Random offset: ±10px
  const dx = (rand() - 0.5) * 20;
  const dy = (rand() - 0.5) * 20;

  // Move duration: min(150ms, budget - 300ms for hover)
  const moveMs = Math.min(150, Math.max(0, budgetMs - 300));

  if (moveMs > 0) {
    const path = generatePath({
      fromX: x,
      fromY: y,
      toX: x + dx,
      toY: y + dy,
      targetWidth: 50,
      rand,
      sampleRate: 90,
      includeOvershoot: false
    });

    await cursorManager.animatePath(path);
  }

  // Final padding to exactly match budget
  const elapsed = Date.now() - startTime;
  const remaining = budgetMs - elapsed;
  if (remaining > 0) {
    await page.waitForTimeout(remaining);
  }

  return Date.now() - startTime;
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
