import { chromium } from '@playwright/test';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Browser evidence uses real mouse/keyboard input and elapsed wall time only.
// The DEV bridge is read-only: never assign state, call commands, step the clock,
// directly trigger breaches, grant money, heal units or fabricate animation events.
const gameConfig = JSON.parse(await readFile('config/game.json', 'utf8'));
const anomalyConfig = JSON.parse(await readFile('config/anomalies.json', 'utf8')).anomalies;
const skillConfig = JSON.parse(await readFile('config/skills.json', 'utf8'));
const anomalyById = Object.fromEntries(anomalyConfig.map(anomaly => [anomaly.id, anomaly]));
const root = 'docs/facility-evidence-2026-10-20';
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const out = `${root}/${runId}`;
await mkdir(out, { recursive: true });
const requested = process.argv.find(argument => argument.startsWith('--cases='))?.slice(8).split(',')
  ?? ['core', 'skills-equipment', 'campaign', 'dog', 'cat', 'broadcast', 'gugu'];
const baseUrl = process.env.FACILITY_URL ?? 'http://127.0.0.1:5173/';
// Create this marker to finish active recordings and leave later cases unstarted.
// It is deliberately outside the game and never changes any browser/simulation state.
const stopMarker = `${root}/stop-after-case`;
const stopRequested = async () => { try { await access(stopMarker); return true; } catch { return false; } };
const assert = (value, message) => { if (!value) throw new Error(message); };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const roomOf = (snapshot, id) => snapshot.rooms.find(room => room.anomalyId === id);
const employeeOf = (snapshot, id) => snapshot.employees.find(employee => employee.id === id);
const mainOf = (snapshot, id) => snapshot.enemies.find(enemy => enemy.sourceAnomalyId === id && !enemy.isClone);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const suite = {
  startedAt: new Date().toISOString(), status: 'RUNNING', directory: resolve(out), cases: [],
  method: 'Native Chrome renderer, real wall time, real Playwright mouse/keyboard; read-only DEV bridge observations.',
  scope: 'Five-room facility sandbox and separately checked formal campaign boundaries. A sandbox is not a completed three-day campaign.',
};

async function runCase(name, test) {
  const directory = `${out}/${name}`;
  await mkdir(`${directory}/video`, { recursive: true });
  const report = { name, startedAt: new Date().toISOString(), status: 'RUNNING', checkpoints: [], samples: [], errors: [] };
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: `${directory}/video`, size: { width: 1600, height: 900 } } });
  const page = await context.newPage();
  let samplingTimer;
  let samplingPromise;
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  const state = () => page.evaluate(() => {
    const { controller, scene } = window.__facilityTest;
    const state = controller.state;
    return {
      realTimeMs: Date.now(), simulationTimeSec: state.simulationTimeSec, timeScale: state.timeScale,
      mode: controller.mode, phase: state.phase, day: state.day,
      producedToday: state.producedToday, wallet: state.progress.wallet,
      progress: structuredClone(state.progress), tutorialPending: state.tutorialPending,
      selected: [...controller.selected], selectedRoomId: controller.selectedRoomId, selectedEnemyId: controller.selectedEnemyId,
      employees: structuredClone(state.employees), rooms: structuredClone(state.rooms), enemies: structuredClone(state.enemies),
      animation: scene.getAnimationState(), events: structuredClone(controller.events), logs: structuredClone(state.logs),
      skillCooldowns: structuredClone(state.skillCooldownRemainingSec),
      processedLinkEventIds: [...state.processedLinkEventIds],
      localStorage: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
    };
  });
  const wait = (predicate, arg, timeout = 20000) => page.waitForFunction(predicate, arg, { polling: 25, timeout });
  const point = async (method, arg) => {
    const world = await page.evaluate(({ method, arg }) => {
      const scene = window.__facilityTest.scene;
      return typeof scene[method] === 'function' ? scene[method](arg) : scene[method];
    }, { method, arg });
    assert(world && Number.isFinite(world.x) && Number.isFinite(world.y), `Missing coordinate ${method}(${arg})`);
    const bounds = await page.locator('canvas').boundingBox();
    assert(bounds, 'Missing facility canvas');
    return { x: bounds.x + world.x * bounds.width / 1600, y: bounds.y + world.y * bounds.height / 900 };
  };
  const click = async (method, arg, button = 'left') => {
    const p = await point(method, arg);
    await page.mouse.click(p.x, p.y, { button });
  };
  const action = name => page.locator(`[data-action="${name}"]`).first().click();
  const pause = async value => {
    if (((await state()).timeScale === 0) !== value) await action('pause');
    await wait(expected => (window.__facilityTest.controller.state.timeScale === 0) === expected, value);
  };
  const select = async ids => {
    for (let index = 0; index < ids.length; index++) {
      if (index === 1) await page.keyboard.down('Shift');
      await click('getEmployeeScreenPoint', ids[index]);
    }
    if (ids.length > 1) await page.keyboard.up('Shift');
    await wait(expected => {
      const selected = [...window.__facilityTest.controller.selected].sort();
      return JSON.stringify(selected) === JSON.stringify([...expected].sort());
    }, ids);
  };
  const drag = async ids => {
    const points = await Promise.all(ids.map(id => point('getEmployeeScreenPoint', id)));
    await page.mouse.move(Math.min(...points.map(p => p.x)) - 22, Math.min(...points.map(p => p.y)) - 30);
    await page.mouse.down();
    await page.mouse.move(Math.max(...points.map(p => p.x)) + 22, Math.max(...points.map(p => p.y)) + 35, { steps: 12 });
    await page.mouse.up();
    await wait(expected => expected.every(id => window.__facilityTest.controller.selected.has(id)), ids);
  };
  const move = x => click('getCorridorScreenPoint', x, 'right');
  const work = async (roomId, employeeId, type = 'OBSERVE') => {
    await select([employeeId]);
    await click('getRoomClickPoint', roomId);
    await click('getWorkChoicePoint', type);
    const current = roomOf(await state(), roomId).work;
    assert(current?.employeeId === employeeId && current.type === type, `${roomId}/${employeeId}/${type}: work command was not accepted`);
    return current;
  };
  const breach = async roomId => {
    await click('getRoomClickPoint', roomId);
    await action('breach');
    await wait(id => window.__facilityTest.controller.state.rooms.find(room => room.anomalyId === id)?.mode === 'BREACHED', roomId);
    const current = await state();
    const expected = 1 + (anomalyById[roomId].breach.cloneCount ?? 0);
    assert(current.enemies.filter(enemy => enemy.sourceAnomalyId === roomId).length === expected, `${roomId}: incorrect actual breach entity count`);
    return mainOf(current, roomId).id;
  };
  const snapshot = async (label, note = '') => {
    const sequence = String(report.checkpoints.length + 1).padStart(2, '0');
    const screenshot = `${directory}/${sequence}-${label}.png`;
    await page.screenshot({ path: screenshot });
    const current = await state();
    report.checkpoints.push({ label, note, screenshot: resolve(screenshot), ...current });
    console.log(`${name}: ${sequence} ${label} t=${current.simulationTimeSec.toFixed(2)} energy=${current.producedToday} enemies=${current.enemies.length}`);
    return current;
  };
  const frozen = async (label, duration = 650) => {
    const before = await state();
    await page.waitForTimeout(duration);
    const after = await state();
    assert(after.simulationTimeSec === before.simulationTimeSec, `${label}: simulation advanced while paused`);
    assert(JSON.stringify(after.animation) === JSON.stringify(before.animation), `${label}: rendered actor/work/danger animation advanced while paused`);
    assert(JSON.stringify(after.employees.map(employee => employee.location)) === JSON.stringify(before.employees.map(employee => employee.location)), `${label}: paused employee position changed`);
  };
  const start = async (mode = 'sandbox') => {
    await page.goto(`${baseUrl}${mode === 'campaign' ? '?mode=campaign' : ''}`);
    await wait(() => window.__facilityTest?.scene?.getAnimationState, undefined, 30000);
    await wait(() => {
      const { controller, scene } = window.__facilityTest;
      const actors = scene.getAnimationState().actors;
      return controller.state.employees.every(employee => actors.some(actor => actor.id === employee.id));
    });
    if (mode === 'sandbox' && (await state()).mode !== 'sandbox') {
      await action('mode-sandbox');
      if (await page.locator('[data-action="confirm-mode"]').count()) await action('confirm-mode');
      await wait(() => window.__facilityTest.controller.mode === 'sandbox');
    }
    report.storageBefore = (await state()).localStorage;
    samplingTimer = setInterval(() => {
      if (samplingPromise) return;
      samplingPromise = page.evaluate(() => {
        const state = window.__facilityTest.controller.state;
        return {
          realTimeMs: Date.now(), time: state.simulationTimeSec, timeScale: state.timeScale, phase: state.phase, produced: state.producedToday, wallet: state.progress.wallet,
          rooms: state.rooms.map(room => ({ id: room.anomalyId, mode: room.mode, pressure: room.pressure, work: structuredClone(room.work) })),
          employees: state.employees.map(employee => ({ id: employee.id, location: { ...employee.location }, status: employee.status, order: { ...employee.order }, hp: employee.hp, sp: employee.sp, windup: employee.windupEndsAtSec })),
          enemies: state.enemies.map(enemy => ({ id: enemy.id, source: enemy.sourceAnomalyId, clone: enemy.isClone, location: { ...enemy.location }, hp: enemy.suppressionHp, windup: enemy.windupEndsAtSec, stunnedUntil: enemy.stunnedUntilSec })),
        };
      }).then(sample => report.samples.push(sample)).catch(error => report.errors.push(`sampler: ${error.message}`)).finally(() => { samplingPromise = undefined; });
    }, 100);
  };
  try {
    await test({ page, report, state, wait, click, action, pause, select, drag, move, work, breach, snapshot, frozen, start });
    assert(report.errors.length === 0, `Browser errors: ${report.errors.join('; ')}`);
    report.storageAfter = (await state()).localStorage;
    if (name !== 'campaign') assert(JSON.stringify(report.storageAfter) === JSON.stringify(report.storageBefore), 'Sandbox changed local storage');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.reason = error instanceof Error ? error.stack : String(error);
    try { await snapshot('failure-state', report.reason); } catch { /* retain original failure */ }
    process.exitCode = 1;
  } finally {
    if (samplingTimer) clearInterval(samplingTimer);
    if (samplingPromise) await samplingPromise;
    report.finishedAt = new Date().toISOString();
    await context.close();
    report.video = await page.video()?.path();
    await writeFile(`${directory}/proof.json`, JSON.stringify(report, null, 2));
    suite.cases.push({ name, status: report.status, report: resolve(`${directory}/proof.json`), video: report.video, checkpoints: report.checkpoints.length, samples: report.samples.length, reason: report.reason });
    console.log(`${name}: ${report.status} ${report.reason ?? ''}`);
  }
}

const cases = {
  async core(t) {
    await t.start();
    const initial = await t.snapshot('all-five-normal-1600', 'One continuous facility, six real employees and all five contained anomalies.');
    t.report.facilityCoverage = await t.page.evaluate(() => {
      const view = window.__facilityTest.scene.constructor.geometry.view;
      return { view, ratio: view.width * view.height / (1600 * 900) };
    });
    assert(t.report.facilityCoverage.ratio >= 0.65, 'Main facility viewport occupies less than 65 percent of the canvas');
    assert(initial.employees.length === 6 && initial.rooms.every(room => room.mode === 'CONTAINED'), 'Sandbox does not expose all five rooms and six employees');
    assert(initial.wallet === gameConfig.economy.initialWallet && initial.producedToday === 0, 'Sandbox silently granted extra starting money');
    await t.pause(true);
    await t.select(['E01', 'E02']);
    await t.snapshot('direct-and-shift-selection');
    const allIds = initial.employees.map(employee => employee.id);
    await t.drag(allIds);
    await t.move(550);
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees.every(employee => employee.location.zone === 'CORRIDOR' && employee.location.x < 1100));
    await t.pause(true);
    const midway = await t.snapshot('walking-before-redirect');
    await t.move(1130);
    await t.frozen('paused move redirection');
    await t.pause(false);
    await t.page.waitForTimeout(450);
    const redirected = await t.snapshot('midwalk-redirect');
    assert(redirected.employees.every(employee => employee.location.x > employeeOf(midway, employee.id).location.x), 'Walking redirection did not reverse each selected employee');
    await t.pause(true);
    await t.work('N01', 'E01');
    await t.frozen('paused travelling work');
    await t.pause(false);
    await t.page.waitForTimeout(900);
    await t.pause(true);
    await t.click('safeClickPoint', undefined, 'right');
    const cancelled = await t.snapshot('paused-work-to-retreat');
    assert(roomOf(cancelled, 'N01').work === null && cancelled.producedToday === 0, 'Cancelled journey paid income or kept its room reservation');
    await t.frozen('paused retreat');

    for (let index = 0; index < anomalyConfig.length; index++) await t.work(anomalyConfig[index].id, `E0${index + 1}`);
    const travelling = await t.snapshot('five-real-work-reservations');
    assert(travelling.rooms.every(room => room.work?.phase === 'TRAVELLING' && room.work.elapsedSec === 0), 'Remote work began before physical arrival');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.rooms.every(room => room.work?.phase === 'EXECUTING'));
    await t.pause(true);
    const working = await t.snapshot('all-five-working-inside');
    assert(working.rooms.every(room => employeeOf(working, room.work.employeeId).location.roomId === room.anomalyId), 'A worker is not inside the corresponding actual room');
    await t.frozen('five simultaneous room work animations');
    await t.pause(false);
    const expectedEnergy = anomalyConfig.reduce((sum, anomaly) => sum + anomaly.workProfiles.find(profile => profile.type === 'OBSERVE').energy, 0);
    await t.wait(expected => window.__facilityTest.controller.state.producedToday === expected, expectedEnergy, 35000);
    const paid = await t.snapshot('all-five-work-income');
    assert(paid.wallet === initial.wallet + expectedEnergy, 'Five room income does not match configuration');
    t.report.fiveRoomWork = { type: 'OBSERVE', totalEnergy: expectedEnergy, rooms: anomalyConfig.map(anomaly => ({ id: anomaly.id, durationSec: anomaly.workProfiles[0].durationSec, energy: anomaly.workProfiles[0].energy })) };
    await t.wait(() => window.__facilityTest.controller.state.employees.every(employee => employee.status === 'IDLE'));

    await t.pause(true);
    const fighters = ['E01', 'E03', 'E04', 'E06'];
    await t.select(fighters);
    await t.move(500);
    await t.work('N02', 'E02');
    await t.work('N05', 'E05');
    await t.pause(false);
    await t.wait(ids => window.__facilityTest.controller.state.employees.filter(employee => ids.includes(employee.id)).every(employee => employee.status === 'IDLE'), fighters);
    await t.pause(true);
    const mainId = await t.breach('N01');
    const breached = await t.snapshot('nailong-main-and-two-clones');
    for (const enemy of breached.enemies.filter(enemy => enemy.sourceAnomalyId === 'N01')) {
      await t.click('getEnemyScreenPoint', enemy.id);
      assert((await t.state()).selectedEnemyId === enemy.id, `N01 entity ${enemy.id} cannot be independently selected`);
    }
    assert(roomOf(breached, 'N02').work?.phase === 'EXECUTING', 'Other-room work was lost when N01 breached');
    await t.select(fighters);
    await t.click('getEnemyScreenPoint', mainId, 'right');
    const ordered = await t.snapshot('suppression-from-outside-range');
    assert(ordered.employees.filter(employee => fighters.includes(employee.id)).every(employee => distance(employee.location, mainOf(ordered, 'N01').location) > 65), 'Suppression did not start outside starter range');
    await t.frozen('paused pursuit order and enemy actors');
    await t.pause(false);
    await t.page.waitForTimeout(400);
    const approaching = await t.snapshot('approach-before-hit');
    assert(mainOf(approaching, 'N01').suppressionHp === anomalyById.N01.breach.suppressionHpMax, 'Distant ordered fighters inflicted an immediate remote hit');
    await t.wait(id => window.__facilityTest.controller.state.enemies.find(enemy => enemy.id === id)?.suppressionHp < 170, mainId);
    await t.snapshot('real-contact-and-hit');
    await t.wait(ids => window.__facilityTest.controller.state.employees.some(employee => ids.includes(employee.id) && employee.windupEndsAtSec !== null), fighters, 5000);
    await t.pause(true);
    await t.frozen('paused melee windup');
    await t.click('safeClickPoint', undefined, 'right');
    const retreat = await t.snapshot('paused-combat-retreat');
    assert(retreat.employees.filter(employee => fighters.includes(employee.id)).every(employee => employee.order.kind === 'RETREAT' && employee.windupEndsAtSec === null), 'Retreat left a pending employee attack');
    const hpAtRetreat = mainOf(retreat, 'N01').suppressionHp;
    await t.frozen('paused retreat cancels pursuit');
    await t.pause(false);
    await t.page.waitForTimeout(700);
    await t.snapshot('walking-to-safe-room');
    await t.wait(() => window.__facilityTest.controller.state.rooms.find(room => room.anomalyId === 'N02').work === null, undefined, 30000);
    const otherIncome = await t.snapshot('other-room-completes-during-nailong-breach');
    assert(roomOf(otherIncome, 'N01').mode === 'BREACHED', 'N01 is no longer breached during the other-room production check');
    assert(otherIncome.producedToday >= expectedEnergy + anomalyById.N02.workProfiles[0].energy, 'Unaffected N02 did not produce during N01 breach');
    assert(otherIncome.logs.some(log => log.message.includes('N02') && log.kind === 'INCOME' && log.timeSec > breached.simulationTimeSec), 'Missing actual post-breach N02 income event');
    await t.wait(ids => window.__facilityTest.controller.state.employees.filter(employee => ids.includes(employee.id)).every(employee => employee.location.zone === 'SAFE'), fighters);
    const safe = await t.snapshot('actual-safe-room-arrival');
    assert(mainOf(safe, 'N01').suppressionHp === hpAtRetreat, 'Retreating employees kept dealing damage');
    await t.wait(ids => window.__facilityTest.controller.state.employees.filter(employee => ids.includes(employee.id)).every(employee => employee.hp === employee.hpMax && employee.sp === employee.spMax), fighters);
    await t.snapshot('safe-room-recovery');
    await t.pause(true);
    await t.select(fighters);
    await t.click('getEnemyScreenPoint', mainId, 'right');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.rooms.find(room => room.anomalyId === 'N01').mode === 'RECOVERING', undefined, 35000);
    const recaptured = await t.snapshot('main-recaptured-clones-cleared');
    assert(!recaptured.enemies.some(enemy => enemy.sourceAnomalyId === 'N01'), 'N01 main recapture left clone entities');
    await t.wait(() => window.__facilityTest.controller.state.rooms.find(room => room.anomalyId === 'N01').mode === 'CONTAINED', undefined, 12000);
    await t.pause(true);
    await t.snapshot('recovery-complete');
    await t.page.setViewportSize({ width: 1280, height: 720 });
    if (await t.page.locator('[data-action="toggle-details"]').count()) await t.action('toggle-details');
    await t.select(['E01']);
    await t.move(700);
    const beforeCompact = await t.state();
    await t.pause(false);
    await t.page.waitForTimeout(400);
    await t.pause(true);
    const compact = await t.snapshot('five-rooms-1280-direct-input');
    assert(JSON.stringify(employeeOf(compact, 'E01').location) !== JSON.stringify(employeeOf(beforeCompact, 'E01').location), 'Direct commands failed at 1280 with details collapsed');
    t.report.viewport = await t.page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
    assert(t.report.viewport.scrollWidth <= 1280 && t.report.viewport.scrollHeight <= 720, 'The facility requires page scrolling at 1280');
  },

  async campaign(t) {
    await t.start('campaign');
    const preparation = await t.snapshot('formal-day1-preparation');
    assert(preparation.phase === 'DAY_PREP' && preparation.day === 1 && preparation.employees.length === 4, 'Formal day one roster or phase was replaced by sandbox');
    assert(preparation.wallet === 50 && preparation.producedToday === 0, 'Formal starting economy changed');
    assert(preparation.rooms.filter(room => room.mode === 'CONTAINED').map(room => room.anomalyId).join(',') === 'N01,N02', 'Formal day one room unlocks changed');
    await t.action('start');
    await t.wait(() => window.__facilityTest.controller.state.phase === 'RUNNING');
    await t.pause(true);
    await t.work('N01', 'E01');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.rooms[0].work?.phase === 'EXECUTING');
    await t.snapshot('formal-day1-worker-arrives');
    await t.wait(() => window.__facilityTest.controller.state.producedToday === 12, undefined, 30000);
    await t.snapshot('formal-day1-first-income');
    await t.action('restart');
    if (await t.page.locator('[data-action="confirm-restart"]').count()) await t.action('confirm-restart');
    await t.wait(() => window.__facilityTest.controller.state.phase === 'DAY_PREP');
    const retried = await t.snapshot('formal-retry-restores-day-entry');
    assert(retried.producedToday === 0 && retried.wallet === 50 && retried.employees.length === 4, 'Retry did not restore actual formal day-entry state');
  },

  async dog(t) {
    await t.start();
    await t.pause(true);
    await t.select(['E01']);
    await t.move(gameConfig.layout.roomCentersX[2] + 145);
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees[0].status === 'IDLE');
    const dogId = await t.breach('N03');
    await t.snapshot('dog-actual-breach');
    await t.pause(false);
    await t.wait(id => window.__facilityTest.controller.state.enemies.find(enemy => enemy.id === id)?.windupEndsAtSec !== null, dogId);
    await t.pause(true);
    const windup = await t.snapshot('dog-range-warning');
    assert(distance(employeeOf(windup, 'E01').location, mainOf(windup, 'N03').location) <= anomalyById.N03.breach.attackRangePx, 'Employee was outside the danger area before dodge began');
    const dogVisual = windup.animation.actors.find(actor => actor.id === dogId);
    assert(dogVisual.telegraph.radius === anomalyById.N03.breach.attackRangePx && distance(dogVisual.telegraph.worldCenter, mainOf(windup, 'N03').location) === 0, 'Dog rendered telegraph is not bound to its real current attack center and range');
    assert(dogVisual.attackPhase === 'WINDUP' && dogVisual.attackProgress >= 0 && dogVisual.attackProgress < 1, 'Dog danger pose does not represent the actual pending attack');
    await t.frozen('paused dog world-range windup');
    await t.select(['E01']);
    await t.move(1050);
    await t.pause(false);
    await t.wait(id => window.__facilityTest.controller.state.enemies.find(enemy => enemy.id === id)?.windupEndsAtSec === null, dogId, 5000);
    await t.pause(true);
    const dodged = await t.snapshot('dog-first-howl-dodged');
    assert(employeeOf(dodged, 'E01').hp === employeeOf(windup, 'E01').hp, 'Walking out of the dog warning still took the first howl damage');
    assert(distance(employeeOf(dodged, 'E01').location, mainOf(dodged, 'N03').location) > anomalyById.N03.breach.attackRangePx, 'Employee never left the dog attack radius');
    t.report.dodge = { range: anomalyById.N03.breach.attackRangePx, before: employeeOf(windup, 'E01').location, after: employeeOf(dodged, 'E01').location, hpBefore: employeeOf(windup, 'E01').hp, hpAfter: employeeOf(dodged, 'E01').hp };
    await t.action('stop');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees[0].hp < 100, undefined, 15000);
    const hit = await t.snapshot('dog-later-real-hit-and-knockback');
    assert(employeeOf(hit, 'E01').hp === 86, 'The actual dog hit did not apply configured red damage');
  },

  async cat(t) {
    await t.start();
    await t.pause(true);
    await t.select(['E01']);
    await t.move(650);
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees[0].status === 'IDLE');
    const catId = await t.breach('N02');
    const spawned = await t.snapshot('cat-breach-real-entity');
    await t.pause(false);
    await t.page.waitForTimeout(500);
    const chase = await t.snapshot('cat-chases-at-configured-speed');
    assert(mainOf(chase, 'N02').location.x > mainOf(spawned, 'N02').location.x, 'Cat did not pursue a real corridor target');
    await t.wait(() => window.__facilityTest.controller.state.employees[0].hp < 100, undefined, 10000);
    await t.pause(true);
    const hit = await t.snapshot('cat-red-damage');
    assert(employeeOf(hit, 'E01').hp === 90 && employeeOf(hit, 'E01').sp === 100, 'Cat damage did not affect HP only');
    assert(hit.enemies.some(enemy => enemy.id === catId), 'Cat entity unexpectedly disappeared');
    await t.select(['E01']);
    await t.click('safeClickPoint', undefined, 'right');
    await t.frozen('paused cat retreat');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees[0].location.zone === 'SAFE');
    await t.snapshot('cat-retreat-reaches-safe-room');
  },

  async broadcast(t) {
    await t.start();
    await t.pause(true);
    await t.work('N01', 'E01');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.rooms[0].work?.phase === 'EXECUTING');
    await t.pause(true);
    const before = await t.state();
    const chickenId = await t.breach('N04');
    const linked = await t.snapshot('chicken-real-breach-links-dog');
    assert(roomOf(linked, 'N03').pressure === roomOf(before, 'N03').pressure + 35, 'Chicken breach did not apply the one-way dog pressure link');
    assert(linked.processedLinkEventIds.length === before.processedLinkEventIds.length + 1, 'Breach link was missing or duplicated');
    await t.pause(false);
    await t.wait(id => window.__facilityTest.controller.state.enemies.find(enemy => enemy.id === id)?.windupEndsAtSec !== null, chickenId);
    await t.pause(true);
    const warning = await t.snapshot('broadcast-facility-warning');
    await t.frozen('paused broadcast warning');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees[0].hp < 100, undefined, 5000);
    await t.pause(true);
    const hit = await t.snapshot('broadcast-black-damage-interrupts-work');
    assert(employeeOf(hit, 'E01').hp === 96 && employeeOf(hit, 'E01').sp === 96, 'Broadcast did not apply configured black damage to HP and SP');
    assert(roomOf(hit, 'N01').work === null && hit.producedToday === 0, 'Broadcast failed to interrupt real indoor work without income');
    assert(roomOf(hit, 'N01').pressure === roomOf(before, 'N01').pressure + 8, 'Broadcast emergency pressure did not apply once');
    assert(hit.employees.slice(1).every(employee => employee.location.zone === 'SAFE' && employee.hp === 100 && employee.sp === 100), 'Broadcast hit protected safe-room employees');
    assert(mainOf(hit, 'N04').location.x === mainOf(warning, 'N04').location.x, 'Stationary broadcaster moved');
    await t.select(['E01']);
    await t.click('safeClickPoint', undefined, 'right');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.logs.filter(log => log.kind === 'BROADCAST').length >= 2, undefined, 14000);
    const repeated = await t.snapshot('second-broadcast-does-not-repeat-link');
    assert(roomOf(repeated, 'N03').pressure === roomOf(linked, 'N03').pressure && repeated.processedLinkEventIds.length === linked.processedLinkEventIds.length, 'Repeated broadcast re-applied the entry-only link');
  },

  async gugu(t) {
    await t.start();
    await t.pause(true);
    await t.select(['E01']);
    await t.move(1080);
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees[0].status === 'IDLE');
    const enemyId = await t.breach('N05');
    const spawned = await t.snapshot('gugu-real-breach');
    await t.pause(false);
    await t.page.waitForTimeout(650);
    const patrol = await t.snapshot('gugu-real-patrol');
    assert(mainOf(patrol, 'N05').location.x !== mainOf(spawned, 'N05').location.x, 'Gugu did not patrol');
    await t.wait(id => window.__facilityTest.controller.state.enemies.find(enemy => enemy.id === id)?.windupEndsAtSec !== null, enemyId);
    await t.pause(true);
    await t.snapshot('gugu-pale-radius-warning');
    await t.frozen('paused gugu danger radius');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees[0].hp < 100, undefined, 5000);
    await t.pause(true);
    const hit = await t.snapshot('gugu-max-hp-pale-damage');
    assert(employeeOf(hit, 'E01').hp === 94 && employeeOf(hit, 'E01').sp === 100, 'Gugu did not apply 6 percent max-HP pale damage');
    await t.select(['E01']);
    await t.click('safeClickPoint', undefined, 'right');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees[0].location.zone === 'SAFE');
    await t.snapshot('gugu-retreat-to-real-safe-room');
  },

  async 'skills-equipment'(t) {
    await t.start();
    const initial = await t.snapshot('start-with-original-fifty-energy');
    assert(initial.wallet === gameConfig.economy.initialWallet && initial.progress.unlockedSkills.length === 0, 'Equipment/skill proof cannot begin with injected money or unlocks');
    const totalPurchases = anomalyConfig.length * (gameConfig.economy.archiveBehaviorCost + gameConfig.economy.equipmentPairCost + gameConfig.economy.skillUnlockCost);
    const castCosts = skillConfig.reduce((sum, skill) => sum + skill.energyCost, 0);
    const requiredFunds = totalPurchases + castCosts + 20;
    t.report.economy = { startingWallet: initial.wallet, requiredFunds, purchases: totalPurchases, fiveCastCosts: castCosts, farmingSpeed: 2, rounds: [] };
    await t.action('speed2');
    for (let round = 0; (await t.state()).wallet < requiredFunds; round++) {
      assert(round < 20, 'Real work could not fund the equipment and skill acceptance within twenty rounds');
      await t.wait(() => window.__facilityTest.controller.state.employees.every(employee => employee.status === 'IDLE'));
      await t.pause(true);
      const before = await t.state();
      assert(before.rooms.every(room => room.mode === 'CONTAINED'), 'A farming room unexpectedly breached');
      for (let index = 0; index < anomalyConfig.length; index++) {
        const id = anomalyConfig[index].id;
        const employeeId = id === 'N02' && round % 2 === 1 ? 'E06' : `E0${index + 1}`;
        const type = roomOf(before, id).pressure >= 55 ? 'SOOTHE' : 'OBSERVE';
        await t.work(id, employeeId, type);
      }
      await t.pause(false);
      await t.wait(() => window.__facilityTest.controller.state.rooms.every(room => room.work === null), undefined, 25000);
      const after = await t.state();
      assert(after.wallet > before.wallet && after.wallet - before.wallet === after.producedToday - before.producedToday, 'Real work did not fund purchases through normal income');
      t.report.economy.rounds.push({ round: round + 1, time: after.simulationTimeSec, produced: after.producedToday, wallet: after.wallet, pressures: after.rooms.map(room => ({ id: room.anomalyId, pressure: room.pressure })) });
      console.log(`skills-equipment: earned round ${round + 1}, wallet ${after.wallet}/${requiredFunds}`);
      if (round === 0 || after.wallet >= requiredFunds) await t.snapshot(`earned-funds-round-${round + 1}`);
    }
    await t.pause(true);
    await t.select(initial.employees.map(employee => employee.id));
    await t.click('safeClickPoint', undefined, 'right');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees.every(employee => employee.location.zone === 'SAFE' && employee.status === 'IDLE'));
    await t.wait(() => window.__facilityTest.controller.state.employees.every(employee => employee.hp === employee.hpMax && employee.sp === employee.spMax));
    await t.pause(true);
    await t.action('speed1');
    const funded = await t.snapshot('naturally-funded-and-recovered');
    await t.action('archives');
    for (const anomaly of anomalyConfig) {
      await t.page.locator(`[data-archive-room="${anomaly.id}"]`).click();
      for (const item of ['BEHAVIOR', 'EQUIPMENT', 'SKILL']) await t.page.locator(`[data-purchase="${item}"][data-room="${anomaly.id}"]`).click();
    }
    await t.snapshot('five-real-equipment-and-skill-purchases');
    await t.action('close');
    const purchased = await t.state();
    assert(purchased.wallet === funded.wallet - totalPurchases && purchased.producedToday === funded.producedToday, 'Actual UI purchases changed cumulative production or charged the wrong amount');
    assert(purchased.progress.ownedWeapons.length === 5 && purchased.progress.ownedArmors.length === 5 && purchased.progress.unlockedSkills.length === 5, 'Not all five sets/skills were purchased');
    await t.action('equipment');
    for (let index = 0; index < anomalyConfig.length; index++) {
      await t.page.locator(`[data-equip-employee="E0${index + 1}"]`).click();
      await t.page.locator(`[data-weapon="${anomalyConfig[index].weaponId}"]`).click();
      await t.page.locator(`[data-armor="${anomalyConfig[index].armorId}"]`).click();
    }
    await t.action('close');
    const equipped = await t.snapshot('five-weapons-and-uniforms-in-world');
    assert(equipped.employees.slice(0, 5).every((employee, index) => employee.weaponId === anomalyConfig[index].weaponId && employee.armorId === anomalyConfig[index].armorId), 'Safe-room equipment assignment did not reach real runtime entities');
    for (let index = 0; index < initial.employees.length; index++) {
      await t.select([initial.employees[index].id]);
      await t.move(180 + index * 175);
    }
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees.every(employee => employee.status === 'IDLE' && employee.location.zone === 'CORRIDOR'));
    await t.pause(true);
    await t.snapshot('five-loadouts-separated-on-corridor', 'Each equipped person walks to a separate real corridor position so weapon and uniform differences remain directly visible.');
    await t.select(initial.employees.map(employee => employee.id));
    await t.move(500);
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees.every(employee => employee.status === 'IDLE' && employee.location.zone === 'CORRIDOR'));
    await t.pause(true);
    const enemyId = await t.breach('N01');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.employees.some(employee => employee.sp < employee.spMax), undefined, 15000);
    await t.pause(true);
    const hurt = await t.snapshot('real-sp-damage-before-restoration');
    const hurtEmployee = hurt.employees.find(employee => employee.sp < employee.spMax);
    await t.page.locator('[data-skill="S05"]').click();
    await t.click('getEmployeeScreenPoint', hurtEmployee.id);
    const restored = await t.snapshot('s05-world-target-restores-sp');
    assert(employeeOf(restored, hurtEmployee.id).sp === Math.min(hurtEmployee.spMax, hurtEmployee.sp + skillConfig.find(skill => skill.id === 'S05').restoreSp), 'SP restoration missed its actual world target');
    await t.page.locator('[data-skill="S01"]').click();
    await t.click('getEnemyScreenPoint', enemyId);
    const controlled = await t.snapshot('s01-freezes-actual-enemy');
    assert(mainOf(controlled, 'N01').stunnedUntilSec > controlled.simulationTimeSec && mainOf(controlled, 'N01').windupEndsAtSec === null, 'Stun did not control the real target or cancel its windup');
    await t.frozen('paused skill duration and cooldown');
    await t.page.locator('[data-skill="S02"]').click();
    await t.click('getEnemyScreenPoint', enemyId);
    const damaged = await t.snapshot('s02-actual-damage');
    assert(mainOf(damaged, 'N01').suppressionHp === mainOf(controlled, 'N01').suppressionHp - 32, 'Targeted damage skill did not apply configured damage');
    await t.page.locator('[data-skill="S03"]').click();
    await t.click('getCorridorScreenPoint', mainOf(damaged, 'N01').location.x - 25);
    const knocked = await t.snapshot('s03-world-radius-knockback');
    assert(mainOf(knocked, 'N01').location.x > mainOf(damaged, 'N01').location.x + 159, 'Area knockback did not move the actual enemy');
    assert(mainOf(knocked, 'N01').suppressionHp === mainOf(damaged, 'N01').suppressionHp - 8, 'Knockback skill did not apply its configured real damage');
    await t.page.locator('[data-skill="S04"]').click();
    const accelerated = await t.snapshot('s04-all-active-employees-speed-buff');
    assert(accelerated.employees.every(employee => employee.moveBuffRemainingSec === 8), 'Global movement buff did not reach all active employees');
    assert(accelerated.wallet === purchased.wallet - castCosts && accelerated.producedToday === purchased.producedToday, 'Five real casts did not charge only their configured wallet costs');
    assert(Object.values(accelerated.skillCooldowns).every(value => value > 0), 'A purchased skill did not enter actual cooldown after use');
    await t.select(initial.employees.map(employee => employee.id));
    await t.click('getEnemyScreenPoint', enemyId, 'right');
    await t.pause(false);
    await t.wait(() => window.__facilityTest.controller.state.rooms[0].mode === 'RECOVERING', undefined, 20000);
    const recaptured = await t.snapshot('equipped-team-completes-real-suppression');
    assert(recaptured.wallet === accelerated.wallet && recaptured.producedToday === accelerated.producedToday, 'Equipment combat incorrectly produced energy');
  },
};

try {
  for (const name of requested) assert(cases[name], `Unknown facility case: ${name}`);
  // Keep at most two actual pages running so render load does not dominate the game clock.
  let next = 0;
  const worker = async () => {
    while (next < requested.length) {
      if (await stopRequested()) return;
      const name = requested[next++];
      if (name) await runCase(name, cases[name]);
    }
  };
  await Promise.all([worker(), worker()]);
  suite.status = suite.cases.length < requested.length ? 'STOPPED' : suite.cases.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL';
} finally {
  suite.finishedAt = new Date().toISOString();
  await browser.close();
  suite.ownedBrowserClosed = true;
  await writeFile(`${out}/suite.json`, JSON.stringify(suite, null, 2));
  await writeFile(`${root}/latest-run.json`, JSON.stringify({ directory: resolve(out), report: resolve(`${out}/suite.json`), status: suite.status }, null, 2));
  console.log(JSON.stringify(suite, null, 2));
}
