import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output = process.env.FACILITY_EVIDENCE_ROOT ?? 'docs/gameplay-v03-evidence/save-reload';
await mkdir(output, { recursive: true });
const report = {
  status: 'RUNNING',
  method: 'Fresh Chrome context; native UI speed/pause/save inputs and browser reload. Read-only DEV state and localStorage observations. Real elapsed time; no simulation/time/storage injection.',
  inputs: [], checks: [], snapshots: [], errors: [], httpErrors: [],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(String(error)));
page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ status: response.status(), url: response.url() }); });
const read = () => page.evaluate(() => ({
  runtime: JSON.parse(JSON.stringify(window.__v3Test.simulation.state)),
  stored: JSON.parse(localStorage.getItem('wanggeng.demo.v3')),
  footer: document.querySelector('#v3-message').textContent,
}));
const click = async selector => {
  report.inputs.push({ at: new Date().toISOString(), action: 'click', selector });
  await page.locator(selector).click();
};
const shot = async name => {
  await page.mouse.move(10, 890);
  await page.screenshot({ path: `${output}/${name}.png` });
  const snapshot = await read(); report.snapshots.push({ name, ...snapshot });
  return snapshot;
};
const assertNoSaveError = snapshot => assert(!/无法|失败|不兼容|未写入|未领取|不覆盖|Unrecognized/.test(snapshot.footer), snapshot.footer);
try {
  await page.goto(process.env.FACILITY_URL ?? 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__v3Test?.scene.getViewState().employees?.length === 3);
  const initial = await read(); assert.equal(initial.runtime.phase, 'FACILITY');
  await click('[data-v3="speed"][data-value="2"]');
  await page.waitForFunction(start => {
    const state = window.__v3Test.simulation.state;
    const saved = JSON.parse(localStorage.getItem('wanggeng.demo.v3'));
    return state.simulationTimeSec >= start + 16 && saved.state.simulationTimeSec >= start + 15
      && saved.state.employees.some(e => e.path.some(p => typeof p.segmentId === 'string'));
  }, initial.runtime.simulationTimeSec, { timeout: 30000, polling: 100 });
  const walking = await shot('01-ambient-autosave');
  assert(walking.stored.savedAtMs > initial.stored.savedAtMs);
  assert(walking.stored.state.simulationTimeSec >= initial.runtime.simulationTimeSec + 15);
  assertNoSaveError(walking);
  report.checks.push({ name: 'automatic-save-after-15-seconds-with-route-metadata', savedSimulationTime: walking.stored.state.simulationTimeSec, savedAtMs: walking.stored.savedAtMs, paths: walking.stored.state.employees.map(e => ({ id: e.id, path: e.path })) });

  await click('[data-v3="pause"]');
  await click('[data-v3="save"]');
  const paused = await shot('02-paused-manual-save');
  assert.equal(paused.runtime.timeScale, 0);
  assert.deepEqual(paused.stored.state, paused.runtime);
  assert(paused.runtime.employees.some(e => e.path.length > 0));
  assertNoSaveError(paused);
  await page.waitForTimeout(900);
  assert.deepEqual((await read()).runtime, paused.runtime);

  report.inputs.push({ at: new Date().toISOString(), action: 'browser.reload' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__v3Test?.scene.getViewState().employees?.length === 3);
  const reloaded = await shot('03-reloaded-same-paused-route');
  assert.deepEqual(reloaded.runtime, paused.runtime);
  assert.deepEqual(reloaded.stored.state, paused.runtime);
  assertNoSaveError(reloaded);
  report.checks.push({ name: 'paused-reload-keeps-wallet-position-path-and-all-state-exactly', wallet: reloaded.runtime.wallet, time: reloaded.runtime.simulationTimeSec, employees: reloaded.runtime.employees.map(e => ({ id: e.id, location: e.location, path: e.path })) });

  await click('[data-v3="pause"]');
  await page.waitForFunction(time => window.__v3Test.simulation.state.simulationTimeSec >= time + 4, reloaded.runtime.simulationTimeSec, { timeout: 10000 });
  await click('[data-v3="pause"]');
  const resumed = await shot('04-resumed-real-movement');
  assert(resumed.runtime.wallet > reloaded.runtime.wallet);
  assert(resumed.runtime.employees.some((e, i) => e.location.x !== reloaded.runtime.employees[i].location.x || e.location.y !== reloaded.runtime.employees[i].location.y));
  for (const employee of reloaded.runtime.employees.filter(e => e.path.length)) {
    const next = employee.path[0];
    const after = resumed.runtime.employees.find(e => e.id === employee.id);
    // If the first waypoint is still pending, the employee must have approached it along the retained route.
    if (JSON.stringify(after.path[0]) === JSON.stringify(next)) {
      assert(Math.hypot(after.location.x - next.x, after.location.y - next.y) < Math.hypot(employee.location.x - next.x, employee.location.y - next.y));
    }
  }
  assertNoSaveError(resumed);
  report.checks.push({ name: 'continue-resumes-real-movement-and-production', fromTime: reloaded.runtime.simulationTimeSec, toTime: resumed.runtime.simulationTimeSec, walletIncrease: resumed.runtime.wallet - reloaded.runtime.wallet });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.reason = String(error.stack ?? error);
  await shot('failure').catch(() => {});
} finally {
  await context.close(); await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, status: report.status, checks: report.checks.map(c => c.name), reason: report.reason }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
