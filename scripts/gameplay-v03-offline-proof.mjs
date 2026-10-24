import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output = process.env.FACILITY_EVIDENCE_ROOT ?? 'docs/gameplay-v03-evidence/offline';
const url = process.env.FACILITY_URL ?? 'http://127.0.0.1:4173/';
await mkdir(output, { recursive: true });
const report = { status: 'RUNNING', method: 'Native Chrome UI and genuine close/wait/reopen in same browser context. Read-only state and localStorage. No state, time or storage injection.', inputs: [], checks: [], snapshots: [], errors: [], httpErrors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
let page;
const open = async () => {
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ status: response.status(), url: response.url() }); });
  report.inputs.push({ at: new Date().toISOString(), action: 'open', url });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__v3Test?.scene.getViewState().employees?.length === 3);
};
const read = () => page.evaluate(() => ({ runtime: JSON.parse(JSON.stringify(window.__v3Test.simulation.state)), stored: JSON.parse(localStorage.getItem('wanggeng.demo.v3')), footer: document.querySelector('#v3-message').textContent }));
const click = async selector => { report.inputs.push({ at: new Date().toISOString(), action: 'click', selector }); await page.locator(selector).click(); };
const pause = async () => { if ((await read()).runtime.timeScale !== 0) await click('[data-v3="pause"]'); };
const shot = async name => { await page.mouse.move(10, 890); await page.screenshot({ path: `${output}/${name}.png` }); const state = await read(); report.snapshots.push({ name, ...state }); return state; };
const closeWaitReopen = async () => {
  report.inputs.push({ at: new Date().toISOString(), action: 'close-game-page' });
  await page.close(); const closedAtMs = Date.now();
  await new Promise(resolve => setTimeout(resolve, 4000));
  report.inputs.push({ at: new Date().toISOString(), action: 'real-wall-wait', elapsedMs: Date.now() - closedAtMs });
  await open();
};
try {
  await open();
  await page.waitForFunction(() => window.__v3Test.simulation.state.simulationTimeSec >= 6, undefined, { timeout: 12000 });
  const active = await shot('01-active-before-close'); assert(active.runtime.timeScale > 0);
  await closeWaitReopen(); await pause();
  const earned = await shot('02-active-reopen-earned-offline');
  assert(earned.runtime.wallet - active.runtime.wallet >= 2 / 60 * 4);
  assert.match(earned.footer, /离线.*获得/);
  const restoredRuntimeSeconds = earned.runtime.simulationTimeSec - active.runtime.simulationTimeSec;
  const inferredOfflineCredit = earned.runtime.wallet - active.runtime.wallet - restoredRuntimeSeconds * 2 / 60;
  assert(inferredOfflineCredit >= 2 / 60 * 4);
  report.checks.push({ name: 'normal-stable-close-grants-offline-income', beforeWallet: active.runtime.wallet, afterWallet: earned.runtime.wallet, inferredOfflineCredit, footer: earned.footer });

  report.inputs.push({ at: new Date().toISOString(), action: 'browser.reload-after-settled-paused-save' });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__v3Test?.simulation);
  const repeated = await read(); assert.deepEqual(repeated.runtime, earned.runtime);
  report.checks.push({ name: 'settled-credit-not-repeated-after-reload', wallet: repeated.runtime.wallet });

  await click('[data-v3="save"]'); const paused = await shot('03-player-paused-before-close');
  await closeWaitReopen(); const pausedReload = await shot('04-player-paused-reopen-no-credit');
  assert.deepEqual(pausedReload.runtime, paused.runtime);
  report.checks.push({ name: 'player-paused-close-no-offline-income', wallet: pausedReload.runtime.wallet, timeScale: pausedReload.runtime.timeScale });

  await click('[data-v3="challenge"]'); await click('[data-v3="confirm-encounter"]');
  await page.waitForFunction(() => window.__v3Test.simulation.state.encounter?.elapsedSec >= 1, undefined, { timeout: 10000 });
  const battle = await shot('05-active-battle-before-close'); assert(battle.runtime.encounter); assert(battle.runtime.timeScale > 0);
  await closeWaitReopen(); await pause(); const abandoned = await shot('06-battle-reopen-abandoned');
  assert.equal(abandoned.runtime.encounter, null); assert.equal(abandoned.runtime.phase, 'FACILITY');
  assert.equal(abandoned.runtime.rooms[0].rank, battle.runtime.rooms[0].rank);
  assert.equal(abandoned.runtime.rooms[0].state, 'STABLE');
  // Once restored, the visible facility may advance a few frames before the native pause click.
  // All wallet growth must equal those visible simulation seconds; no 4-second offline award.
  const visibleSeconds = abandoned.runtime.simulationTimeSec - abandoned.stored.state.simulationTimeSec;
  assert(Math.abs(visibleSeconds) < .001);
  const afterBattleSeconds = abandoned.runtime.simulationTimeSec - battle.runtime.simulationTimeSec;
  const walletGrowth = abandoned.runtime.wallet - battle.runtime.wallet;
  assert(walletGrowth < 2 / 60 * 4);
  assert(walletGrowth <= Math.max(0, afterBattleSeconds) * 2 / 60 + .005);
  assert.match(abandoned.footer, /放弃.*无离线产能/);
  report.checks.push({ name: 'battle-close-abandons-with-no-offline-or-rank-reward', walletGrowth, afterBattleSeconds, rank: abandoned.runtime.rooms[0].rank, footer: abandoned.footer });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.reason = String(error.stack ?? error); await shot('failure').catch(() => {});
} finally {
  await context.close(); await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, status: report.status, checks: report.checks, reason: report.reason }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
