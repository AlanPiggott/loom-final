// Tiny action DSL implementations
async function doGoto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
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
  const stepMs = 120; // cadence
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
