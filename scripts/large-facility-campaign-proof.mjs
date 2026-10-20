import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Expanded multi-floor facility campaign acceptance. All writes occur through mouse/keyboard UI.
// The DEV bridge is used only for observations and published scene coordinates.
// No clock replacement, direct command, simulation step, state injection or storage fixture.
const game = JSON.parse(await readFile('config/game.json', 'utf8'));
const days = JSON.parse(await readFile('config/days.json', 'utf8'));
const anomalies = JSON.parse(await readFile('config/anomalies.json', 'utf8')).anomalies;
const map = JSON.parse(await readFile('config/facility.json', 'utf8'));
const transitEdges = new Set(map.edges.filter(edge => edge.kind === 'TRANSIT').map(edge => `edge:${edge.from}:${edge.to}`));
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const evidenceRoot = 'docs/large-facility-evidence-2026-10-20';
const out = resolve(`${evidenceRoot}/campaign-run-${stamp}`);
await mkdir(out, { recursive: true });
const url = process.env.FACILITY_URL ?? 'http://127.0.0.1:5173/';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const report = {
  status: 'RUNNING', startedAt: new Date().toISOString(), directory: out, cases: [],
  method: 'Real Chrome, real elapsed wall time and mouse/keyboard UI only; built-in speed 2. Minimap and room focus controls operated by mouse; DEV bridge reads only.',
  restrictions: ['No state writes', 'No direct simulation commands', 'No clock mocks', 'No time stepping', 'No preloaded storage or resource fixtures'],
  map: { id: map.id, bounds: map.bounds, ambient: map.ambient, source: 'config/facility.json' },
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
console.log(`campaign proof: owned Chrome launched; artifacts ${out}`);
let interrupted = false;
process.on('SIGINT', () => { interrupted = true; console.log('Campaign proof cancellation requested; closing owned browser through finally.'); });

async function runCase(name, body) {
  const directory = `${out}/${name}`;
  await mkdir(`${directory}/video`, { recursive: true });
  const record = { name, status: 'RUNNING', startedAt: new Date().toISOString(), checkpoints: [], samples: [], inputTrace: [], assignments: [], errors: [], consoleErrors: [], consoleDetails: [], httpErrors: [], requestFailures: [] };
  console.log(`${name}: creating isolated recording context`);
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: `${directory}/video`, size: { width: 1600, height: 900 } },
  });
  console.log(`${name}: creating browser page`);
  const page = await context.newPage();
  console.log(`${name}: page ready`);
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => record.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      record.consoleErrors.push(message.text());
      record.consoleDetails.push({ text: message.text(), location: message.location() });
    }
  });
  page.on('response', response => { if (response.status() >= 400) record.httpErrors.push({ url: response.url(), status: response.status() }); });
  page.on('requestfailed', request => record.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  const state = () => page.evaluate(() => {
    const { controller, scene } = window.__facilityTest;
    const s = controller.state;
    return {
      realTimeMs: Date.now(), mode: controller.mode, phase: s.phase, day: s.day, timeScale: s.timeScale,
      simulationTimeSec: s.simulationTimeSec, producedToday: s.producedToday, wallet: s.progress.wallet,
      tutorialPending: s.tutorialPending, selected: [...controller.selected], selectedRoomId: controller.selectedRoomId,
      progress: structuredClone(s.progress), employees: structuredClone(s.employees), rooms: structuredClone(s.rooms),
      enemies: structuredClone(s.enemies), logs: structuredClone(s.logs), events: structuredClone(controller.events),
      animation: scene.getAnimationState(), report: s.report ? structuredClone(s.report) : null,
      camera: scene.getCameraState(), entrySnapshot: structuredClone(s.entrySnapshot),
      storage: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
    };
  });
  const button = async selector => {
    await page.locator(selector).first().click();
    record.inputTrace.push({ time: new Date().toISOString(), type: 'DOM_CLICK', selector });
  };
  const action = name => button(`[data-action="${name}"]`);
  const wait = (predicate, arg, timeout = 20000) => page.waitForFunction(predicate, arg, { polling: 50, timeout });
  const screenPoint = async position => {
    assert(position && Number.isFinite(position.x) && Number.isFinite(position.y), 'Missing or invalid published scene point');
    assert(position.x >= 16 && position.x <= 1344 && position.y >= 76 && position.y <= 796,
      `Published scene point is outside the playable viewport: ${JSON.stringify(position)}`);
    const bounds = await page.locator('canvas').boundingBox();
    assert(bounds, 'No game canvas');
    return { x: bounds.x + position.x * bounds.width / 1600, y: bounds.y + position.y * bounds.height / 900 };
  };
  const point = async (method, argument) => {
    assert(['getMapNavigationPoint', 'getEmployeeScreenPoint', 'getRoomClickPoint', 'getWorkChoicePoint'].includes(method), `Not a read-only scene coordinate method: ${method}`);
    const position = await page.evaluate(({ method, argument }) => window.__facilityTest.scene[method](argument), { method, argument });
    assert(position && Number.isFinite(position.x) && Number.isFinite(position.y), `Missing ${method}(${argument})`);
    return screenPoint(position);
  };
  const click = async (method, argument) => {
    const position = await point(method, argument);
    await page.mouse.click(position.x, position.y);
    record.inputTrace.push({ time: new Date().toISOString(), type: 'CANVAS_CLICK', method, argument, position });
  };
  const focusRoom = async roomId => {
    const control = await page.evaluate(id => window.__facilityTest.scene.getCameraControls().rooms[id], roomId);
    const position = await screenPoint(control);
    await page.mouse.click(position.x, position.y);
    record.inputTrace.push({ time: new Date().toISOString(), type: 'CAMERA_ROOM_CLICK', roomId, position });
    await wait(id => window.__facilityTest.controller.selectedRoomId === id, roomId);
  };
  const overview = async () => {
    await page.keyboard.press('Home');
    record.inputTrace.push({ time: new Date().toISOString(), type: 'KEY', key: 'Home' });
    await wait(() => window.__facilityTest.scene.getCameraState().zoom < 0.3);
  };
  const pause = async paused => {
    const current = await state();
    if ((current.timeScale === 0) !== paused) await action('pause');
    await wait(value => (window.__facilityTest.controller.state.timeScale === 0) === value, paused);
  };
  const work = async (roomId, employeeId, type) => {
    // A real minimap click moves the camera to the employee, then the real actor is selected.
    await click('getMapNavigationPoint', employeeId);
    await click('getEmployeeScreenPoint', employeeId);
    await wait(id => {
      const selected = window.__facilityTest.controller.selected;
      return selected.size === 1 && selected.has(id);
    }, employeeId);
    await focusRoom(roomId);
    await click('getRoomClickPoint', roomId);
    await click('getWorkChoicePoint', type);
    const after = await state();
    const actual = after.rooms.find(room => room.anomalyId === roomId).work;
    assert(actual?.employeeId === employeeId && actual.type === type, `Rejected UI assignment ${roomId}/${employeeId}/${type}`);
    record.assignments.push({ realTime: new Date().toISOString(), day: after.day, simulationTimeSec: after.simulationTimeSec, roomId, employeeId, type, workId: actual.workId, phase: actual.phase, workerLocation: after.employees.find(e => e.id === employeeId).location, path: after.employees.find(e => e.id === employeeId).path });
    return actual;
  };
  const checkpoint = async (label, note = '') => {
    const current = await state();
    const file = `${directory}/${String(record.checkpoints.length + 1).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: file });
    record.checkpoints.push({ label, note, screenshot: file, ...current });
    console.log(`${name}: ${label} day=${current.day} phase=${current.phase} t=${current.simulationTimeSec.toFixed(2)} produced=${current.producedToday} wallet=${current.wallet}`);
    await writeFile(`${directory}/proof.json`, JSON.stringify(record, null, 2));
    return current;
  };
  const start = async () => {
    console.log(`${name}: navigating to formal campaign`);
    await page.goto(`${url}?mode=campaign`);
    console.log(`${name}: navigation complete; waiting for scene`);
    await wait(() => Boolean(window.__facilityTest?.scene?.getEmployeeScreenPoint('E01')));
    await wait(() => window.__facilityTest.controller.state.phase === 'DAY_PREP');
    const initial = await state();
    assert(initial.mode === 'campaign' && initial.day === 1 && initial.employees.length === 4, 'Initial campaign roster/phase is wrong');
    assert(initial.wallet === game.economy.initialWallet && initial.producedToday === 0, 'Initial economy is not original config');
    assert(initial.employees.every(employee => employee.location.x === map.safePoint.x && employee.location.y === map.safePoint.y), 'Formal campaign did not initialize inside the authored medical area');
    const actualMap = await page.evaluate(() => window.__facilityTest.scene.getMapState());
    assert(actualMap.id === map.id && actualMap.bounds.width === 3600 && actualMap.bounds.height === 2500, 'Scene is not the expanded multi-floor facility');
    return initial;
  };
  try {
    await body({ page, state, button, action, wait, click, focusRoom, overview, pause, work, checkpoint, start, record });
    assert(record.errors.length === 0 && record.consoleErrors.length === 0 && record.httpErrors.length === 0 && record.requestFailures.length === 0,
      `Browser/resource errors: ${JSON.stringify({ page: record.errors, console: record.consoleDetails, http: record.httpErrors, request: record.requestFailures })}`);
    record.status = 'PASS';
  } catch (error) {
    record.status = 'FAIL';
    record.reason = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1;
    try { await checkpoint('failure', record.reason); } catch { /* keep original diagnostic */ }
  } finally {
    record.finishedAt = new Date().toISOString();
    record.wallDurationSec = (Date.parse(record.finishedAt) - Date.parse(record.startedAt)) / 1000;
    await context.close();
    record.video = await page.video()?.path();
    await writeFile(`${directory}/proof.json`, JSON.stringify(record, null, 2));
    report.cases.push({ name, status: record.status, wallDurationSec: record.wallDurationSec, report: `${directory}/proof.json`, video: record.video, reason: record.reason });
    await writeFile(`${out}/suite.json`, JSON.stringify(report, null, 2));
    console.log(`${name}: ${record.status}; wall=${record.wallDurationSec.toFixed(1)}s ${record.reason ?? ''}`);
  }
}

async function fullCampaign(t) {
  await t.start();
  await t.overview();
  await t.checkpoint('day1-original-four-person-preparation');
  await t.action('save');
  const savedInitial = await t.state();
  assert(JSON.parse(savedInitial.storage[game.save.key]).snapshot.day === 1, 'Explicit UI save did not save first-day entry');
  const summaries = [];
  for (const day of days) {
    let current = await t.state();
    assert(current.day === day.day && current.phase === 'DAY_PREP', `Expected day ${day.day} preparation`);
    assert(current.employees.length === day.rosterCount, `Day ${day.day} roster differs from original config`);
    assert(current.rooms.filter(room => room.mode === 'CONTAINED').length === day.activeAnomalyIds.length, `Day ${day.day} unlock roster differs from original config`);
    assert(current.entrySnapshot.day === day.day && current.entrySnapshot.progress.wallet === current.wallet, `Day ${day.day} entry snapshot differs from preparation`);
    await t.action('start');
    await t.action('speed2');
    const startedAt = Date.now();
    let photographed = false;
    let lastLogAt = 0;
    let lastSampleAt = 0;
    let lastSimulationTime = 0;
    while (true) {
      assert(!interrupted, 'Campaign proof intentionally interrupted before completion');
      current = await t.state();
      assert(Date.now() - startedAt < 420000, `Day ${day.day} exceeded seven-minute wall limit`);
      assert(current.phase === 'RUNNING', `Unexpected campaign phase ${current.phase}`);
      assert(current.simulationTimeSec >= lastSimulationTime, `Day ${day.day} simulation time moved backward; possible reload/HMR`);
      lastSimulationTime = current.simulationTimeSec;
      assert(current.enemies.length === 0, 'Steady-production campaign accidentally breached; inspect recorded state');
      assert(current.employees.every(employee => employee.status !== 'INCAPACITATED'), 'An employee became incapacitated');
      if (current.tutorialPending) {
        await t.checkpoint('day1-tutorial-real-threshold');
        await t.action('tutorial-skip');
        continue;
      }
      if (current.producedToday >= day.quota) break;
      const idle = current.rooms.filter(room => room.mode === 'CONTAINED' && !room.work);
      if (idle.length) {
        await t.pause(true);
        for (const room of idle) {
          const fresh = await t.state();
          const liveRoom = fresh.rooms.find(item => item.anomalyId === room.anomalyId);
          if (liveRoom.work) continue;
          const fixed = { N01: 'E01', N03: 'E03', N04: 'E04', N05: 'E05' };
          const pool = room.anomalyId === 'N02'
            ? ['E02', day.day === 1 ? 'E03' : day.day === 2 ? 'E05' : 'E06']
            : [fixed[room.anomalyId]];
          const employeeId = pool.find(id => id !== liveRoom.memory.lastCompletedEmployeeId && !fresh.rooms.some(item => item.work?.employeeId === id))
            ?? pool.find(id => !fresh.rooms.some(item => item.work?.employeeId === id));
          assert(employeeId, `No available worker for ${room.anomalyId}`);
          assert(!['PANICKED', 'INCAPACITATED'].includes(fresh.employees.find(employee => employee.id === employeeId).status), `Assigned unavailable worker ${employeeId}`);
          let type = 'OBSERVE';
          if (liveRoom.pressure >= (room.anomalyId === 'N03' ? 55 : 65)) type = 'SOOTHE';
          if (room.anomalyId === 'N04' && liveRoom.memory.nonSootheCount >= 2) type = 'SOOTHE';
          await t.work(room.anomalyId, employeeId, type);
        }
        await t.overview();
        await t.pause(false);
      }
      current = await t.state();
      if (!photographed && current.rooms.filter(room => room.work?.phase === 'EXECUTING').length === day.activeAnomalyIds.length) {
        await t.checkpoint(`day${day.day}-all-open-rooms-working`);
        photographed = true;
      }
      if (Date.now() - lastSampleAt >= 2000) {
        t.record.samples.push({
          realTimeMs: Date.now(), day: current.day, phase: current.phase, time: current.simulationTimeSec,
          timeScale: current.timeScale, produced: current.producedToday, wallet: current.wallet,
          rooms: current.rooms.map(room => ({ id: room.anomalyId, pressure: room.pressure, mode: room.mode, work: room.work })),
          employees: current.employees.map(employee => ({ id: employee.id, hp: employee.hp, sp: employee.sp, status: employee.status, location: employee.location })),
          camera: current.camera,
        });
        lastSampleAt = Date.now();
      }
      if (Date.now() - lastLogAt >= 20000) {
        console.log(`campaign: day${day.day} running t=${current.simulationTimeSec.toFixed(1)} produced=${current.producedToday}/${day.quota}`);
        lastLogAt = Date.now();
      }
      await t.page.waitForTimeout(800);
    }
    await t.pause(true);
    await t.checkpoint(`day${day.day}-quota-reached`);
    await t.action('finish');
    await t.checkpoint(`day${day.day}-finish-confirmation`);
    await t.action('confirm-finish');
    await t.wait(expected => window.__facilityTest.controller.state.phase === expected, day.day === 3 ? 'COMPLETE' : 'DAY_REPORT');
    const end = await t.checkpoint(`day${day.day}-${day.day === 3 ? 'complete' : 'report'}`);
    const incomeLogs = end.logs.filter(log => log.kind === 'INCOME');
    assert(incomeLogs.length > 0 && end.producedToday >= day.quota, `Day ${day.day} lacks real work income`);
    assert(end.report?.produced === end.producedToday, `Day ${day.day} report differs from actual production`);
    assert(end.report.breaches === 0 && end.report.incapacitated === 0, `Day ${day.day} stable plan failed`);
    assert(end.wallet === game.economy.initialWallet + summaries.reduce((sum, summary) => sum + summary.produced, 0) + end.producedToday, 'Campaign wallet was not solely original resources plus actual work');
    summaries.push({ day: day.day, produced: end.producedToday, wallet: end.wallet, simulationTimeSec: end.simulationTimeSec, incomes: incomeLogs.length, roster: end.employees.map(employee => employee.id), report: end.report });
    if (day.day < 3) {
      await t.action('next-day');
      await t.wait(expected => window.__facilityTest.controller.state.day === expected && window.__facilityTest.controller.state.phase === 'DAY_PREP', day.day + 1);
      const entry = await t.checkpoint(`day${day.day + 1}-saved-entry`);
      const persisted = JSON.parse(entry.storage[game.save.key]);
      assert(persisted.snapshot.day === day.day + 1, 'Next-day boundary did not persist before display');
      assert(persisted.snapshot.progress.wallet === end.wallet && entry.wallet === end.wallet, 'Next-day entry lost the previous day actual wallet');
      assert(entry.employees.every(employee => employee.location.x === map.safePoint.x && employee.location.y === map.safePoint.y && employee.location.zone === 'SAFE'), 'New-day roster did not reset to medical preparation');
    }
  }
  t.record.days = summaries;
  for (const day of days) {
    const dispatched = t.record.assignments.filter(item => item.day === day.day);
    assert(day.activeAnomalyIds.every(id => dispatched.some(item => item.roomId === id)), `Day ${day.day} did not use every available containment room`);
    assert(dispatched.some(item => item.path.some(point => transitEdges.has(point.segmentId))),
      `Day ${day.day} has no recorded route through the authored multi-floor graph`);
  }
  assert(t.record.samples.some(sample => sample.employees.some(employee => employee.location.zone === 'TRANSIT')), 'The real campaign never observed an employee using a connector');
  const final = await t.state();
  const completionRaw = final.storage[game.save.key];
  assert(JSON.parse(completionRaw).demoCompleted === true, 'Actual completion marker was not persisted');
  await t.page.reload();
  await t.wait(() => window.__facilityTest?.controller.state.phase === 'DAY_PREP');
  assert((await t.state()).storage[game.save.key] === completionRaw, 'Fresh page silently overwrote completion save');
  await t.action('load');
  await t.action('confirm-load');
  await t.wait(() => window.__facilityTest.controller.state.phase === 'COMPLETE');
  const reloaded = await t.checkpoint('completion-restored-through-explicit-load', 'Restored completion marker from day-three entry snapshot; day runtime counters intentionally reset.');
  assert(reloaded.day === 3 && reloaded.employees.length === 6, 'Completed save loaded an incorrect day/roster');
  assert(reloaded.producedToday === 0 && reloaded.simulationTimeSec === 0, 'Explicit load incorrectly restored runtime counters');
  assert(reloaded.wallet === summaries[1].wallet, 'Completed save did not preserve the actual day-three entry progress');
  assert(reloaded.storage[game.save.key] === completionRaw, 'Reading a completed save changed its bytes');
}

async function entryRetry(t) {
  await t.start();
  await t.action('save');
  const original = (await t.state()).storage[game.save.key];
  await t.action('start');
  await t.action('speed2');
  await t.pause(true);
  await t.work('N01', 'E01', 'OBSERVE');
  await t.pause(false);
  const began = Date.now();
  while ((await t.state()).producedToday === 0) {
    assert(!interrupted, 'Entry proof intentionally interrupted before completion');
    assert(Date.now() - began < 90000, 'Real single work did not complete for retry test');
    await t.page.waitForTimeout(1000);
  }
  await t.pause(true);
  const earned = await t.checkpoint('one-real-work-earned-before-retry');
  assert(earned.producedToday === anomalies.find(anomaly => anomaly.id === 'N01').workProfiles.find(work => work.type === 'OBSERVE').energy, 'Single-work test did not use configured income');
  await t.action('archives');
  await t.button('[data-purchase="BEHAVIOR"]');
  await t.action('close');
  assert((await t.state()).progress.research.N01.behavior, 'Actual archive purchase did not apply');
  await t.action('restart');
  await t.action('confirm-restart');
  const retried = await t.checkpoint('retry-restores-original-entry');
  assert(retried.phase === 'DAY_PREP' && retried.day === 1 && retried.producedToday === 0 && retried.wallet === 50, 'Retry did not restore day entry');
  assert(!retried.progress.research.N01.behavior, 'Retry failed to undo this-day purchase');
  assert(retried.storage[game.save.key] === original, 'Retry overwrote the persisted entry');
  await t.action('archives');
  await t.button('[data-purchase="BEHAVIOR"]');
  await t.action('close');
  assert((await t.state()).wallet === 50 - game.economy.archiveBehaviorCost, 'Preparation purchase failed');
  await t.action('load');
  await t.action('confirm-load');
  const loaded = await t.checkpoint('explicit-load-restores-entry');
  assert(loaded.phase === 'DAY_PREP' && loaded.wallet === 50 && !loaded.progress.research.N01.behavior, 'Explicit load did not restore original entry');
  assert(loaded.storage[game.save.key] === original, 'Read changed the original save');
}

try {
  if (process.argv.includes('--network-only')) {
    await runCase('network-diagnostic', async t => {
      await t.start();
      await t.page.waitForTimeout(2000);
      await t.checkpoint('entry-network-diagnostic');
      await t.page.reload();
      await t.wait(() => window.__facilityTest?.controller.state.phase === 'DAY_PREP');
      await t.page.waitForTimeout(2000);
      await t.checkpoint('reload-network-diagnostic');
    });
  } else {
    await runCase('three-day-campaign', fullCampaign);
    if (!interrupted) await runCase('explicit-save-load-retry', entryRetry);
  }
  report.status = report.cases.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
} catch (error) {
  report.status = 'FAIL';
  report.reason = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await browser.close();
  report.ownedBrowserClosed = true;
  await writeFile(`${out}/suite.json`, JSON.stringify(report, null, 2));
  const latestName = process.argv.includes('--network-only') ? 'latest-campaign-network-run.json' : 'latest-campaign-run.json';
  await writeFile(`${evidenceRoot}/${latestName}`, JSON.stringify({ directory: out, report: `${out}/suite.json`, status: report.status }, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
