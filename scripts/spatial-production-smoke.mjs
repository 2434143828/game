import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = process.env.PROOF_OUTPUT_DIR || 'docs/spatial-evidence';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [], failedRequests = [], externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failedRequests.push(request.url()));
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('data:')) externalRequests.push(request.url());
  });
  await page.goto('http://127.0.0.1:4173/?slice=1');
  await page.locator('canvas').waitFor();
  await page.locator('.slice-vitals').first().waitFor();
  assert.equal(await page.locator('.slice-vitals').count(), 2);
  const inspection = await page.evaluate(() => ({
    devBridgeAbsent: !('__sliceTest' in window) && !('__containmentTest' in window),
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    save: localStorage.getItem('wanggeng.demo.v1'),
  }));
  assert.equal(inspection.devBridgeAbsent, true);
  assert.equal(inspection.width, 1280);
  assert.equal(inspection.height, 720);
  await page.locator('[data-action="toggle-details"]').click();
  assert.equal(await page.locator('#slice-details').isVisible(), false);
  // Same visible-world inputs as a player, at 0.8 display scale. No debug bridge.
  await page.mouse.move(1245 * 0.8, 630 * 0.8);
  await page.mouse.down();
  await page.mouse.move(1322 * 0.8, 748 * 0.8, { steps: 12 });
  await page.mouse.up();
  await page.mouse.click(850 * 0.8, 550 * 0.8, { button: 'right' });
  await page.waitForTimeout(2200);
  await page.keyboard.press('Space');
  await page.screenshot({ path: `${directory}/production-1280-collapsed.png` });
  await page.locator('[data-action="toggle-details"]').click();
  assert.match(await page.locator('.slice-selection').innerText(), /2/);
  assert.match(await page.locator('.slice-vitals').first().innerText(), /移动中/);
  assert.match(await page.locator('[data-action="pause"]').innerText(), /继续/);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  assert.deepEqual(externalRequests, []);
  const result = { status: 'PASS', verifiedAt: new Date().toISOString(), boundary: 'Built bundle at 1280x720; collapsed details, direct box selection, move, pause; no dev bridge. Full combat proof is the separate continuous dev run.', inspection, errors, failedRequests, externalRequests };
  await writeFile(`${directory}/production-smoke.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
