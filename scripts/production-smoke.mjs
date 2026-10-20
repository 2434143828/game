import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [], requests = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  page.on('requestfailed', request => failures.push(request.url()));
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('canvas').waitFor();
  await page.locator('[data-action="new-game"]').click();
  await page.locator('#modal-layer [data-action="start-day"]').click();
  await page.locator('[data-employee="E01"]').click();
  await page.locator('[data-room="N01"]').click();
  await page.locator('[data-work="OBSERVE"]').click();
  await page.waitForTimeout(600);
  assert.match(await page.locator('[data-employee="E01"]').innerText(), /移动中/);
  const inspection = await page.evaluate(() => ({
    devBridgeAbsent: !('__containmentTest' in window),
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  assert.equal(inspection.devBridgeAbsent, true);
  assert.equal(inspection.scrollWidth, 1280);
  assert.equal(inspection.scrollHeight, 720);
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  const externalRequests = requests.filter(url => !url.startsWith('http://127.0.0.1:4173/') && !url.startsWith('data:'));
  assert.deepEqual(externalRequests, []);
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/09-production-1280.png' });
  const result = { status: 'PASS', inspection, errors, failedRequests: failures, externalRequests };
  await writeFile('docs/production-smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
