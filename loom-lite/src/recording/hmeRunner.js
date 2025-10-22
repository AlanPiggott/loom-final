/**
 * HME Runner - Public API and safety guardrails
 *
 * Orchestrates human motion beats with:
 * - Lean page ready (FIX #2): 5s hard cap, no duplicate waits
 * - Safe-click policy (FIX #5): Never click auth/checkout
 * - Auth detection: Skip scenes requiring login
 * - Cookie banner handling (FIX #4): Return boolean, log in Node
 * - Script inference (FIX #6): Handle /docs|/help edge cases
 * - Budget enforcement (FIX #1, #3): Pass maxBudgetMs to beats
 */

const { HumanMotionEngine } = require('./humanMotion');
const { allocateBeats } = require('./hmeScheduler');
const beats = require('./motionBeats');

/**
 * FIX #2: Lean page ready - precise waits, 5s hard cap
 * Replaces old 25-35s waits with fast, capped sequence
 */
async function leanPageReady(page) {
  const start = Date.now();

  // 1. Wait for DOM (8s timeout)
  await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {
    console.log('[HME] DOM load timeout, continuing...');
  });

  // 2. Wait for fonts, capped at 1.5s (race condition)
  await Promise.race([
    page.evaluate(() => {
      return window.document?.fonts?.ready ?? Promise.resolve();
    }).catch(() => {}),
    page.waitForTimeout(1500)
  ]);

  // 3. Tiny FCP cushion, total hard cap 5s
  const spent = Date.now() - start;
  if (spent < 5000) {
    await page.waitForTimeout(Math.min(700, 5000 - spent));
  }

  const elapsed = Date.now() - start;
  console.log(`[HME] Page ready in ${elapsed}ms (lean mode, cap: 5000ms)`);
}

/**
 * Detect if page requires authentication
 * @returns {boolean} True if page needs login
 */
async function requiresAuth(page) {
  return await page.evaluate(() => {
    // Check for password inputs
    if (document.querySelector('input[type=password]')) return true;

    // Check for login/signin text in prominent areas
    const text = document.body.textContent.toLowerCase();
    if (/(sign|log) ?in|enter password|authenticate/.test(text)) {
      const prominent = document.querySelector('h1, h2, .auth, .login, [role=main]');
      if (prominent && /(sign|log) ?in/.test(prominent.textContent.toLowerCase())) {
        return true;
      }
    }

    return false;
  });
}

/**
 * FIX #4: Cookie banner handling - return boolean, log in Node
 * @returns {boolean} True if banner was dismissed
 */
async function dismissCookieBanner(page) {
  const dismissed = await page.evaluate(() => {
    // Find consent containers
    const containers = document.querySelectorAll(
      '[class*=cookie], [class*=consent], [id*=cookie], [id*=consent], [class*=gdpr], [id*=gdpr]'
    );

    for (const container of containers) {
      // Look for clear accept button
      const buttons = container.querySelectorAll('button, a');
      for (const btn of buttons) {
        const text = btn.textContent.trim().toLowerCase();
        // Only click if button clearly says accept/agree/ok/allow (exact match)
        if (/^(accept|agree|ok|allow|got it)$/i.test(text)) {
          btn.click();
          return true; // Return to Node context
        }
      }
    }

    return false;
  });

  // FIX #4: Log in Node (not inside page.evaluate)
  if (dismissed) {
    console.log('[HME] Dismissed cookie banner');
  }

  return dismissed;
}

/**
 * FIX #5: Safe-click policy - check multiple text sources
 * Only returns true if CTA is safe to click
 */
function isSafeCTA(element) {
  // FIX #5: Check textContent, ariaLabel, and title
  const text = (
    element.textContent ||
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    ''
  ).toLowerCase();

  const href = element.getAttribute('href') || '';

  // NEVER click these (danger patterns)
  const dangerPatterns = /submit|buy|checkout|pay|purchase|subscribe|cart|add to cart|sign ?up|log ?in|signin|login|password|register|create account/i;
  if (dangerPatterns.test(text)) return false;

  // Only safe CTAs
  const safePatterns = /pricing|features|learn more|book demo|get started|contact|about|customers|view|explore|discover|read more/i;
  if (!safePatterns.test(text)) return false;

  // Must have same-origin href or be a safe hash link
  if (href && !href.startsWith('#')) {
    try {
      const currentOrigin = new URL(window.location.href).origin;
      const targetOrigin = new URL(href, window.location.href).origin;
      if (targetOrigin !== currentOrigin) return false;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * FIX #6: Script inference with edge cases (/docs, /help)
 * @param {string} url - Page URL
 * @returns {string} Script name (saas-default, pricing-default, generic)
 */
function inferScript(url) {
  const lower = url.toLowerCase();

  // Pricing pages
  if (/\/pricing|pricing\.|price-|\/plans|\/packages/.test(lower)) {
    return 'pricing-default';
  }

  // FIX #6: Docs/help pages (safer with generic - avoids typing/forms)
  if (/\/docs|\/help|\/knowledge|\/support|\/faq|\/guide/.test(lower)) {
    return 'generic';
  }

  // SaaS marketing pages
  if (/\/demo|\/product|\/features|\/solutions/.test(lower)) {
    return 'saas-default';
  }

  // Default
  return 'generic';
}

/**
 * Execute a single beat with budget enforcement
 * FIX #3: Pass maxBudgetMs to every beat
 */
async function executeBeat(hme, page, beatConfig, maxBudgetMs) {
  const { name, duration, navText } = beatConfig;
  const start = Date.now();

  try {
    switch (name) {
      case 'introSettle':
        await beats.introSettle(hme, page, maxBudgetMs);
        break;

      case 'hoverNav':
        await beats.hoverNav(hme, page, navText || 'Pricing', maxBudgetMs);
        break;

      case 'scrollDrift':
        // Convert ms to seconds for scrollDrift, pass maxBudgetMs
        await beats.scrollDrift(hme, page, duration / 1000, maxBudgetMs);
        break;

      case 'hoverHeadingNearCenter':
        await beats.hoverHeadingNearCenter(hme, page, maxBudgetMs);
        break;

      case 'highlightSentence':
        await beats.highlightSentence(hme, page, maxBudgetMs);
        break;

      case 'moveToCTAandHover':
        await beats.moveToCTAandHover(hme, page, maxBudgetMs);
        break;

      case 'idle':
        // CRITICAL: Pass both targetMs and maxBudgetMs
        await beats.idle(hme, page, duration, maxBudgetMs);
        break;

      default:
        console.warn(`[HME] Unknown beat: ${name}`);
    }
  } catch (error) {
    console.warn(`[HME] Beat "${name}" error: ${error.message} (continuing...)`);
  }

  const elapsed = Date.now() - start;
  return elapsed;
}

/**
 * Main entry point - run HME for a scene
 *
 * @param {Page} page - Playwright page object
 * @param {Object} options
 * @param {number} options.seed - Deterministic seed for reproducibility
 * @param {number} options.durationSec - Scene duration in seconds
 * @param {string} options.url - Page URL (for script inference)
 * @returns {Promise<Object>} { success: boolean, elapsed: number, requiresAuth: boolean }
 */
async function runScene(page, { seed, durationSec, url }) {
  const startTime = Date.now();

  // Check for rollback mode (FIX #7: emergency fallback)
  const mode = process.env.HME_MODE || 'replace';
  if (mode === 'manual') {
    console.log('[HME] Manual mode enabled via HME_MODE=manual - skipping HME');
    return { success: false, skipped: true, elapsed: 0 };
  }

  console.log(`[HME] Starting scene | seed: ${seed} | duration: ${durationSec}s | url: ${url}`);

  // Wait for page to be ready (lean mode)
  await leanPageReady(page);

  // Check for auth requirement
  const needsAuth = await requiresAuth(page);
  if (needsAuth) {
    console.log('[HME] Page requires authentication - marking scene as requires_auth');
    return { success: false, requiresAuth: true, elapsed: Date.now() - startTime };
  }

  // Dismiss cookie banner if present (non-blocking)
  await dismissCookieBanner(page).catch(() => {});

  // Infer script from URL
  const scriptName = inferScript(url);
  console.log(`[HME] Inferred script: ${scriptName}`);

  // Initialize HME with seeded RNG
  const hme = new HumanMotionEngine(seed, 'trackpad');
  await hme.init(page);

  // Allocate beats with budget reservation
  const durationMs = durationSec * 1000;
  const beatPlan = allocateBeats(scriptName, durationMs, hme.rng);

  // Execute beats with budget enforcement (FIX #1, #3)
  let totalElapsed = 0;
  for (const beatConfig of beatPlan) {
    // FIX #3: Calculate remaining budget and pass to beat
    const budgetLeft = durationMs - totalElapsed;
    if (budgetLeft <= 0) {
      console.log(`[HME] Budget exhausted, stopping at beat: ${beatConfig.name}`);
      break;
    }

    const elapsed = await executeBeat(hme, page, beatConfig, budgetLeft);
    totalElapsed += elapsed;

    // Enhanced logging with drift tracking
    const drift = elapsed - beatConfig.duration;
    console.log(`[HME] beat=${beatConfig.name} target=${beatConfig.duration}ms budgetLeft=${budgetLeft}ms elapsed=${elapsed}ms drift=${drift}ms`);

    // Hard stop if over budget
    if (totalElapsed >= durationMs) {
      console.log(`[HME] Time budget reached, stopping`);
      break;
    }
  }

  const finalElapsed = Date.now() - startTime;
  const drift = totalElapsed - durationMs;

  console.log(`[HME] Scene complete | total=${totalElapsed}ms | budget=${durationMs}ms | drift=${drift}ms | wallclock=${finalElapsed}ms`);

  return {
    success: true,
    elapsed: totalElapsed,
    wallclock: finalElapsed,
    drift,
    requiresAuth: false
  };
}

module.exports = {
  runScene,
  inferScript,
  leanPageReady,
  requiresAuth,
  dismissCookieBanner,
  isSafeCTA
};
