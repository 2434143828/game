import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { status: 'RUNNING', checks: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  const read = () => page.evaluate(() => {
    const { controller, scene } = window.__sliceTest;
    return { employee: structuredClone(controller.state.employees[0]), work: structuredClone(controller.state.rooms[0].work), time: controller.state.simulationTimeSec, animation: scene.getAnimationState() };
  });
  const point = (method, value) => page.evaluate(({ method, value }) => window.__sliceTest.scene[method](value), { method, value });
  const click = async (method, value, button = 'left') => {
    const p = await point(method, value); await page.mouse.click(p.x, p.y, { button });
  };
  await page.goto('http://127.0.0.1:5173/?slice=1');
  await page.waitForFunction(() => window.__sliceTest?.scene?.getAnimationState);
  await click('getEmployeeScreenPoint', 'E01');
  await click('getCorridorScreenPoint', 750, 'right');
  await page.waitForFunction(() => { const p = window.__sliceTest.controller.state.employees[0].location; return p.zone === 'SAFE_CONNECTOR' && p.y < 560 && p.y > 475; });
  await page.keyboard.press('KeyS');
  await page.waitForTimeout(150);
  const safeStopped = await read();
  assert.equal(safeStopped.employee.order.kind, 'IDLE');
  assert.deepEqual(safeStopped.employee.path, []);
  assert.equal(safeStopped.animation.actors.find(actor => actor.id === 'E01').pose, 'CLIMB');
  await page.waitForTimeout(650);
  assert.deepEqual((await read()).employee.location, safeStopped.employee.location);
  await page.keyboard.press('Space');
  const paused = await read();
  await click('getCorridorScreenPoint', 750, 'right');
  await page.waitForTimeout(500);
  const after = await read();
  assert.equal(after.time, paused.time);
  assert.deepEqual(after.animation, paused.animation);
  await page.screenshot({ path: 'docs/spatial-evidence/ladder-safe-stop-paused.png' });
  report.checks.push({ name: 'Safe ladder stop holds rungs, accepts paused new destination without moving', before: safeStopped, after });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => { const e = window.__sliceTest.controller.state.employees[0]; return e.location.zone === 'CORRIDOR' && e.status === 'IDLE'; });
  await page.waitForTimeout(150); // Let the final displacement frame settle to its standing pose.
  const onFloor = await read();
  assert.equal(onFloor.animation.actors.find(actor => actor.id === 'E01').pose, 'IDLE');
  await click('workClickPoint');
  await click('getWorkChoicePoint', 'OBSERVE');
  await page.waitForFunction(() => { const p = window.__sliceTest.controller.state.employees[0].location; return p.zone === 'ROOM' && p.y < 400 && p.y > 300; });
  await page.keyboard.press('KeyS');
  await page.waitForTimeout(150);
  const roomStopped = await read();
  assert.equal(roomStopped.work, null);
  assert.equal(roomStopped.employee.order.kind, 'IDLE');
  assert.equal(roomStopped.animation.actors.find(actor => actor.id === 'E01').pose, 'CLIMB');
  await page.waitForTimeout(600);
  assert.deepEqual((await read()).employee.location, roomStopped.employee.location);
  await page.screenshot({ path: 'docs/spatial-evidence/ladder-room-stop.png' });
  report.checks.push({ name: 'Containment ladder stop releases work reservation and stays gripping the ladder', state: roomStopped });
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.reason = error.stack; process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile('docs/spatial-evidence/ladder-stop-proof.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, errors: report.errors, reason: report.reason }, null, 2));
}
