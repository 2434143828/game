import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const root = `docs/facility-evidence-2026-10-20/production-${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { status: 'RUNNING', errors: [], consoleErrors: [], failedRequests: [], httpErrors: [], externalRequests: [], checks: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({ text: message.text(), location: message.location() });
  });
  page.on('requestfailed', request => report.failedRequests.push(request.url()));
  page.on('response', response => {
    if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() });
  });
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('data:')) report.externalRequests.push(request.url());
  });
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('canvas').waitFor();
  await page.locator('[data-employee="E06"]').waitFor();
  assert.equal(await page.evaluate(() => '__facilityTest' in window || '__sliceTest' in window), false);
  const selected = page.locator('.facility-employee.selected');
  // Actual scene selection, no runtime bridge in the built bundle.
  await page.locator('[data-action="toggle-details"]').click();
  await page.mouse.move(1208 * .8, 641 * .8);
  await page.mouse.down();
  await page.mouse.move(1340 * .8, 736 * .8, { steps: 14 });
  await page.mouse.up();
  await page.mouse.click(800 * .8, 550 * .8, { button: 'right' });
  await page.waitForTimeout(2100);
  await page.mouse.click(520 * .8, 550 * .8, { button: 'right' });
  await page.waitForTimeout(700);
  await page.keyboard.press('Space');
  await page.locator('[data-action="pause"]').filter({ hasText: '继续' }).waitFor();
  await page.waitForTimeout(100);
  const clip = { x: 16 * .8, y: 76 * .8, width: 1328 * .8, height: 720 * .8 };
  const pausedBefore = await page.screenshot({ clip });
  await page.waitForTimeout(400);
  const pausedAfter = await page.screenshot({ clip });
  assert.equal(pausedBefore.equals(pausedAfter), true, 'Visible facility should freeze while paused.');
  await page.screenshot({ path: `${root}/1280-collapsed-moving.png` });
  await page.locator('[data-action="toggle-details"]').click();
  assert.equal(await selected.count(), 6);
  assert.equal(await page.locator('.employee-state').filter({ hasText: '移动中' }).count(), 6);
  assert.deepEqual(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })), { width: 1280, height: 720 });
  assert.equal(await page.evaluate(() => localStorage.getItem('wanggeng.demo.v1')), null);
  report.checks.push('Built bundle, no DEV bridges: 1280x720 collapsed inspector, real box select six, continuous move/reorder, pixel-identical paused facility, no formal save writes.');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.reload();
  await page.locator('[data-employee="E06"]').waitFor();
  await page.locator('[data-action="pause"]').click();
  await page.screenshot({ path: `${root}/five-room-1600.png` });
  await page.goto('http://127.0.0.1:4173/?mode=campaign');
  await page.locator('[data-action="start"]').waitFor();
  assert.equal(await page.locator('.facility-employee').count(), 4);
  await page.locator('[data-action="start"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-action="pause"]').click();
  await page.screenshot({ path: `${root}/formal-day-one.png` });
  report.checks.push('Production formal day one is four employees, starts via real UI; separate default sandbox is six.');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.httpErrors, []);
  assert.deepEqual(report.externalRequests, []);
  report.status = 'PASS';
  await context.close();
} catch (error) {
  report.status = 'FAIL';
  report.reason = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(`${root}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ directory: root, ...report }, null, 2));
}
