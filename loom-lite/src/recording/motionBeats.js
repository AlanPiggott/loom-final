/**
 * Motion Beats
 *
 * High-level behavior compositions that combine HME primitives
 * into realistic, purposeful cursor interactions.
 */

/**
 * Intro settle - cursor enters from off-screen and settles
 * Duration: ~1.2s
 */
async function introSettle(hme, page) {
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
  await hme.hover(400);

  const elapsed = Date.now() - startTime;
  console.log(`[Beat] introSettle completed in ${elapsed}ms`);
  return elapsed;
}

/**
 * Hover on navigation item by text
 * Duration: ~1.0-1.5s
 */
async function hoverNav(hme, page, navText) {
  const startTime = Date.now();

  try {
    // Find nav item with matching text
    const navItem = page.locator(`nav a, header a`).filter({ hasText: new RegExp(navText, 'i') }).first();
    const isVisible = await navItem.isVisible().catch(() => false);

    if (isVisible) {
      await hme.moveToElement(navItem, 90);
      await hme.hover(700 + Math.round(200 * Math.random()));
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
 */
async function scrollDrift(hme, page, targetSeconds = 6) {
  const startTime = Date.now();
  const targetMs = targetSeconds * 1000;

  let elapsed = 0;
  let burstCount = 0;
  let scrollBackCount = 0;

  while (elapsed < targetMs) {
    // Faster scroll burst with coordinated cursor movement
    const amplitude = 600 + Math.round(600 * Math.random()); // 600-1200px
    const duration = 300 + Math.round(300 * Math.random()); // 300-600ms
    await hme.scrollBurstWithCursor(amplitude, duration);
    burstCount++;

    elapsed = Date.now() - startTime;
    if (elapsed >= targetMs) break;

    // Variable pause duration
    const isLongPause = Math.random() < 0.4;
    const pauseMs = isLongPause
      ? 1500 + Math.round(1500 * Math.random())
      : 400 + Math.round(400 * Math.random());

    const actualPauseMs = Math.min(pauseMs, targetMs - elapsed);

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
    if (elapsed >= targetMs) break;

    // Occasional scroll-back to re-highlight content
    const shouldScrollBack = scrollBackCount < 3 && Math.random() < 0.25;
    if (shouldScrollBack) {
      const scrollBackAmount = 150 + Math.round(150 * Math.random());
      await hme.scrollBurstWithCursor(-scrollBackAmount, 300);
      await page.waitForTimeout(400 + Math.round(300 * Math.random()));
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
 */
async function hoverHeadingNearCenter(hme, page) {
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
      const targetX = headings.x + headings.width / 2;
      const targetY = headings.y + 20;
      await hme.moveTo(targetX, targetY, headings.width);
      await hme.hover(900 + Math.round(600 * Math.random()));
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
 */
async function highlightSentence(hme, page) {
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
      // Drag-select a portion of the text
      const startX = paragraph.x + 10;
      const endX = Math.min(paragraph.x + paragraph.width - 10, startX + 250);
      const y = paragraph.y + paragraph.height / 2;

      await hme.moveTo(startX, y, 30);
      await page.waitForTimeout(200);
      await page.mouse.down();
      await hme.moveTo(endX, y, 30);
      await page.mouse.up();
      await hme.hover(1400);

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
 */
async function moveToCTAandHover(hme, page) {
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
      const targetX = cta.x + cta.width / 2;
      const targetY = cta.y + cta.height / 2;

      // Approach with slight overshoot
      const overshootX = targetX + (Math.random() > 0.5 ? 3 : -3);
      const overshootY = targetY + (Math.random() > 0.5 ? 2 : -2);

      await hme.moveTo(overshootX, overshootY, cta.width);
      await page.waitForTimeout(80);

      // Micro-correction
      await hme.moveTo(targetX, targetY, cta.width);
      await hme.hover(800 + Math.round(400 * Math.random()));
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
 * Duration: specified
 */
async function idle(hme, page, durationMs) {
  const startTime = Date.now();

  const pos = hme.getCurrentPosition();
  const numMoves = Math.floor(durationMs / 1500);

  for (let i = 0; i < numMoves; i++) {
    const dx = (Math.random() - 0.5) * 40;
    const dy = (Math.random() - 0.5) * 40;
    await hme.moveTo(pos.x + dx, pos.y + dy, 60);
    await hme.hover(400 + Math.round(400 * Math.random()));

    if (Date.now() - startTime >= durationMs) break;
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Beat] idle completed in ${elapsed}ms`);
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
