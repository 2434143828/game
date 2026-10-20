import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// A continuous real-input recording. No page.clock, Simulation.step, state assignments,
// injected health, economy changes or prerecorded character actions are used here.
const out = 'docs/spatial-evidence';
await mkdir(`${out}/video`, { recursive: true });
const report = {
  scope: 'v0.2 one-room two-employee debug slice; formal day one remains four',
  execution: 'Native Chrome renderer, real wall time, Playwright mouse/keyboard input; DEV bridge read only',
  status: 'RUNNING', startedAt: new Date().toISOString(), checkpoints: [], errors: [], samples: [],
  limitations: [
    'V01/V02 cover the isolated debug scene, not formal day one.',
    'V06 other-room production is not connected in this one-room slice.',
    'V08 other-anomaly area attacks, V09 skills and V11 equipment visuals are not connected or validated.',
  ],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: `${out}/video`, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();
let samplingTimer;
let samplingPromise;
page.setDefaultTimeout(15000);
page.on('pageerror', error => report.errors.push(error.message));
const assert = (value, message) => { if (!value) throw new Error(message); };
const state = () => page.evaluate(() => {
  const { controller, scene } = window.__sliceTest;
  const s = controller.state;
  return {
    realTimeMs: Date.now(), simulationTimeSec: s.simulationTimeSec, timeScale: s.timeScale,
    phase: s.phase, producedToday: s.producedToday, wallet: s.progress.wallet,
    selected: [...controller.selected], selectedEnemyId: controller.selectedEnemyId,
    employees: structuredClone(s.employees), rooms: structuredClone(s.rooms), enemies: structuredClone(s.enemies),
    animation: scene.getAnimationState(), events: structuredClone(controller.events), logs: structuredClone(s.logs),
    localStorage: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
  };
});
const wait = (predicate, arg = undefined, timeout = 15000) => page.waitForFunction(predicate, arg, { polling: 50, timeout });
const worldPoint = async (method, arg) => {
  const point = await page.evaluate(({ method, arg }) => {
    const scene = window.__sliceTest.scene;
    return typeof scene[method] === 'function' ? scene[method](arg) : scene[method];
  }, { method, arg });
  assert(point && Number.isFinite(point.x) && Number.isFinite(point.y), `Missing scene coordinate ${method}(${arg})`);
  const bounds = await page.locator('canvas').boundingBox();
  return { x: bounds.x + point.x * bounds.width / 1600, y: bounds.y + point.y * bounds.height / 900 };
};
const clickPoint = async (method, arg, button = 'left') => {
  const p = await worldPoint(method, arg);
  await page.mouse.click(p.x, p.y, { button });
};
const selectEmployee = id => clickPoint('getEmployeeScreenPoint', id);
const selectBoth = async () => {
  await selectEmployee('E01');
  await page.keyboard.down('Shift');
  await selectEmployee('E02');
  await page.keyboard.up('Shift');
  await wait(() => window.__sliceTest.controller.selected.size === 2);
};
const move = x => clickPoint('getCorridorScreenPoint', x, 'right');
const pause = async paused => {
  if ((await state()).timeScale === 0 !== paused) await page.keyboard.press('Space');
  await wait(expected => (window.__sliceTest.controller.state.timeScale === 0) === expected, paused);
};
const checkpoint = async (label, note = '') => {
  const id = String(report.checkpoints.length + 1).padStart(2, '0');
  const screenshot = `${out}/${id}-${label}.png`;
  await page.screenshot({ path: screenshot });
  const snapshot = await state();
  report.checkpoints.push({ label, note, screenshot, ...snapshot });
  console.log(`CHECKPOINT ${id} ${label} t=${snapshot.simulationTimeSec.toFixed(2)} employees=${snapshot.employees.length} enemies=${snapshot.enemies.length}`);
  return snapshot;
};
const assignObserve = async () => {
  await clickPoint('workClickPoint');
  if (await page.locator('[data-work="OBSERVE"]').count()) await page.locator('[data-work="OBSERVE"]').click();
  else await clickPoint('getWorkChoicePoint', 'OBSERVE');
};
const frozenFor = async (milliseconds, label) => {
  const before = await state();
  await page.waitForTimeout(milliseconds);
  const after = await state();
  assert(after.simulationTimeSec === before.simulationTimeSec, `${label}: simulation clock advanced during pause`);
  assert(JSON.stringify(after.animation) === JSON.stringify(before.animation), `${label}: actor/work/attack animation advanced during pause`);
  assert(JSON.stringify(after.employees.map(e => e.location)) === JSON.stringify(before.employees.map(e => e.location)), `${label}: feet moved during pause`);
};
const dragBoth = async () => {
  const a = await worldPoint('getEmployeeScreenPoint', 'E01');
  const b = await worldPoint('getEmployeeScreenPoint', 'E02');
  await page.mouse.move(Math.min(a.x, b.x) - 45, Math.min(a.y, b.y) - 50);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(Math.max(a.x, b.x) + 45, Math.max(a.y, b.y) + 60, { steps: 16 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await wait(() => window.__sliceTest.controller.selected.size === 2);
};

try {
  await page.goto('http://127.0.0.1:5173/?slice=1');
  await wait(() => window.__sliceTest?.scene?.getAnimationState && window.__sliceTest.controller.state.phase === 'RUNNING' && window.__sliceTest.controller.state.simulationTimeSec > 0.1, undefined, 25000);
  const initial = await checkpoint('normal-facility', 'One actual room, continuous corridor, safe room and two full-body employees.');
  assert(initial.employees.map(e => e.id).join(',') === 'E01,E02', 'The spatial debug scene must have exactly E01/E02.');
  assert(initial.employees.every(e => initial.animation.actors.some(actor => actor.id === e.id)), 'A visible person is missing its actual runtime entity binding.');
  report.facilityCoverage = await page.evaluate(() => {
    const view = window.__sliceTest.scene.constructor.geometry.view;
    return { view, canvasWidth: 1600, canvasHeight: 900, ratio: view.width * view.height / (1600 * 900) };
  });
  assert(report.facilityCoverage.ratio >= 0.65, 'The facility viewport occupies less than 65 percent of the logical canvas.');
  report.storageBefore = initial.localStorage;
  samplingTimer = setInterval(() => {
    if (samplingPromise) return;
    samplingPromise = page.evaluate(() => {
      const state = window.__sliceTest.controller.state;
      return {
        realTimeMs: Date.now(), time: state.simulationTimeSec, timeScale: state.timeScale,
        produced: state.producedToday, roomMode: state.rooms[0].mode,
        work: structuredClone(state.rooms[0].work),
        employees: state.employees.map(e => ({ id: e.id, location: { ...e.location }, status: e.status, order: { ...e.order }, hp: e.hp, sp: e.sp, phase: e.attackPhase, windup: e.windupEndsAtSec })),
        enemies: state.enemies.map(e => ({ id: e.id, clone: e.isClone, location: { ...e.location }, hp: e.suppressionHp, phase: e.attackPhase, windup: e.windupEndsAtSec })),
      };
    }).then(sample => report.samples.push(sample)).catch(error => report.errors.push(`read-only sampler: ${error.message}`)).finally(() => { samplingPromise = undefined; });
  }, 100);

  await selectEmployee('E01');
  await page.keyboard.down('Shift');
  await selectEmployee('E02');
  await page.keyboard.up('Shift');
  await wait(() => window.__sliceTest.controller.selected.size === 2);
  await checkpoint('shift-selection', 'Direct person clicks with Shift select the same two runtime IDs.');
  await selectEmployee('E01');
  await move(500);
  await wait(() => { const e = window.__sliceTest.controller.state.employees[0]; return e.location.zone === 'CORRIDOR' && e.location.x < 1100; });
  const beforeRedirect = await checkpoint('moving-before-redirect');
  await move(1150);
  await page.waitForTimeout(450);
  const redirected = await checkpoint('midwalk-redirect', 'A new destination reverses a person already walking.');
  assert(redirected.employees[0].location.x > beforeRedirect.employees[0].location.x, 'Midwalk redirect did not reverse horizontal movement.');
  await wait(() => window.__sliceTest.controller.state.employees[0].status === 'IDLE');
  await dragBoth();
  await move(700);
  await wait(() => window.__sliceTest.controller.state.employees.every(e => e.status === 'IDLE' && Math.abs(e.location.x - 700) < 1));
  await checkpoint('drag-group-arrival');

  await selectEmployee('E01');
  await pause(true);
  await assignObserve();
  const pausedWork = await checkpoint('paused-work-order', 'A work reservation is accepted while paused, with no walking or work elapsed.');
  assert(pausedWork.rooms[0].work?.phase === 'TRAVELLING' && pausedWork.rooms[0].work.elapsedSec === 0, 'Paused work must remain a travelling reservation.');
  await frozenFor(800, 'paused work order');
  await pause(false);
  await page.waitForTimeout(1000);
  await pause(true);
  await clickPoint('safeClickPoint', undefined, 'right');
  const canceled = await checkpoint('paused-midtravel-retreat', 'Cancel a real journey halfway, while paused, and replace it with a safe-room route.');
  assert(canceled.rooms[0].work === null && canceled.producedToday === 0, 'Cancelled work left a reservation or income.');
  assert(canceled.employees[0].order.kind === 'RETREAT', 'Right-clicking safe room did not replace the work order.');
  await frozenFor(800, 'paused retreat order');
  await pause(false);
  await page.waitForTimeout(1600);

  await selectEmployee('E01');
  await assignObserve();
  const farStart = await state();
  await wait(() => window.__sliceTest.controller.state.rooms[0].work?.phase === 'EXECUTING');
  const farArrived = await checkpoint('inside-room-working', 'The person physically reached the indoor work node before work animation and elapsed time began.');
  report.farTravelSec = farArrived.simulationTimeSec - farStart.simulationTimeSec;
  assert(farArrived.employees[0].location.zone === 'ROOM', 'Work began outside the actual room.');
  assert(farArrived.producedToday === 0, 'Travel or unfinished work paid energy.');
  await pause(true);
  await frozenFor(700, 'paused indoor work');
  await checkpoint('paused-working-animation');
  await pause(false);
  await selectEmployee('E02');
  await move(154);
  await wait(() => window.__sliceTest.controller.state.producedToday === 12, undefined, 30000);
  await checkpoint('actual-work-income', 'Exactly one 24-second observation completed: produced +12, wallet +12.');
  await wait(() => window.__sliceTest.controller.state.employees[0].location.zone === 'CORRIDOR' && window.__sliceTest.controller.state.employees[0].status === 'IDLE');
  await selectEmployee('E02');
  await assignObserve();
  const nearStart = await state();
  await wait(() => window.__sliceTest.controller.state.rooms[0].work?.phase === 'EXECUTING');
  const nearArrived = await checkpoint('near-worker-arrival', 'E02 starts beside the door; arrival is earlier than E01 travelling from far away.');
  report.nearTravelSec = nearArrived.simulationTimeSec - nearStart.simulationTimeSec;
  assert(report.nearTravelSec < report.farTravelSec, 'Near and far workers did not have different real travel times.');
  await page.locator('[data-action="stop"]').click();
  assert((await state()).rooms[0].work === null, 'Stop did not cancel executing work.');

  await dragBoth();
  await checkpoint('room-to-corridor-drag-selection', 'Drag begins in the room interior and extends across the doorway to select both employees.');
  await move(154);
  await wait(() => window.__sliceTest.controller.state.employees.every(e => e.status === 'IDLE' && e.location.zone === 'CORRIDOR' && Math.abs(e.location.x - 154) < 1));
  await page.locator('[data-action="breach"]').click();
  const breached = await checkpoint('real-main-and-two-clones', 'Visible debug button calls the same formal breach lifecycle.');
  assert(breached.enemies.length === 3 && breached.enemies.filter(e => !e.isClone).length === 1, 'The actual breach did not contain one main and two clones.');
  assert(breached.enemies.every(e => breached.animation.actors.some(actor => actor.id === e.id)), 'An actual enemy has no bound visible actor.');
  report.killEnergyBefore = { produced: breached.producedToday, wallet: breached.wallet };
  for (const enemy of breached.enemies) {
    await clickPoint('getEnemyScreenPoint', enemy.id);
    assert((await state()).selectedEnemyId === enemy.id, `Enemy ${enemy.id} could not be independently selected.`);
  }
  await frozenFor(700, 'paused spawned enemies');
  await pause(false);
  await page.waitForTimeout(2700);
  const idleThreat = await checkpoint('idle-employees-do-not-autoattack', 'Enemies can hit nearby idle employees; idle employees do not retaliate automatically.');
  assert(idleThreat.enemies.find(e => !e.isClone).suppressionHp === 180, 'Idle employees automatically damaged the main without suppression.');
  assert(idleThreat.employees.some(e => e.sp < breached.employees.find(before => before.id === e.id).sp), 'No actual enemy hit was observed.');
  await pause(true);
  await dragBoth();
  const mainId = breached.enemies.find(e => !e.isClone).id;
  await move(650);
  await pause(false);
  await page.waitForTimeout(4000);
  await pause(true);
  const separated = await checkpoint('moved-away-before-suppression', 'Both employees walk away under a normal movement order; pursuing enemies remain outside starter weapon range.');
  const distanceToMain = snapshot => {
    const main = snapshot.enemies.find(e => e.id === mainId);
    return snapshot.employees.map(employee => ({ id: employee.id, distance: Math.hypot(employee.location.x - main.location.x, employee.location.y - main.location.y) }));
  };
  const startingDistances = distanceToMain(separated);
  assert(startingDistances.every(e => e.distance > 65), 'Suppression approach must start outside the 65-pixel starter weapon range.');
  assert(separated.enemies.find(e => e.id === mainId).suppressionHp === 180, 'A normal movement order caused employee retaliation.');
  await clickPoint('getEnemyScreenPoint', mainId, 'right');
  const approachOrder = await checkpoint('explicit-suppression-order', 'Paused suppression targets a real enemy outside weapon range.');
  assert(approachOrder.employees.every(e => e.order.kind === 'SUPPRESS'), 'Right-clicking the actual enemy did not order both employees to suppress.');
  await pause(false);
  await page.waitForTimeout(150);
  const approaching = await checkpoint('approaching-before-weapon-range', 'After resuming, both employees visibly walk toward the main; it still takes no damage before either employee reaches range.');
  const approachDistances = distanceToMain(approaching);
  assert(approaching.employees.every(e => e.location.x < approachOrder.employees.find(before => before.id === e.id).location.x), 'Suppression did not move the distant employees toward the enemy.');
  assert(approachDistances.every(e => e.distance > 65), 'Approach evidence was captured after weapon range entry.');
  assert(approaching.enemies.find(e => e.id === mainId).suppressionHp === 180, 'The main took damage before the ordered employees reached range.');
  report.suppressionApproach = { weaponRangePx: 65, orderTimeSec: approachOrder.simulationTimeSec, observedTimeSec: approaching.simulationTimeSec, startingDistances, approachDistances, hpBefore: 180, hpWhileOutsideRange: 180 };
  await wait(() => window.__sliceTest.controller.state.enemies.find(e => !e.isClone)?.suppressionHp <= 132, undefined, 15000);
  await checkpoint('real-attacks-and-hit-feedback', 'Main suppression decreases only after ordered employees reach weapon range and finish real windups.');
  await wait(() => window.__sliceTest.controller.state.employees.some(e => e.windupEndsAtSec !== null), undefined, 3000);
  await pause(true);
  await checkpoint('paused-attack-windup');
  await frozenFor(700, 'paused attacks');
  await clickPoint('safeClickPoint', undefined, 'right');
  const retreat = await checkpoint('paused-combat-retreat', 'Retreat cancels both pursuit and unhit employee windups while the world is paused.');
  assert(retreat.employees.every(e => e.windupEndsAtSec === null && e.order.kind === 'RETREAT'), 'Retreat failed to cancel active employee attacks.');
  const enemyHpAtRetreat = retreat.enemies.find(e => e.id === mainId).suppressionHp;
  await frozenFor(700, 'paused combat retreat');
  await pause(false);
  await page.waitForTimeout(1200);
  await checkpoint('retreating-through-facility');
  await wait(() => window.__sliceTest.controller.state.employees.every(e => e.location.zone === 'SAFE'), undefined, 18000);
  const safety = await checkpoint('safe-room-arrival');
  assert(safety.enemies.find(e => e.id === mainId).suppressionHp === enemyHpAtRetreat, 'Retreating employees kept attacking.');
  await wait(() => window.__sliceTest.controller.state.employees.every(e => e.hp === e.hpMax && e.sp === e.spMax), undefined, 20000);
  await checkpoint('free-recovery-after-arrival');
  await pause(true);
  await dragBoth();
  await clickPoint('getEnemyScreenPoint', mainId, 'right');
  await pause(false);
  await wait(() => window.__sliceTest.controller.state.rooms[0].mode === 'RECOVERING', undefined, 30000);
  const recaptured = await checkpoint('main-recaptured-clones-cleared');
  assert(recaptured.enemies.length === 0, 'Recaptured main left clone entities.');
  assert(recaptured.producedToday === report.killEnergyBefore.produced && recaptured.wallet === report.killEnergyBefore.wallet, 'Breach or kills generated energy.');
  await wait(() => window.__sliceTest.controller.state.rooms[0].mode === 'CONTAINED', undefined, 12000);
  await checkpoint('ten-second-recovery-complete');

  await pause(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  if (await page.locator('[data-action="toggle-details"]').count()) await page.locator('[data-action="toggle-details"]').click();
  await page.waitForTimeout(300);
  await selectEmployee('E01');
  await move(450);
  const compactBefore = await state();
  await pause(false);
  await page.waitForTimeout(450);
  await pause(true);
  const compactAfter = await state();
  assert(JSON.stringify(compactAfter.employees[0].location) !== JSON.stringify(compactBefore.employees[0].location), 'Direct map selection and movement failed with details collapsed at 1280.');
  const small = await checkpoint('1280-spatial-view', 'Debug facility remains visible at 1280×720 with auxiliary details collapsed.');
  report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  assert(report.viewport.scrollWidth <= 1280 && report.viewport.scrollHeight <= 720, 'Core scene requires page scrolling at minimum resolution.');
  assert(JSON.stringify(small.localStorage) === JSON.stringify(report.storageBefore), 'Debug scene changed the formal local save.');
  assert(report.errors.length === 0, `Browser page errors: ${report.errors.join('; ')}`);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.reason = error instanceof Error ? error.stack : String(error);
  try { await checkpoint('failure-state', report.reason); } catch { /* preserve original failure */ }
  process.exitCode = 1;
} finally {
  if (samplingTimer) clearInterval(samplingTimer);
  if (samplingPromise) await samplingPromise;
  report.finishedAt = new Date().toISOString();
  await context.close();
  report.video = await page.video()?.path();
  await browser.close();
  await writeFile(`${out}/continuous-proof.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, video: report.video, checkpoints: report.checkpoints.length, reason: report.reason }, null, 2));
}
