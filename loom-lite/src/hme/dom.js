/**
 * DOM Element Scoring and Safe-Click Classification
 *
 * Identifies interesting elements (headings, CTAs, nav) and enforces
 * STRICT safe-click policy to prevent destructive actions.
 */

// DENY patterns (STRICT - never click these)
const DENY_PATTERNS = /buy|checkout|pay|subscribe|cart|sign[\s-]?in|log[\s-]?in|password|add[\s-]?to[\s-]?cart|register|create[\s-]?account/i;

// ALLOW patterns (informational only)
const ALLOW_PATTERNS = /pricing|features|customers|demo|about|learn[\s-]?more|contact|book[\s-]?demo|documentation|docs|help|support|resources/i;

/**
 * Check if page has authentication indicators
 * @param {Page} page - Playwright page
 * @returns {Promise<boolean>}
 */
async function detectAuth(page) {
  return page.evaluate(() => {
    // Check for password input
    const hasPasswordInput = !!document.querySelector('input[type="password"]');

    // Check for login/signin text
    const bodyText = document.body.textContent || '';
    const hasLoginText = /sign[\s-]?in|log[\s-]?in|password|authentication/i.test(bodyText);

    return hasPasswordInput || hasLoginText;
  });
}

/**
 * Score and rank elements by type
 * @param {Page} page - Playwright page
 * @param {string} type - Element type: 'heading', 'cta', 'nav', 'text'
 * @param {number} topMargin - Top margin to account for sticky headers
 * @returns {Promise<Array>} Sorted array of scored elements
 */
async function findElements(page, type, topMargin = 120) {
  return page.evaluate(({ type, topMargin }) => {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      centerX: window.innerWidth / 2,
      centerY: window.innerHeight / 2,
      scrollY: window.scrollY
    };

    const elements = [];

    /**
     * Check if element is visible and in viewport
     */
    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.top < viewport.height &&
        rect.bottom > 0
      );
    }

    /**
     * Score element based on position (prefer center)
     */
    function scorePosition(rect) {
      const distFromCenterX = Math.abs(rect.left + rect.width / 2 - viewport.centerX);
      const distFromCenterY = Math.abs(rect.top + rect.height / 2 - viewport.centerY);
      const distFromCenter = Math.sqrt(distFromCenterX ** 2 + distFromCenterY ** 2);

      // Normalize to [0, 1], inverted so center = 1
      const maxDist = Math.sqrt(viewport.width ** 2 + viewport.height ** 2) / 2;
      return 1 - Math.min(distFromCenter / maxDist, 1);
    }

    // Find elements by type
    if (type === 'heading') {
      document.querySelectorAll('h1, h2, h3').forEach(el => {
        if (!isVisible(el)) return;

        const rect = el.getBoundingClientRect();
        const text = el.textContent.trim();

        if (text.length < 3) return; // Skip empty headings

        elements.push({
          text,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          score: scorePosition(rect) * 1.2, // Boost headings
          tagName: el.tagName.toLowerCase()
        });
      });
    }

    if (type === 'cta') {
      const selectors = 'button, [role="button"], a.button, a.btn, a[class*="cta"], a[class*="action"]';
      document.querySelectorAll(selectors).forEach(el => {
        if (!isVisible(el)) return;

        const rect = el.getBoundingClientRect();
        const text = el.textContent.trim();

        if (text.length === 0) return;

        elements.push({
          text,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          score: scorePosition(rect),
          tagName: el.tagName.toLowerCase(),
          href: el.href || null
        });
      });
    }

    if (type === 'nav') {
      const selectors = 'nav a, header a, [role="navigation"] a';
      document.querySelectorAll(selectors).forEach(el => {
        if (!isVisible(el)) return;

        const rect = el.getBoundingClientRect();
        const text = el.textContent.trim();

        if (text.length === 0) return;

        // Boost if matches common nav patterns
        const boost = /pricing|features|customers|demo|about|contact|products|solutions/i.test(text) ? 1.5 : 1;

        elements.push({
          text,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          score: scorePosition(rect) * boost,
          tagName: el.tagName.toLowerCase(),
          href: el.href || null
        });
      });
    }

    if (type === 'text') {
      document.querySelectorAll('p').forEach(el => {
        if (!isVisible(el)) return;

        const rect = el.getBoundingClientRect();
        const text = el.textContent.trim();
        const words = text.split(/\s+/).length;

        // Only paragraphs with 8-30 words
        if (words < 8 || words > 30) return;

        elements.push({
          text: text.substring(0, 100), // Truncate for performance
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          score: scorePosition(rect),
          words
        });
      });
    }

    // Sort by score (highest first)
    elements.sort((a, b) => b.score - a.score);

    return elements;
  }, { type, topMargin });
}

/**
 * Classify if an element is safe to click (STRICT policy)
 * @param {Object} element - Element with text and href
 * @returns {boolean} true if safe to click
 */
function isSafeToClick(element) {
  if (!element) return false;

  const text = (element.text || '').toLowerCase();
  const href = (element.href || '').toLowerCase();

  // DENY if matches deny patterns
  if (DENY_PATTERNS.test(text) || DENY_PATTERNS.test(href)) {
    return false;
  }

  // DENY if different origin (external link)
  if (href && !href.startsWith(window.location.origin) && !href.startsWith('/')) {
    return false;
  }

  // ALLOW only if matches allow patterns
  if (ALLOW_PATTERNS.test(text) || ALLOW_PATTERNS.test(href)) {
    return true;
  }

  // Default: DENY (be conservative)
  return false;
}

/**
 * Find best heading near viewport center
 * @param {Page} page - Playwright page
 * @param {number} topMargin - Top margin
 * @returns {Promise<Object|null>}
 */
async function findHeadingNearCenter(page, topMargin = 120) {
  const headings = await findElements(page, 'heading', topMargin);
  return headings[0] || null;
}

/**
 * Find best CTA element
 * @param {Page} page - Playwright page
 * @returns {Promise<Object|null>}
 */
async function findCTA(page) {
  const ctas = await findElements(page, 'cta');
  return ctas[0] || null;
}

/**
 * Find best nav element (prefer "pricing")
 * @param {Page} page - Playwright page
 * @returns {Promise<Object|null>}
 */
async function findNavItem(page) {
  const navItems = await findElements(page, 'nav');

  // Prefer "pricing" if available
  const pricing = navItems.find(el => /pricing/i.test(el.text));
  if (pricing) return pricing;

  return navItems[0] || null;
}

/**
 * Find suitable paragraph for text selection
 * @param {Page} page - Playwright page
 * @returns {Promise<Object|null>}
 */
async function findTextForSelection(page) {
  const texts = await findElements(page, 'text');
  return texts[0] || null;
}

/**
 * Scroll element into view considering topMargin
 * @param {Page} page - Playwright page
 * @param {Object} element - Element with x, y coordinates
 * @param {number} topMargin - Top margin for sticky headers
 */
async function scrollToReveal(page, element, topMargin = 120) {
  if (!element) return;

  await page.evaluate(({ y, topMargin }) => {
    const targetY = y + window.scrollY - topMargin - window.innerHeight / 2;
    window.scrollTo({
      top: Math.max(0, targetY),
      behavior: 'smooth'
    });
  }, { y: element.y, topMargin });

  // Wait for scroll to settle
  await page.waitForTimeout(300);
}

module.exports = {
  detectAuth,
  findElements,
  findHeadingNearCenter,
  findCTA,
  findNavItem,
  findTextForSelection,
  isSafeToClick,
  scrollToReveal
};
