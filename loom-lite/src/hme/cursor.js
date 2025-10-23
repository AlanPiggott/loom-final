/**
 * In-Page Cursor Overlay and rAF Animator
 *
 * Injects a custom cursor overlay and animates it using requestAnimationFrame
 * to avoid flooding CDP with mouse.move() calls.
 *
 * Key features:
 * - Hides OS cursor
 * - Smooth rAF-based animation
 * - Interpolates through coordinate arrays with timestamps
 * - Clean shutdown
 */

/**
 * Cursor manager class
 */
class CursorManager {
  constructor(page) {
    this.page = page;
    this.isActive = false;
  }

  /**
   * Initialize cursor overlay in the page
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isActive) return;

    await this.page.evaluate(() => {
      // Create cursor element
      const cursor = document.createElement('div');
      cursor.id = 'hme-cursor';
      cursor.style.cssText = `
        position: fixed;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.6);
        border: 2px solid rgba(255, 255, 255, 0.8);
        pointer-events: none;
        z-index: 2147483647;
        transition: none;
        transform: translate(-50%, -50%);
      `;
      document.body.appendChild(cursor);

      // Hide OS cursor
      document.body.style.cursor = 'none';
      document.documentElement.style.cursor = 'none';

      // Store reference
      window._hmeCursor = cursor;
    });

    this.isActive = true;
  }

  /**
   * Animate cursor along a path using requestAnimationFrame
   * @param {Array<{x: number, y: number, t: number}>} path - Coordinate array with timestamps
   * @returns {Promise<void>}
   */
  async animatePath(path) {
    if (!this.isActive) {
      await this.initialize();
    }

    if (path.length === 0) return;

    // Execute animation in page context using rAF
    await this.page.evaluate((pathData) => {
      return new Promise((resolve) => {
        const cursor = window._hmeCursor;
        if (!cursor) {
          resolve();
          return;
        }

        const startTime = performance.now();
        const duration = pathData[pathData.length - 1].t;

        // Linear interpolation between two points
        function lerp(a, b, t) {
          return a + (b - a) * t;
        }

        // Find current position on path based on elapsed time
        function interpolatePosition(elapsed) {
          // Find surrounding keyframes
          let i = 0;
          while (i < pathData.length - 1 && pathData[i + 1].t < elapsed) {
            i++;
          }

          if (i >= pathData.length - 1) {
            // Animation complete
            return pathData[pathData.length - 1];
          }

          const p0 = pathData[i];
          const p1 = pathData[i + 1];
          const segmentProgress = (elapsed - p0.t) / (p1.t - p0.t);

          return {
            x: lerp(p0.x, p1.x, segmentProgress),
            y: lerp(p0.y, p1.y, segmentProgress)
          };
        }

        // Animation loop
        function frame() {
          const elapsed = performance.now() - startTime;

          if (elapsed >= duration) {
            // Animation complete - set final position
            const final = pathData[pathData.length - 1];
            cursor.style.left = final.x + 'px';
            cursor.style.top = final.y + 'px';
            resolve();
            return;
          }

          // Update cursor position
          const pos = interpolatePosition(elapsed);
          cursor.style.left = pos.x + 'px';
          cursor.style.top = pos.y + 'px';

          requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
      });
    }, path);
  }

  /**
   * Get current cursor position
   * @returns {Promise<{x: number, y: number}>}
   */
  async getCurrentPosition() {
    return this.page.evaluate(() => {
      const cursor = window._hmeCursor;
      if (!cursor) return { x: 0, y: 0 };

      const x = parseFloat(cursor.style.left) || 0;
      const y = parseFloat(cursor.style.top) || 0;
      return { x, y };
    });
  }

  /**
   * Set cursor position immediately (no animation)
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   */
  async setPosition(x, y) {
    if (!this.isActive) {
      await this.initialize();
    }

    await this.page.evaluate(({ x, y }) => {
      const cursor = window._hmeCursor;
      if (cursor) {
        cursor.style.left = x + 'px';
        cursor.style.top = y + 'px';
      }
    }, { x, y });
  }

  /**
   * Remove cursor overlay and restore OS cursor
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (!this.isActive) return;

    await this.page.evaluate(() => {
      const cursor = window._hmeCursor;
      if (cursor) {
        cursor.remove();
      }
      delete window._hmeCursor;

      // Restore OS cursor
      document.body.style.cursor = '';
      document.documentElement.style.cursor = '';
    }).catch(() => {
      // Ignore errors if page is already closed
    });

    this.isActive = false;
  }
}

/**
 * Create a cursor manager for a page
 * @param {Page} page - Playwright page
 * @returns {CursorManager}
 */
function createCursorManager(page) {
  return new CursorManager(page);
}

module.exports = {
  createCursorManager,
  CursorManager
};
