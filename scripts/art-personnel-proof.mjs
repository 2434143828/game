import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { chromium } from '@playwright/test';

// This script observes the DEV bridge; every game/camera change uses native UI
// input. It never assigns state, invokes commands, advances time, or heals units.
const url = process.env.FACILITY_URL ?? 'http://127.0.0.1:5173/';
const runId = new Date().toISOString().replaceAll(':', '-');
const output = join(process.env.FACILITY_EVIDENCE_ROOT ?? 'docs/art-evidence-2026-10-20', 'personnel', runId);
const width = 1600, height = 900;
const employeeIds = ['E01', 'E02', 'E03', 'E04', 'E05', 'E06'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const employeeOf = (state, id = 'E01') => state.employees.find(employee => employee.id === id);
const inside = (point, rect, inset = 0) => point.x >= rect.x + inset && point.y >= rect.y + inset
  && point.x <= rect.x + rect.width - inset && point.y <= rect.y + rect.height - inset;
const suite = {
  status: 'RUNNING', startedAt: new Date().toISOString(), url, output,
  method: 'Serial native Chrome recordings, real mouse/keyboard and elapsed time; read-only DEV bridge observations.',
  boundaries: [
    'Personnel art framing only; this is not a formal three-day campaign acceptance run.',
    'Safe-room right clicks are RETREAT to its center. The lineup instead uses the existing control-hall corridor at y=850.',
    'Panic and incapacitation must come from actual N01/N02 attacks at original values.',
    'Each independent case starts in a fresh sandbox context; no state or resources are injected.',
    'Any timeout or browser error remains a failure with its actual screenshot, samples, and recording.',
  ],
  cases: [], ownedBrowserClosed: false,
};
let browser;

const read = page => page.evaluate(() => {
  const { controller, scene } = window.__facilityTest;
  const state = controller.state;
  return {
    time: state.simulationTimeSec, timeScale: state.timeScale, phase: state.phase, mode: controller.mode,
    wallet: state.progress.wallet, produced: state.producedToday,
    selected: [...controller.selected], selectedRoomId: controller.selectedRoomId,
    employees: structuredClone(state.employees), enemies: structuredClone(state.enemies),
    rooms: structuredClone(state.rooms), events: structuredClone(controller.events), logs: structuredClone(state.logs),
    camera: scene.getCameraState(), animation: scene.getAnimationState(), art: scene.getGeneratedArtState(),
    employeeScreens: Object.fromEntries(state.employees.map(employee => [employee.id, scene.getEmployeeScreenPoint(employee.id)])),
    enemyScreens: Object.fromEntries(state.enemies.map(enemy => [enemy.id, scene.getEnemyScreenPoint(enemy.id)])),
    storage: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
  };
});

function freezeComparable(state) {
  return {
    time: state.time, timeScale: state.timeScale, wallet: state.wallet, produced: state.produced,
    employees: state.employees, enemies: state.enemies, rooms: state.rooms, animation: state.animation, art: state.art,
  };
}

function distancesFrom(state, id = 'E01') {
  const employee = employeeOf(state, id), screen = state.employeeScreens[id];
  assert(employee && screen, `${id}: missing actual entity or projected body`);
  return state.enemies.map(enemy => ({
    enemyId: enemy.id, sourceAnomalyId: enemy.sourceAnomalyId, isClone: enemy.isClone,
    worldDistance: distance(employee.location, enemy.location),
    screenDistance: state.enemyScreens[enemy.id] ? distance(screen, state.enemyScreens[enemy.id]) : null,
  }));
}

async function runCase(name, execute) {
  const directory = join(output, name);
  await mkdir(join(directory, 'video'), { recursive: true });
  const report = {
    name, status: 'RUNNING', startedAt: new Date().toISOString(),
    pageErrors: [], consoleErrors: [], failedRequests: [], httpErrors: [], samplingErrors: [],
    navigations: [], inputTrace: [], checks: [], observations: [], samples: [], measurements: {},
    uiAssetRequests: 0, ownedContextClosed: false,
  };
  const context = await browser.newContext({
    viewport: { width, height }, recordVideo: { dir: join(directory, 'video'), size: { width, height } },
  });
  const page = await context.newPage();
  const video = page.video();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({ text: message.text(), location: message.location() });
  });
  page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('request', request => { if (request.url().includes('/art/ui/')) report.uiAssetRequests++; });
  page.on('response', response => {
    if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() });
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) report.navigations.push({ at: new Date().toISOString(), url: frame.url() });
  });
  let samplingTimer;
  let samplingPromise;
  let initial;
  const stamp = detail => report.inputTrace.push({ at: new Date().toISOString(), ...detail });
  const wait = (predicate, argument, timeout = 45000) => page.waitForFunction(predicate, argument, { timeout, polling: 25 });
  const sceneRead = (method, argument) => page.evaluate(({ method, argument }) =>
    window.__facilityTest.scene[method](argument), { method, argument });
  const click = async selector => {
    stamp({ action: 'dom_click', selector });
    await page.locator(selector).click();
  };
  const key = async value => {
    stamp({ action: 'key', value });
    await page.keyboard.press(value);
  };
  const canvasClick = async (point, button = 'left', purpose = '') => {
    assert(point && Number.isFinite(point.x) && Number.isFinite(point.y), 'Invalid projected canvas point');
    assert(point.x >= 0 && point.x < width && point.y >= 0 && point.y < height, 'Projected input is outside the canvas');
    const rect = await page.locator('canvas').boundingBox();
    assert(rect, 'Actual game canvas is missing');
    const client = { x: rect.x + point.x * rect.width / width, y: rect.y + point.y * rect.height / height };
    stamp({ action: 'canvas_click', point, client, button, purpose });
    await page.mouse.click(client.x, client.y, { button });
  };
  const pause = async wanted => {
    if (((await read(page)).timeScale === 0) !== wanted) await click('[data-action="pause"]');
    await wait(wanted => (window.__facilityTest.controller.state.timeScale === 0) === wanted, wanted);
  };
  const select = async id => {
    await click(`[data-employee="${id}"]`);
    await wait(id => {
      const selected = [...window.__facilityTest.controller.selected];
      return selected.length === 1 && selected[0] === id;
    }, id);
  };
  const focusRoom = async id => {
    const controls = await sceneRead('getCameraControls');
    await canvasClick(controls.rooms[id], 'left', `Native room shortcut ${id}`);
    await wait(id => window.__facilityTest.controller.selectedRoomId === id, id);
  };
  const focusPoint = async point => {
    await canvasClick(await sceneRead('getMapNavigationPoint', point), 'left', 'Native minimap navigation');
    await page.waitForTimeout(100);
  };
  const checkpoint = async (label, note = '') => {
    await page.mouse.move(15, 885);
    await page.waitForTimeout(180);
    const state = await read(page);
    const screenshot = `${String(report.checks.length + 1).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: join(directory, screenshot) });
    report.checks.push({ label, note, screenshot, state });
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ case: name, checkpoint: label, time: state.time, enemies: state.enemies.length }));
    return state;
  };
  const observe = async label => {
    const state = await read(page);
    report.observations.push({ label, at: new Date().toISOString(), state });
    return state;
  };
  const moveAndHold = async (id, point) => {
    assert.equal((await read(page)).timeScale, 0, 'Move setup must remain paused');
    await select(id);
    await focusPoint(point);
    // The control-hall floor y=850 is also the inclusive top of safeRect.
    // Click visibly inside the hallway above its floor; normal hit testing
    // projects this native click onto the unchanged corridor destination.
    const projection = await sceneRead('getCorridorScreenPoint', { x: point.x, y: point.y - 22 });
    assert(inside(projection, (await sceneRead('getCameraState')).view, 12), 'Move destination is outside the facility viewport');
    await canvasClick(projection, 'right', `${id} MOVE to real corridor ${point.x},${point.y}`);
    const order = employeeOf(await read(page), id).order;
    assert.equal(order.kind, 'MOVE', `${id}: native right click did not issue MOVE`);
    assert(distance(order.destination, point) < 2, `${id}: actual MOVE destination differs from its visible corridor`);
    await pause(false);
    await wait(({ id, point }) => {
      const employee = window.__facilityTest.controller.state.employees.find(item => item.id === id);
      return employee && Math.hypot(employee.location.x - point.x, employee.location.y - point.y) < 2 && !employee.path.length;
    }, { id, point }, 60000);
    await pause(true);
    await key('s');
    const actual = employeeOf(await read(page), id);
    assert(distance(actual.location, point) < 2, `${id}: did not stop at the actual destination`);
    assert.equal(actual.path.length, 0);
    report.observations.push({ label: `${id}-arrived-and-held`, point, time: (await read(page)).time, employee: actual });
  };
  const freezeCheck = async () => {
    await pause(true);
    await page.waitForTimeout(100);
    const before = await read(page);
    const requestsBefore = report.uiAssetRequests;
    await page.waitForTimeout(700);
    const after = await read(page);
    assert.deepEqual(freezeComparable(after), freezeComparable(before), 'Paused real entity state/animation changed');
    assert.equal(report.uiAssetRequests, requestsBefore, 'Unchanged paused HUD re-requested SVG assets');
    report.measurements.pause = { wallWaitMs: 700, simulationTime: before.time, assetRequestIncrease: report.uiAssetRequests - requestsBefore };
  };
  const breach = async id => {
    await focusRoom(id);
    await click('[data-action="breach"]');
    await wait(id => window.__facilityTest.controller.state.rooms.find(room => room.anomalyId === id)?.mode === 'BREACHED', id);
    await pause(true);
    const state = await read(page);
    assert.equal(state.enemies.filter(enemy => enemy.sourceAnomalyId === id).length, id === 'N01' ? 3 : 1);
    await select('E01');
    await key('f');
    assert.equal((await sceneRead('getCameraState')).following, 'E01');
    await checkpoint(`${id}-actual-breach-before-damage`);
  };
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await wait(() => {
      const bridge = window.__facilityTest;
      return bridge?.scene.getAnimationState().actors.length === bridge?.controller.state.employees.length;
    }, undefined, 30000);
    await pause(true);
    await click('[data-action="select-all"]');
    await click('[data-action="stop"]');
    await click('[data-action="speed2"]');
    await pause(true);
    initial = await read(page);
    assert.equal(initial.mode, 'sandbox');
    assert.equal(initial.phase, 'RUNNING');
    assert.equal(initial.employees.length, 6);
    assert.equal(initial.produced, 0);
    assert.deepEqual(initial.enemies, []);
    assert(initial.employees.every(employee => employee.hp === employee.hpMax && employee.sp === employee.spMax));
    report.initial = initial;
    samplingTimer = setInterval(() => {
      if (samplingPromise) return;
      samplingPromise = read(page).then(state => {
        report.samples.push({
          wallAt: new Date().toISOString(), time: state.time, timeScale: state.timeScale,
          employees: state.employees.map(employee => ({
            id: employee.id, status: employee.status, hp: employee.hp, sp: employee.sp,
            location: employee.location, order: employee.order, pathLength: employee.path.length,
          })),
          enemies: state.enemies.map(enemy => ({
            id: enemy.id, sourceAnomalyId: enemy.sourceAnomalyId, location: enemy.location,
            suppressionHp: enemy.suppressionHp, targetEmployeeId: enemy.targetEmployeeId,
          })),
        });
      }).catch(error => report.samplingErrors.push(String(error))).finally(() => { samplingPromise = null; });
    }, 200);
    await execute({ page, report, wait, click, key, pause, select, sceneRead, moveAndHold, breach, checkpoint, observe, freezeCheck });
    const final = await read(page);
    assert.equal(final.wallet, initial.wallet, 'Personnel framing must not inject or spend energy');
    assert.equal(final.produced, 0, 'Personnel framing must not fabricate work income');
    assert.deepEqual(final.storage, initial.storage, 'Sandbox framing changed persistent storage');
    assert.equal(report.navigations.length, 1, 'Recording was interrupted by a reload or HMR navigation');
    report.final = final;
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.reason = String(error.stack ?? error);
    if (!page.isClosed()) {
      await pause(true).catch(error => report.observations.push({ label: 'failure-pause-error', error: String(error) }));
      await checkpoint('failure', 'Actual failure/timeout retained; no state repair or artificial pose.').catch(async error => {
        report.observations.push({ label: 'failure-capture-error', error: String(error) });
        await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {});
      });
    }
  } finally {
    clearInterval(samplingTimer);
    if (samplingPromise) await samplingPromise;
    try { await context.close(); report.ownedContextClosed = true; }
    catch (error) { report.status = 'FAIL'; report.closeError = String(error); }
    if (video) {
      try { report.video = relative(directory, await video.path()); }
      catch (error) { report.videoError = String(error); report.status = 'FAIL'; }
    }
    const errors = ['pageErrors', 'consoleErrors', 'failedRequests', 'httpErrors', 'samplingErrors'];
    if (errors.some(key => report[key].length)) {
      report.status = 'FAIL';
      report.reason ??= 'Observed browser, HTTP, request, or sampling errors; see recorded arrays.';
    }
    report.finishedAt = new Date().toISOString();
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
    suite.cases.push({
      name, status: report.status, report: `${name}/report.json`, checks: report.checks.length,
      samples: report.samples.length, video: report.video ? `${name}/${report.video}` : null,
      errors: Object.fromEntries(errors.map(key => [key, report[key].length])), reason: report.reason,
    });
    await writeFile(join(output, 'suite.json'), JSON.stringify(suite, null, 2));
    console.log(JSON.stringify({ case: name, status: report.status, checks: report.checks.length, reason: report.reason }));
  }
}

async function lineup({ report, click, key, pause, select, moveAndHold, checkpoint, sceneRead, wait, freezeCheck }) {
  const opening = await sceneRead('getAnimationState');
  // Visual lanes offset some employees left/right. Assign corridor positions in
  // that same order so the existing presentation offsets cannot overlap faces.
  const orderedIds = employeeIds.slice().sort((a, b) => {
    const left = opening.actors.find(actor => actor.id === a), right = opening.actors.find(actor => actor.id === b);
    return (left.foot.x - left.world.x) - (right.foot.x - right.world.x);
  });
  const destinations = [1660, 1750, 1840, 1930, 2020, 2110].map(x => ({ x, y: 850 }));
  report.measurements.lineup = orderedIds.map((id, index) => ({ id, destination: destinations[index] }));
  for (let index = 0; index < orderedIds.length; index++) await moveAndHold(orderedIds[index], destinations[index]);
  await click('[data-action="select-all"]');
  await click('[data-action="stop"]');
  // Give the real renderer a simulation tick after STOP to settle the walk pose.
  await pause(false);
  await wait(() => window.__facilityTest.scene.getAnimationState().actors.every(actor => actor.pose === 'IDLE'));
  await pause(true);
  await select('E03');
  await key('f');
  const actual = await checkpoint('six-hairstyles-and-uniforms', 'Six real employees, separated by native corridor MOVE and STOP; F follows E03.');
  assert.equal(actual.camera.zoom, 1);
  assert.equal(actual.camera.following, 'E03');
  for (let index = 0; index < orderedIds.length; index++) {
    const employee = employeeOf(actual, orderedIds[index]);
    assert(distance(employee.location, destinations[index]) < 2);
    assert.equal(employee.status, 'IDLE');
    assert(inside(actual.employeeScreens[employee.id], actual.camera.view, 50), `${employee.id}: face outside clear viewport`);
  }
  const screens = employeeIds.map(id => actual.employeeScreens[id]).sort((a, b) => a.x - b.x);
  const separations = screens.slice(1).map((point, index) => point.x - screens[index].x);
  assert(separations.every(value => value >= 80), 'Employee silhouettes overlap in the lineup framing');
  report.measurements.projectedHorizontalGaps = separations;
  await freezeCheck();
}

async function consequence({ page, report, wait, key, pause, sceneRead, moveAndHold, breach, checkpoint, observe, freezeCheck }, id, expected) {
  const map = await sceneRead('getMapState');
  if (id === 'N02') {
    // After E01 is actually down, the cat needs another legitimate corridor
    // target to leave the body. E02 waits below the landing, reached by real path.
    const baitNode = map.nodes.find(node => node.id === 'b-hub');
    assert(baitNode);
    await moveAndHold('E02', { x: baitNode.x, y: baitNode.y });
  }
  const entry = map.nodes.find(node => node.id === map.rooms[id].entryNodeId);
  assert(entry, `${id}: no real entry node`);
  await moveAndHold('E01', { x: entry.x, y: entry.y });
  await breach(id);
  await pause(false);
  await wait(({ expected }) => window.__facilityTest.controller.state.employees.find(employee => employee.id === 'E01')?.status === expected,
    { expected }, 60000);
  const onset = await observe(`actual-${expected.toLowerCase()}-onset`);
  const victim = employeeOf(onset);
  assert.equal(victim.status, expected);
  if (expected === 'PANICKED') { assert.equal(victim.sp, 0); assert(victim.hp > 0); }
  else assert.equal(victim.hp, 0);
  const threshold = expected === 'PANICKED' ? 130 : 100;
  // Continue actual simulation after the status change, until both world-space
  // distance and visible body separation allow an unobstructed honest capture.
  await wait(({ expected, threshold }) => {
    const { controller, scene } = window.__facilityTest;
    const state = controller.state, employee = state.employees.find(item => item.id === 'E01');
    const body = scene.getEmployeeScreenPoint('E01');
    if (!employee || employee.status !== expected || !body || !state.enemies.length) return false;
    return state.enemies.every(enemy => {
      const enemyBody = scene.getEnemyScreenPoint(enemy.id);
      return enemyBody && Math.hypot(employee.location.x - enemy.location.x, employee.location.y - enemy.location.y) > threshold + 10
        && Math.hypot(body.x - enemyBody.x, body.y - enemyBody.y) > 120;
    });
  }, { expected, threshold }, 45000);
  await pause(true);
  await key('f');
  const actual = await checkpoint(expected === 'PANICKED' ? 'panic-retreat-clear-of-enemies' : 'incapacitated-body-after-cat-leaves',
    `Actual ${expected}; all enemies more than ${threshold} world units away, with extra projected separation.`);
  const finalVictim = employeeOf(actual);
  assert.equal(finalVictim.status, expected);
  const separations = distancesFrom(actual);
  assert(separations.length > 0);
  assert(separations.every(item => item.worldDistance > threshold && item.screenDistance > 110));
  assert(inside(actual.employeeScreens.E01, actual.camera.view, 50), 'Employee pose is outside the actual viewport');
  assert.equal(actual.camera.following, 'E01');
  if (expected === 'PANICKED') {
    assert.equal(finalVictim.order.kind, 'RETREAT');
    assert(distance(finalVictim.location, victim.location) > 40, 'Panic retreat has not actually moved');
  } else {
    assert.equal(finalVictim.hp, 0);
    assert(distance(finalVictim.location, victim.location) < 0.01, 'Downed body unexpectedly moved');
    assert(actual.enemies.some(enemy => enemy.sourceAnomalyId === 'N02' && enemy.targetEmployeeId === 'E02'),
      'Cat did not naturally switch from the downed employee to the waiting corridor employee');
  }
  assert(actual.enemies.every(enemy => enemy.suppressionHp === enemy.suppressionHpMax), 'No suppression order or artificial enemy damage is allowed');
  report.measurements.consequence = { status: expected, threshold, onsetTime: onset.time, clearTime: actual.time, distances: separations };
  await freezeCheck();
  await observe('paused-consequence-after-700ms');
  assert(!page.isClosed());
}

await mkdir(output, { recursive: true });
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader'] });
  await runCase('lineup', lineup);
  await runCase('panic', tools => consequence(tools, 'N01', 'PANICKED'));
  await runCase('incapacitated', tools => consequence(tools, 'N02', 'INCAPACITATED'));
  suite.status = suite.cases.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
} catch (error) {
  suite.status = 'FAIL';
  suite.reason = String(error.stack ?? error);
} finally {
  if (browser) {
    try { await browser.close(); suite.ownedBrowserClosed = true; }
    catch (error) { suite.status = 'FAIL'; suite.closeError = String(error); }
  }
  suite.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'suite.json'), JSON.stringify(suite, null, 2));
  console.log(JSON.stringify({ output, status: suite.status, cases: suite.cases }));
  if (suite.status !== 'PASS') process.exitCode = 1;
}
