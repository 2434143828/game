import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = `docs/facility-evidence-2026-10-20/ui-${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const results = { status: 'RUNNING', checks: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/?mode=campaign');
  await page.waitForFunction(() => window.__facilityTest?.scene?.sys.isActive());
  const save = page.locator('[data-action="save"]');
  const originalSave = await save.elementHandle();
  await page.waitForTimeout(450);
  assert.equal(await originalSave.evaluate(element => element.isConnected), true);
  await save.click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('wanggeng.demo.v1')).snapshot.day), 1);
  await page.locator('[data-action="start"]').click();
  await page.waitForFunction(() => window.__facilityTest.controller.state.phase === 'RUNNING');
  await page.locator('[data-action="restart"]').click();
  await page.locator('[data-action="confirm-restart"]').click();
  await page.waitForFunction(() => window.__facilityTest.controller.state.phase === 'DAY_PREP');
  results.checks.push('Native save/start/retry clicks survive repeated HUD renders; day-one snapshot saved.');

  // Fresh context keeps the formal save untouched while testing the separate sandbox.
  const sandbox = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  sandbox.on('pageerror', error => errors.push(error.message));
  await sandbox.goto('http://127.0.0.1:5173/');
  await sandbox.waitForFunction(() => window.__facilityTest?.scene?.sys.isActive());
  await sandbox.locator('[data-skill="S01"]').click();
  await sandbox.locator('[data-purchase="SKILL"]').click();
  await sandbox.locator('[data-action="close"]').first().click();
  await sandbox.locator('[data-action="breach"]').click();
  const skillElement = await sandbox.locator('[data-skill="S01"]').elementHandle();
  const rosterElement = await sandbox.locator('[data-employee="E01"]').elementHandle();
  await sandbox.locator('[data-skill="S01"]').click();
  const enemy = await sandbox.evaluate(() => {
    const { controller, scene } = window.__facilityTest;
    return scene.getEnemyScreenPoint(controller.state.enemies.find(e => !e.isClone).id);
  });
  await sandbox.mouse.click(enemy.x * .8, enemy.y * .8);
  await sandbox.waitForFunction(() => window.__facilityTest.controller.state.skillCooldownRemainingSec.S01 > 0);
  assert.equal(await sandbox.evaluate(() => window.__facilityTest.controller.state.progress.wallet), 5);
  await sandbox.locator('[data-action="pause"]').click();
  await sandbox.waitForTimeout(600);
  assert.equal(await skillElement.evaluate(element => element.isConnected), true);
  assert.equal(await rosterElement.evaluate(element => element.isConnected), true);
  await sandbox.locator('[data-employee="E01"]').click();
  await sandbox.mouse.click(880 * .8, 570 * .8, { button: 'right' });
  await sandbox.waitForFunction(() => window.__facilityTest.controller.state.employees[0].status === 'MOVING');
  await sandbox.locator('[data-action="pause"]').click();
  await sandbox.screenshot({ path: `${directory}/1280-ui-and-stun.png` });
  results.checks.push('Skill purchase/actual paused stun/cooldown and employee selection/move use native inputs; buttons stay attached.');
  assert.deepEqual(await sandbox.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })), { width: 1280, height: 720 });
  assert.deepEqual(errors, []);
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL';
  results.reason = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  results.errors = errors;
  results.finishedAt = new Date().toISOString();
  await writeFile(`${directory}/report.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ directory, ...results }, null, 2));
}
