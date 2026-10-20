import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// All game changes use real mouse/keyboard input and elapsed wall time.
// The DEV bridge below is observational only: no commands, state assignments,
// clock stepping, direct camera changes, fabricated events or free resources.
const map = JSON.parse(await readFile('config/facility.json', 'utf8'));
const game = JSON.parse(await readFile('config/game.json', 'utf8'));
const anomalies = JSON.parse(await readFile('config/anomalies.json', 'utf8')).anomalies;
const skills = JSON.parse(await readFile('config/skills.json', 'utf8'));
const nodes = Object.fromEntries(map.nodes.map(node => [node.id, node]));
const anomalyById = Object.fromEntries(anomalies.map(anomaly => [anomaly.id, anomaly]));
const root = 'docs/large-facility-evidence-2026-10-20';
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const directory = resolve(root, runId);
const url = process.env.FACILITY_URL ?? 'http://127.0.0.1:5173/';
const requested = process.argv.find(argument => argument.startsWith('--cases='))?.slice(8).split(',')
  ?? ['camera', 'core', 'dog', 'skills'];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const employeeOf = (state, id) => state.employees.find(employee => employee.id === id);
const roomOf = (state, id) => state.rooms.find(room => room.anomalyId === id);
const mainOf = (state, id) => state.enemies.find(enemy => enemy.sourceAnomalyId === id && !enemy.isClone);
const node = id => ({ x: nodes[id].x, y: nodes[id].y });
const inside = (point, rect, inset = 0) => point.x >= rect.x + inset && point.x <= rect.x + rect.width - inset
  && point.y >= rect.y + inset && point.y <= rect.y + rect.height - inset;
const segmentDistance = (point, a, b) => {
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const fraction = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared)) : 0;
  return distance(point, { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
};
const onGraph = point => map.edges.some(edge => segmentDistance(point, nodes[edge.from], nodes[edge.to]) < 0.02);

// Camera motion legitimately changes projected feet/telegraphs while paused.
// Compare simulation positions and animation phases, never the full projection.
function frozenState(state) {
  return {
    time: state.time, produced: state.produced, wallet: state.wallet,
    employees: state.employees.map(employee => ({
      id: employee.id, location: employee.location, hp: employee.hp, sp: employee.sp,
      windup: employee.windupEndsAtSec, nextAttack: employee.nextAttackStartAtSec,
      safeStay: employee.safeStayElapsedSec, moveBuff: employee.moveBuffRemainingSec,
    })),
    enemies: state.enemies, rooms: state.rooms, cooldowns: state.cooldowns,
    actors: state.animation.actors.map(actor => ({
      id: actor.id, world: actor.world, stride: actor.stride, pose: actor.pose,
      facing: actor.facing, attackPhase: actor.attackPhase,
      attackProgress: actor.attackProgress, hurtRemaining: actor.hurtRemaining,
    })),
  };
}

await mkdir(directory, { recursive: true });
const suite = {
  startedAt: new Date().toISOString(), status: 'RUNNING', directory,
  method: 'Serial native Chrome recordings, real mouse/keyboard and wall time; read-only bridge observations.',
  mapId: map.id, cases: [], ownedBrowserClosed: false,
  boundaries: [
    'Expanded facility evidence is separate from the earlier single-floor and single-room recordings.',
    'Sandbox recordings are not evidence of a completed formal three-day campaign.',
    'N04 broadcast and S04 global speed remain cross-floor effects; S05 retains its configured Euclidean world radius.',
  ],
};
let browser;
let interrupted = false;
process.on('SIGINT', () => { interrupted = true; console.log('Finishing the active checkpoint and closing owned Chrome.'); });

async function runCase(name, test) {
  const out = resolve(directory, name);
  await mkdir(resolve(out, 'video'), { recursive: true });
  const report = {
    name, startedAt: new Date().toISOString(), status: 'RUNNING', checkpoints: [], samples: [],
    pageErrors: [], consoleErrors: [], httpErrors: [], requestFailures: [], navigations: [], measurements: {},
  };
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: resolve(out, 'video'), size: { width: 1600, height: 900 } },
  });
  const page = await context.newPage();
  const video = page.video();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) report.navigations.push({ time: new Date().toISOString(), url: frame.url() });
  });
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({ text: message.text(), location: message.location() });
  });
  page.on('response', response => {
    if (response.status() >= 400) report.httpErrors.push({ status: response.status(), url: response.url() });
  });
  page.on('requestfailed', request => report.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  let samplingTimer;
  let samplingPromise;
  const state = () => page.evaluate(() => {
    const { controller, scene } = window.__facilityTest;
    const state = controller.state;
    return {
      wallTimeMs: Date.now(), time: state.simulationTimeSec, timeScale: state.timeScale,
      mode: controller.mode, phase: state.phase, day: state.day,
      wallet: state.progress.wallet, produced: state.producedToday, progress: structuredClone(state.progress),
      selected: [...controller.selected], selectedRoomId: controller.selectedRoomId,
      selectedEnemyId: controller.selectedEnemyId, activeSkillId: controller.activeSkillId,
      employees: structuredClone(state.employees), enemies: structuredClone(state.enemies),
      rooms: structuredClone(state.rooms), cooldowns: structuredClone(state.skillCooldownRemainingSec),
      events: structuredClone(controller.events), logs: structuredClone(state.logs),
      animation: scene.getAnimationState(), camera: scene.getCameraState(),
      storage: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
    };
  });
  const wait = (predicate, argument, timeout = 45000) => page.waitForFunction(predicate, argument, { polling: 50, timeout });
  const sceneRead = (method, argument) => page.evaluate(({ method, argument }) => window.__facilityTest.scene[method](argument), { method, argument });
  const clientPoint = async canvasPoint => {
    assert(canvasPoint && Number.isFinite(canvasPoint.x) && Number.isFinite(canvasPoint.y), 'Invalid read-only projected point');
    const bounds = await page.locator('canvas').boundingBox();
    assert(bounds, 'Facility canvas is missing');
    return { x: bounds.x + canvasPoint.x * bounds.width / 1600, y: bounds.y + canvasPoint.y * bounds.height / 900 };
  };
  const clickCanvas = async (position, button = 'left') => {
    const p = await clientPoint(position);
    await page.mouse.click(p.x, p.y, { button });
  };
  const click = async (method, argument, button = 'left') => clickCanvas(await sceneRead(method, argument), button);
  const action = name => page.locator(`[data-action="${name}"]`).first().click();
  const pause = async paused => {
    if (((await state()).timeScale === 0) !== paused) await action('pause');
    await wait(value => (window.__facilityTest.controller.state.timeScale === 0) === value, paused);
  };
  const focus = async target => {
    await click('getMapNavigationPoint', target);
    // A real rendered frame must follow the native minimap click.
    await page.waitForTimeout(100);
  };
  const focusedClick = async (method, argument, focusTarget, button = 'left') => {
    await focus(focusTarget);
    const position = await sceneRead(method, argument);
    const camera = await sceneRead('getCameraState');
    assert(inside(position, camera.view), `${method} target remains outside the actual facility viewport after minimap navigation`);
    await clickCanvas(position, button);
  };
  const select = async ids => {
    for (let index = 0; index < ids.length; index++) {
      await focus(ids[index]);
      if (index > 0) await page.keyboard.down('Shift');
      try { await click('getEmployeeScreenPoint', ids[index]); }
      finally { if (index > 0) await page.keyboard.up('Shift'); }
    }
    await wait(expected => {
      const selected = [...window.__facilityTest.controller.selected].sort();
      return JSON.stringify(selected) === JSON.stringify([...expected].sort());
    }, ids);
  };
  const dragSelect = async ids => {
    const points = await Promise.all(ids.map(id => sceneRead('getEmployeeScreenPoint', id)));
    const camera = await sceneRead('getCameraState');
    assert(points.every(point => point && inside(point, camera.view, 8)), 'Drag selection fixture is outside the actual camera viewport');
    // Begin outside every body hit box; the lower-right margin stays small so
    // the gesture does not enter the fixed minimap next to the initial group.
    const from = await clientPoint({ x: Math.min(...points.map(point => point.x)) - 26, y: Math.min(...points.map(point => point.y)) - 42 });
    const to = await clientPoint({ x: Math.max(...points.map(point => point.x)) + 8, y: Math.max(...points.map(point => point.y)) + 8 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await page.mouse.up();
    await wait(expected => {
      const selected = [...window.__facilityTest.controller.selected].sort();
      return JSON.stringify(selected) === JSON.stringify([...expected].sort());
    }, ids);
    return { from, to, employeeIds: ids };
  };
  const move = async point => focusedClick('getCorridorScreenPoint', point, point, 'right');
  const work = async (roomId, employeeId, type = 'OBSERVE') => {
    await select([employeeId]);
    await focusedClick('getRoomClickPoint', roomId, roomId);
    await click('getWorkChoicePoint', type);
    const actual = roomOf(await state(), roomId).work;
    assert(actual?.employeeId === employeeId && actual.type === type, `Actual room command rejected: ${roomId}/${employeeId}/${type}`);
  };
  const breach = async roomId => {
    await focusedClick('getRoomClickPoint', roomId, roomId);
    await action('breach');
    await wait(id => window.__facilityTest.controller.state.rooms.find(room => room.anomalyId === id)?.mode === 'BREACHED', roomId);
    const actual = await state();
    assert(actual.enemies.filter(enemy => enemy.sourceAnomalyId === roomId).length === 1 + (anomalyById[roomId].breach.cloneCount ?? 0), `${roomId}: breach entity count differs from config`);
    return mainOf(actual, roomId).id;
  };
  const enemyClick = async (enemyId, button = 'left') => {
    const enemy = (await state()).enemies.find(item => item.id === enemyId);
    assert(enemy, `Enemy ${enemyId} disappeared before input`);
    await focusedClick('getEnemyScreenPoint', enemyId, { x: enemy.location.x, y: enemy.location.y }, button);
  };
  const checkpoint = async (label, note = '') => {
    assert(!interrupted, 'Stopped by operator');
    const current = await state();
    const screenshot = resolve(out, `${String(report.checkpoints.length + 1).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: screenshot });
    report.checkpoints.push({ label, note, screenshot, ...current });
    await writeFile(resolve(out, 'proof.json'), JSON.stringify(report, null, 2));
    console.log(`${name}: ${label} sim=${current.time.toFixed(2)} energy=${current.produced} zoom=${current.camera.zoom}`);
    return current;
  };
  const frozen = async (label, input, milliseconds = 650) => {
    const before = await state();
    assert(before.timeScale === 0, `${label}: expected paused simulation`);
    if (input) await input();
    await page.waitForTimeout(milliseconds);
    const after = await state();
    assert(JSON.stringify(frozenState(after)) === JSON.stringify(frozenState(before)), `${label}: paused world or animation changed`);
    return { before: before.camera, after: after.camera };
  };
  const start = async (mode = 'sandbox') => {
    await page.goto(`${url}${mode === 'campaign' ? '?mode=campaign' : ''}`);
    await wait(() => {
      const scene = window.__facilityTest?.scene;
      return scene && typeof scene.getCameraState === 'function' && typeof scene.getMapState === 'function'
        && typeof scene.getMapNavigationPoint === 'function'
        && scene.getAnimationState().actors.length === window.__facilityTest.controller.state.employees.length;
    }, undefined, 30000);
    const initial = await state();
    assert(initial.mode === mode, `Expected ${mode} entry mode`);
    report.storageBefore = initial.storage;
    report.map = await sceneRead('getMapState');
    report.cameraControls = await sceneRead('getCameraControls');
    samplingTimer = setInterval(() => {
      if (samplingPromise) return;
      samplingPromise = page.evaluate(() => {
        const state = window.__facilityTest.controller.state;
        return {
          wallTimeMs: Date.now(), time: state.simulationTimeSec, timeScale: state.timeScale,
          produced: state.producedToday, wallet: state.progress.wallet,
          employees: state.employees.map(employee => ({
            id: employee.id, location: { ...employee.location }, path: structuredClone(employee.path),
            order: structuredClone(employee.order), status: employee.status, hp: employee.hp, sp: employee.sp,
            windup: employee.windupEndsAtSec, moveBuff: employee.moveBuffRemainingSec,
          })),
          enemies: state.enemies.map(enemy => ({
            id: enemy.id, source: enemy.sourceAnomalyId, location: { ...enemy.location },
            hp: enemy.suppressionHp, windup: enemy.windupEndsAtSec,
          })),
          rooms: state.rooms.map(room => ({ id: room.anomalyId, mode: room.mode, work: structuredClone(room.work) })),
        };
      }).then(sample => report.samples.push(sample))
        .catch(error => report.pageErrors.push(`sampler: ${error.message}`))
        .finally(() => { samplingPromise = undefined; });
    }, 100);
    return initial;
  };
  const verifyTravel = (employeeId, fromTime, toTime, requireTransit = true) => {
    const samples = report.samples.filter(sample => sample.time >= fromTime && sample.time <= toTime);
    assert(samples.length >= 3, 'Insufficient actual travel samples');
    let changed = false;
    let transit = false;
    let sampledDistance = 0;
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      const employee = employeeOf(sample, employeeId);
      assert(onGraph(employee.location), `${employeeId}: actual position is outside the configured walkable graph`);
      if (employee.location.zone === 'TRANSIT') transit = true;
      if (!index) continue;
      const previous = samples[index - 1];
      const stepDistance = distance(employee.location, employeeOf(previous, employeeId).location);
      const stepTime = sample.time - previous.time;
      const speed = game.employee.moveSpeedPxPerSec * (employee.moveBuff > 0 ? 1.5 : 1);
      assert(stepDistance <= speed * stepTime + 0.05, `${employeeId}: position jumped farther than configured movement permits`);
      sampledDistance += stepDistance;
      if (stepDistance > 0.01) changed = true;
    }
    assert(changed, `${employeeId}: route evidence contains no actual movement`);
    if (requireTransit) assert(transit, `${employeeId}: route never visibly traversed a configured vertical connector`);
    return { employeeId, samples: samples.length, fromTime, toTime, sampledDistance, transit };
  };
  try {
    await test({ page, report, state, wait, sceneRead, clientPoint, clickCanvas, click, action, pause, focus,
      focusedClick, select, dragSelect, move, work, breach, enemyClick, checkpoint, frozen, start, verifyTravel });
    report.storageAfter = (await state()).storage;
    assert(JSON.stringify(report.storageAfter) === JSON.stringify(report.storageBefore), 'Read-only sandbox acceptance changed local storage');
    assert(!report.pageErrors.length && !report.consoleErrors.length, 'Actual browser JavaScript/console errors were recorded');
    assert(!report.httpErrors.length && !report.requestFailures.length, 'Actual HTTP or network request failures were recorded');
    assert(report.navigations.length === 1, 'The recording was interrupted by a page navigation or hot reload');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.reason = error instanceof Error ? error.stack : String(error);
    try { await checkpoint('failure-state', report.reason); } catch { /* Preserve original failure. */ }
    process.exitCode = 1;
  } finally {
    if (samplingTimer) clearInterval(samplingTimer);
    if (samplingPromise) await samplingPromise;
    report.finishedAt = new Date().toISOString();
    report.wallDurationSec = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;
    await context.close();
    report.video = await video?.path();
    await writeFile(resolve(out, 'proof.json'), JSON.stringify(report, null, 2));
    suite.cases.push({
      name, status: report.status, report: resolve(out, 'proof.json'), video: report.video,
      checkpoints: report.checkpoints.length, samples: report.samples.length,
      pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length,
      httpErrors: report.httpErrors.length, requestFailures: report.requestFailures.length,
      reason: report.reason,
    });
    await writeFile(resolve(directory, 'suite.json'), JSON.stringify(suite, null, 2));
    console.log(`${name}: ${report.status} ${report.reason ?? ''}`);
  }
}

const cases = {
  async camera(t) {
    await t.start();
    await t.pause(true);
    const initial = await t.checkpoint('default-expanded-facility-1600');
    assert(initial.employees.length === 6 && initial.rooms.every(room => room.mode === 'CONTAINED'), 'Expanded sandbox has incorrect rooms/staff');
    assert(initial.produced === 0 && initial.wallet === game.economy.initialWallet, 'Expanded sandbox silently granted income');
    t.report.measurements.dragSelection = await t.dragSelect(initial.employees.map(employee => employee.id));
    const dragged = await t.checkpoint('six-employees-native-drag-selection');
    assert(dragged.selected.length === 6, 'Actual camera-space drag did not select the six real employees');
    await t.select(['E01']);
    const commandCount = (await t.state()).events.filter(event => event.type === 'COMMAND').length;
    await t.frozen('overview control preserves paused world', () => t.clickCanvas(t.report.cameraControls.overview));
    const overview = await t.checkpoint('whole-map-overview');
    assert(overview.camera.zoom <= initial.camera.zoom, 'Home did not produce a wider overview');
    await t.frozen('minimap preserves paused world', () => t.focus('N05'));
    await t.checkpoint('minimap-focus-lower-room');
    const view = (await t.state()).camera.view;
    const center = await t.clientPoint({ x: view.x + view.width * 0.47, y: view.y + view.height * 0.55 });
    const zoom = await t.frozen('native wheel zoom', async () => {
      await t.page.mouse.move(center.x, center.y);
      await t.page.mouse.wheel(0, -500);
    });
    assert(zoom.after.zoom > zoom.before.zoom, 'Wheel input did not zoom the actual camera');
    await t.checkpoint('native-wheel-near-view');
    const pan = await t.frozen('middle-button camera drag', async () => {
      await t.page.mouse.move(center.x, center.y);
      await t.page.mouse.down({ button: 'middle' });
      await t.page.mouse.move(center.x + 120, center.y - 65, { steps: 12 });
      await t.page.mouse.up({ button: 'middle' });
    });
    assert(JSON.stringify(pan.after.worldView) !== JSON.stringify(pan.before.worldView), 'Middle drag did not change camera view');
    await t.frozen('Alt-left camera drag', async () => {
      await t.page.keyboard.down('Alt');
      try {
        await t.page.mouse.move(center.x, center.y);
        await t.page.mouse.down();
        await t.page.mouse.move(center.x - 85, center.y + 40, { steps: 12 });
        await t.page.mouse.up();
      } finally { await t.page.keyboard.up('Alt'); }
    });
    await t.select(['E01']);
    await t.clickCanvas(t.report.cameraControls.rooms.N01);
    await t.frozen('F focuses selection while paused', () => t.page.keyboard.press('KeyF'));
    const focused = await t.checkpoint('selected-employee-focus');
    const employeePoint = await t.sceneRead('getEmployeeScreenPoint', 'E01');
    assert(inside(employeePoint, focused.camera.view), 'F did not bring the selected actual employee into view');
    assert(focused.events.filter(event => event.type === 'COMMAND').length === commandCount, 'Camera operation issued a gameplay command');
    await t.page.setViewportSize({ width: 1280, height: 720 });
    if (await t.page.locator('[data-action="toggle-details"]').count()) await t.action('toggle-details');
    await t.select(['E01']);
    await t.move(node('hub-center'));
    await t.frozen('1280 camera-transformed command while paused');
    const queued = await t.checkpoint('1280-direct-command');
    assert(employeeOf(queued, 'E01').order.kind === 'MOVE', '1280 transformed input failed to issue MOVE');
    t.report.measurements.viewport = await t.page.evaluate(() => ({
      width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
    }));
    assert(t.report.measurements.viewport.scrollWidth <= 1280 && t.report.measurements.viewport.scrollHeight <= 720, '1280 viewport requires page scrolling');
    await t.pause(false);
    await t.page.waitForTimeout(800);
    await t.pause(true);
    assert(distance(employeeOf(await t.state(), 'E01').location, employeeOf(queued, 'E01').location) > 1, '1280 queued command did not move the real employee after unpause');
    await t.checkpoint('1280-movement-visible');
  },

  async core(t) {
    const initial = await t.start();
    await t.checkpoint('continuous-start');
    await t.wait(() => window.__facilityTest.controller.state.employees.some(employee => employee.location.zone !== 'SAFE'), undefined, 20000);
    await t.pause(true);
    const ambient = await t.checkpoint('real-idle-walk');
    assert(ambient.produced === 0 && ambient.wallet === initial.wallet, 'Idle roaming performed unrequested work');
    const roaming = ambient.employees.find(employee => employee.location.zone !== 'SAFE');
    assert(roaming && distance(roaming.location, employeeOf(initial, roaming.id).location) > 1, 'No actual idle walking occurred');
    await t.select([roaming.id]);
    await t.page.keyboard.press('KeyS');
    const held = await t.checkpoint('stop-idle-walk');
    assert(['HOLD', 'IDLE'].includes(employeeOf(held, roaming.id).order.kind), 'STOP did not replace the autonomous route');
    await t.pause(false);
    await t.page.waitForTimeout((map.ambient.waitMaxSec + 1) * 1000);
    await t.pause(true);
    assert(distance(employeeOf(await t.state(), roaming.id).location, employeeOf(held, roaming.id).location) < 0.001, 'Stopped employee resumed autonomous walking');
    await t.work('N01', roaming.id);
    const ordered = await t.checkpoint('idle-worker-takes-player-work');
    await t.pause(false);
    await t.wait(id => window.__facilityTest.controller.state.employees.find(employee => employee.id === id)?.location.zone === 'TRANSIT', roaming.id, 25000);
    await t.pause(true);
    const transit = await t.checkpoint('cross-floor-mid-route');
    await t.page.waitForTimeout(150);
    t.report.measurements.firstRoute = t.verifyTravel(roaming.id, ordered.time, transit.time);
    await t.work('N05', roaming.id);
    assert(roomOf(await t.state(), 'N01').work === null, 'Redirected cross-floor assignment left the first room reserved');
    await t.frozen('paused cross-floor work redirection');
    await t.checkpoint('paused-lower-room-reassignment');
    await t.select([roaming.id]);
    await t.action('retreat');
    assert(roomOf(await t.state(), 'N05').work === null, 'Retreat left the lower work reservation alive');
    await t.frozen('paused retreat redirection');
    await t.pause(false);
    await t.wait(id => window.__facilityTest.controller.state.employees.find(employee => employee.id === id)?.location.zone === 'SAFE', roaming.id, 35000);
    await t.pause(true);
    const cancelled = await t.checkpoint('actual-safe-arrival-no-work-income');
    assert(cancelled.produced === 0, 'Cancelled pre-arrival jobs produced energy');
    const allIds = initial.employees.map(employee => employee.id);
    await t.select(allIds);
    await t.page.keyboard.press('KeyS');
    for (let index = 0; index < anomalies.length; index++) await t.work(anomalies[index].id, `E0${index + 1}`);
    const workOrders = await t.checkpoint('five-distant-room-orders');
    await t.action('speed2');
    await t.pause(false);
    // Each worker must actually reach its configured indoor work point.
    for (const anomaly of anomalies) {
      await t.wait(id => {
        const state = window.__facilityTest.controller.state;
        const room = state.rooms.find(room => room.anomalyId === id);
        return room.work?.phase === 'EXECUTING' || state.logs.some(log => log.kind === 'INCOME' && log.message.includes(id));
      }, anomaly.id, 50000);
    }
    await t.wait(() => window.__facilityTest.controller.state.rooms.every(room => room.work === null), undefined, 50000);
    await t.pause(true);
    const income = await t.checkpoint('five-room-real-production');
    const expectedIncome = anomalies.reduce((sum, anomaly) => sum + anomaly.workProfiles.find(profile => profile.type === 'OBSERVE').energy, 0);
    assert(income.produced === expectedIncome, 'Expanded-room jobs did not produce the original configured total');
    assert(income.wallet - initial.wallet === income.produced, 'Walking/ambient activity changed the energy economy');
    for (const anomaly of anomalies) {
      const executing = t.report.samples.find(sample => sample.rooms.some(room => room.id === anomaly.id && room.work?.phase === 'EXECUTING'));
      assert(executing, `${anomaly.id}: no sampled indoor execution phase`);
      const assigned = executing.rooms.find(room => room.id === anomaly.id).work;
      const worker = employeeOf(executing, assigned.employeeId);
      assert(worker.location.zone === 'ROOM' && distance(worker.location, nodes[map.rooms[anomaly.id].workNodeId]) < 0.02,
        `${anomaly.id}: work timer advanced before real arrival at the indoor station`);
    }
    t.report.measurements.fiveRoomIncome = income.produced;
    t.report.measurements.lowerRoute = t.verifyTravel('E05', workOrders.time, income.time);
    // Keep the configured neglect mechanic healthy through another real job.
    await t.work('N05', 'E05', 'SOOTHE');
    await t.work('N02', 'E02');
    const fighters = ['E01', 'E03', 'E04', 'E06'];
    await t.select(fighters);
    await t.move(node('hub-center'));
    await t.pause(false);
    await t.wait(ids => window.__facilityTest.controller.state.employees.filter(employee => ids.includes(employee.id)).every(employee => employee.order.kind === 'IDLE'), fighters, 45000);
    await t.pause(true);
    await t.select(fighters);
    await t.page.keyboard.press('KeyS');
    const enemyId = await t.breach('N01');
    const breached = await t.checkpoint('nailong-breaches-upper-floor');
    for (const enemy of breached.enemies.filter(enemy => enemy.sourceAnomalyId === 'N01')) {
      await t.enemyClick(enemy.id);
      assert((await t.state()).selectedEnemyId === enemy.id, `Breach entity ${enemy.id} is not directly selectable after camera navigation`);
    }
    await t.select(fighters);
    await t.enemyClick(enemyId, 'right');
    const pursuit = await t.checkpoint('cross-floor-suppression-order');
    assert(pursuit.employees.filter(employee => fighters.includes(employee.id)).every(employee => Math.abs(employee.location.y - mainOf(pursuit, 'N01').location.y) > 100), 'Suppression did not start on a different floor');
    await t.frozen('paused cross-floor suppression');
    await t.pause(false);
    await t.page.waitForTimeout(550);
    const distant = await t.checkpoint('different-floor-no-remote-hit');
    assert(mainOf(distant, 'N01').suppressionHp === mainOf(pursuit, 'N01').suppressionHp, 'Staff damaged an enemy before crossing to its floor');
    await t.wait(id => {
      const enemy = window.__facilityTest.controller.state.enemies.find(enemy => enemy.id === id);
      return enemy && enemy.suppressionHp < enemy.suppressionHpMax;
    }, enemyId, 35000);
    await t.pause(true);
    await t.enemyClick(enemyId);
    const contact = await t.checkpoint('actual-same-floor-contact');
    assert(contact.employees.some(employee => fighters.includes(employee.id) && Math.abs(employee.location.y - mainOf(contact, 'N01').location.y) < 0.01), 'Attack happened without any fighter reaching the enemy floor');
    await t.select(fighters);
    await t.action('retreat');
    const retreat = await t.checkpoint('paused-cross-floor-combat-retreat');
    assert(retreat.employees.filter(employee => fighters.includes(employee.id)).every(employee => employee.order.kind === 'RETREAT' && employee.windupEndsAtSec === null), 'Retreat retained an employee attack');
    await t.frozen('paused combat retreat');
    const enemyHp = mainOf(retreat, 'N01').suppressionHp;
    await t.pause(false);
    await t.focus(map.safePoint);
    await t.wait(ids => window.__facilityTest.controller.state.employees.filter(employee => ids.includes(employee.id)).every(employee => employee.location.zone === 'SAFE'), fighters, 35000);
    await t.pause(true);
    const safe = await t.checkpoint('real-cross-floor-safe-arrival');
    assert(mainOf(safe, 'N01').suppressionHp === enemyHp, 'Retreating employees continued to damage the enemy');
    assert(safe.logs.some(log => log.kind === 'INCOME' && log.message.includes('N02') && log.timeSec > breached.time), 'Other-room production did not complete during the actual N01 breach');
    await t.pause(false);
    await t.wait(ids => window.__facilityTest.controller.state.employees.filter(employee => ids.includes(employee.id)).every(employee => employee.hp === employee.hpMax && employee.sp === employee.spMax), fighters, 20000);
    await t.pause(true);
    await t.checkpoint('safe-recovery-complete');
    t.report.measurements.crossFloorRetreat = t.verifyTravel('E01', retreat.time, safe.time);
    await t.select(fighters);
    await t.enemyClick(enemyId, 'right');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.rooms.find(room => room.anomalyId === 'N01').mode === 'RECOVERING', undefined, 50000);
    await t.pause(true);
    const recaptured = await t.checkpoint('real-recapture-clears-clones');
    assert(!recaptured.enemies.some(enemy => enemy.sourceAnomalyId === 'N01'), 'Main recapture left a clone alive');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.rooms.find(room => room.anomalyId === 'N01').mode === 'CONTAINED', undefined, 15000);
    await t.pause(true);
    await t.page.keyboard.press('Home');
    await t.checkpoint('continuous-expanded-facility-complete');
  },

  async dog(t) {
    const initial = await t.start();
    await t.pause(true);
    const allIds = initial.employees.map(employee => employee.id);
    await t.select(allIds);
    await t.page.keyboard.press('KeyS');
    await t.select(['E01']);
    await t.move({ x: 1175, y: nodes['n03-entry'].y });
    await t.action('speed2');
    await t.pause(false);
    await t.wait(() => {
      const employee = window.__facilityTest.controller.state.employees.find(employee => employee.id === 'E01');
      return employee.order.kind === 'IDLE' && Math.hypot(employee.location.x - 1175, employee.location.y - 1360) < 30;
    }, undefined, 25000);
    await t.pause(true);
    await t.action('speed1');
    const enemyId = await t.breach('N03');
    await t.pause(false);
    await t.wait(id => window.__facilityTest.controller.state.enemies.find(enemy => enemy.id === id)?.windupEndsAtSec != null, enemyId, 10000);
    await t.pause(true);
    const warning = await t.checkpoint('dog-real-world-warning');
    const warningActor = warning.animation.actors.find(actor => actor.id === enemyId);
    assert(warningActor?.telegraph, 'No actual world-space dog warning geometry');
    assert(distance(employeeOf(warning, 'E01').location, mainOf(warning, 'N03').location) <= anomalyById.N03.breach.attackRangePx, 'Dodge did not start inside the real danger range');
    await t.frozen('dog telegraph frozen while panning', () => t.focus(node('a-mid')));
    await t.select(['E01']);
    const destination = { x: Math.min(2450, mainOf(warning, 'N03').location.x + 350), y: nodes['a-mid'].y };
    await t.move(destination);
    await t.pause(false);
    await t.wait(endTime => window.__facilityTest.controller.state.simulationTimeSec >= endTime, mainOf(warning, 'N03').windupEndsAtSec + 0.05, 8000);
    await t.pause(true);
    const escaped = await t.checkpoint('dog-warning-escaped-on-same-floor');
    assert(employeeOf(escaped, 'E01').hp === employeeOf(warning, 'E01').hp, 'Employee took the dog hit after leaving its radius');
    t.report.measurements.dodge = { before: employeeOf(warning, 'E01'), after: employeeOf(escaped, 'E01'), warning: warningActor.telegraph };
    await t.select(['E01']);
    await t.page.keyboard.press('KeyS');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees.find(employee => employee.id === 'E01').hp < 100, undefined, 15000);
    await t.pause(true);
    await t.checkpoint('later-real-dog-hit-and-knockback');
    await t.select(['E01']);
    await t.action('retreat');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees.find(employee => employee.id === 'E01').location.zone === 'SAFE', undefined, 25000);
    await t.pause(true);
    await t.focus(map.safePoint);
    await t.checkpoint('dog-retreat-safe');
  },

  async skills(t) {
    const initial = await t.start();
    await t.pause(true);
    await t.select(initial.employees.map(employee => employee.id));
    await t.page.keyboard.press('KeyS');
    await t.work('N03', 'E01');
    await t.action('speed2');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.producedToday > 0, undefined, 45000);
    await t.pause(true);
    const earned = await t.checkpoint('normal-work-funds-s03');
    await t.action('archives');
    await t.page.locator('[data-archive-room="N03"]').click();
    for (const item of ['BEHAVIOR', 'SKILL']) await t.page.locator(`[data-purchase="${item}"][data-room="N03"]`).click();
    await t.action('close');
    const purchased = await t.state();
    assert(purchased.wallet === earned.wallet - game.economy.archiveBehaviorCost - game.economy.skillUnlockCost, 'Original-price skill purchase charged the wrong amount');
    assert(purchased.progress.unlockedSkills.includes('S03'), 'S03 was not actually purchased');
    await t.select(['E01']);
    await t.action('retreat');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees.find(employee => employee.id === 'E01').location.zone === 'SAFE', undefined, 25000);
    await t.pause(true);
    const enemyId = await t.breach('N03');
    const before = await t.checkpoint('s03-main-on-operations-floor');
    // The same world X on another floor must not select or hit N03.
    // In this map floor spacing also exceeds radius; unit tests independently
    // cover the same-segment filter instead of overstating this browser proof.
    const wrongFloorPoint = node('c-bottom');
    await t.focus(wrongFloorPoint);
    await t.page.locator('[data-skill="S03"]').click();
    await t.click('getCorridorScreenPoint', wrongFloorPoint);
    const wrongFloor = await t.checkpoint('s03-wrong-floor-does-not-hit');
    assert(mainOf(wrongFloor, 'N03').suppressionHp === mainOf(before, 'N03').suppressionHp, 'S03 damaged an enemy on another floor');
    assert(wrongFloor.wallet === before.wallet, 'Invalid empty-floor cast consumed energy');
    await t.page.keyboard.press('Escape');
    const center = { x: mainOf(before, 'N03').location.x, y: mainOf(before, 'N03').location.y };
    await t.focus(center);
    await t.page.locator('[data-skill="S03"]').click();
    await t.click('getCorridorScreenPoint', center);
    const after = await t.checkpoint('s03-real-damage-and-local-knockback');
    const skill = skills.find(skill => skill.id === 'S03');
    assert(mainOf(after, 'N03').suppressionHp < mainOf(before, 'N03').suppressionHp, 'Valid S03 world target caused no real damage');
    assert(mainOf(after, 'N03').location.y === mainOf(before, 'N03').location.y, 'S03 knockback changed enemy floor');
    assert(onGraph(mainOf(after, 'N03').location), 'S03 knocked the enemy outside the configured graph');
    assert(after.wallet === before.wallet - skill.energyCost && after.produced === before.produced, 'Skill did not charge exactly its wallet cost');
    assert(distance(mainOf(after, 'N03').location, mainOf(before, 'N03').location) > 0, 'Actual knockback did not move the entity');
    await t.frozen('paused actual skill effect');
    t.report.measurements.skill = {
      originalWallet: initial.wallet, earned: earned.produced,
      before: mainOf(before, 'N03'), after: mainOf(after, 'N03'),
      camera: after.camera, walletBefore: before.wallet, walletAfter: after.wallet,
      enemyId, note: 'Browser verifies the configured map; adversarial close-but-disconnected graph cases belong to navigation unit tests.',
    };
  },
};

try {
  for (const name of requested) assert(typeof cases[name] === 'function', `Unknown proof case: ${name}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  console.log(`Expanded-facility proof: owned Chrome started; evidence ${directory}`);
  for (const name of requested) {
    if (interrupted) break;
    await runCase(name, cases[name]);
    // Leave the first real failure intact; do not keep driving dependent cases.
    if (suite.cases.at(-1).status !== 'PASS') break;
  }
} catch (error) {
  suite.fatal = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  suite.ownedBrowserClosed = true;
  suite.finishedAt = new Date().toISOString();
  suite.status = !suite.fatal && suite.cases.length === requested.length && suite.cases.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL';
  await writeFile(resolve(directory, 'suite.json'), JSON.stringify(suite, null, 2));
  await writeFile(resolve(root, 'latest-run.json'), JSON.stringify({ directory, suite: resolve(directory, 'suite.json'), status: suite.status }, null, 2));
  console.log(JSON.stringify(suite, null, 2));
}
