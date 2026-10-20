import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// All journey commands come from visible controls. Clock acceleration changes only
// browser scheduling; it never sets simulation time, resources, positions or orders.
const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173/';
const output = 'docs/browser-regression.json';
const screenshotDir = 'docs/screenshots';
const fixturesOnly = process.env.FIXTURES_ONLY === '1';
const report = fixturesOnly ? JSON.parse(await readFile(output, 'utf8')) : { startedAt: new Date().toISOString(), baseURL, viewport: { width: 1600, height: 900 }, mode: 'real UI input with Playwright requestAnimationFrame clock acceleration', checks: [], browserErrors: [], fixtures: [], screenshots: [] };
report.result = 'running';
delete report.error;
if (fixturesOnly) report.fixtureRerunStartedAt = new Date().toISOString();
const record = async (name, detail) => {
  report.checks.push({ name, result: 'passed', detail });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(`PASS ${name}: ${JSON.stringify(detail)}`);
};
await mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: report.viewport });
  const page = await context.newPage();
  page.on('pageerror', error => report.browserErrors.push(error.message));
  await page.clock.install();
  await page.goto(baseURL);
  await page.locator('canvas').waitFor();
  const state = () => page.evaluate(() => {
    const { ui } = window.__containmentTest;
    const s = ui.simulation.state;
    return { ...JSON.parse(JSON.stringify(s)), aiming: ui.aiming, modal: ui.modal, selected: [...ui.selected] };
  });
  const tick = async seconds => {
    // Short batches keep failure observations and console progress responsive.
    for (let remaining = seconds; remaining > 0; remaining -= 5) await page.clock.runFor(Math.min(remaining, 5) * 1000);
  };
  const action = async name => {
    const modalControl = page.locator(`#modal-layer [data-action="${name}"]`);
    if (await modalControl.count()) await modalControl.first().click();
    else await page.locator(`[data-action="${name}"]`).filter({ visible: true }).first().click();
  };
  const close = () => page.locator('#modal-layer [data-action="close"]').first().click();
  const shot = async name => {
    await tick(0.2);
    await page.screenshot({ path: `${screenshotDir}/${name}` });
    report.screenshots.push(`${screenshotDir}/${name}`);
  };
  const point = async (x, y, button = 'left') => {
    const bounds = await page.locator('#game-frame').boundingBox();
    assert(bounds);
    await page.mouse.click(bounds.x + x * bounds.width / 1600, bounds.y + y * bounds.height / 900, { button });
  };
  const dispatch = async (employeeId, roomId, type) => {
    await page.locator(`[data-employee="${employeeId}"]`).click();
    await page.locator(`[data-room="${roomId}"]`).click();
    await page.locator(`[data-work="${type}"]`).click();
  };
  const skipTutorial = async () => {
    const s = await state();
    if (s.modal === 'tutorial') { await action('tutorial-no'); return true; }
    return false;
  };
  const paused = async wanted => {
    if (((await state()).timeScale === 0) !== wanted) await page.keyboard.press('Space');
  };

  let s;
  if (!fixturesOnly) {
  await action('new-game');
  await action('start-day');
  await dispatch('E01', 'N01', 'OBSERVE');
  await tick(38);
  s = await state();
  assert.equal(s.producedToday, 12);
  assert.equal(s.progress.wallet, 62);
  assert.equal(s.rooms.find(r => r.anomalyId === 'N01').work, null);
  await record('G02/W01 browser actual work completion', { produced: s.producedToday, wallet: s.progress.wallet, simulationTime: s.simulationTimeSec });

  await paused(true);
  await page.locator('[data-employee="E01"]').click();
  await point(1000, 440, 'right');
  const frozen = await state();
  await page.clock.fastForward(20_000);
  s = await state();
  assert.equal(s.simulationTimeSec, frozen.simulationTimeSec);
  assert.deepEqual(s.employees[0].location, frozen.employees[0].location);
  assert.equal(s.employees[0].order.kind, 'MOVE');
  await paused(false);
  await tick(1);
  assert((await state()).employees[0].location.x > s.employees[0].location.x);
  await record('P01 browser pause freezes real motion and clock', { pausedVirtualSeconds: 20, position: frozen.employees[0].location });

  await page.reload();
  await action('continue');
  s = await state();
  assert.equal(s.phase, 'DAY_PREP');
  assert.equal(s.progress.wallet, 50);
  assert.equal(s.producedToday, 0);
  await record('P06 reload restores day-entry snapshot', { phase: s.phase, wallet: s.progress.wallet, produced: s.producedToday });
  await action('start-day');
  // Keep automatic accident pause enabled; the normal run below avoids threshold breaches.
  await action('speed2');

  const journey = [];
  for (let day = 1; day <= 3; day++) {
    let rounds = 0;
    let beforeDay = await state();
    assert.equal(beforeDay.day, day);
    const target = [150, 240, 340][day - 1];
    while ((await state()).producedToday < target && rounds < 18) {
      await skipTutorial();
      await paused(true);
      s = await state();
      assert.equal(s.phase, 'RUNNING');
      const open = s.rooms.filter(r => r.mode === 'CONTAINED');
      const employees = s.employees.filter(e => e.status !== 'INCAPACITATED' && e.status !== 'PANICKED');
      // Rotate the first two employees so N02's repeat-worker rule is respected.
      const rotation = rounds % 2 === 0 ? [0, 1, 2, 3, 4] : [1, 0, 2, 3, 4];
      for (let index = 0; index < open.length; index++) {
        const room = open[index];
        if (room.work) continue;
        const worker = employees[rotation[index]];
        if (!worker) continue;
        const soothe = room.pressure >= 55 || room.anomalyId === 'N04' && room.memory.nonSootheCount >= 2;
        await dispatch(worker.id, room.anomalyId, soothe ? 'SOOTHE' : 'OBSERVE');
      }
      await paused(false);
      // Entry from the safe room needs up to 37 seconds; later work cycles need 34.
      await tick(rounds === 0 ? 20 : 17);
      if (await skipTutorial()) await tick(15);
      s = await state();
      if (s.timeScale === 0 && s.modal === null) await paused(false);
      rounds++;
      console.log(`JOURNEY day=${day} round=${rounds} produced=${s.producedToday} time=${s.simulationTimeSec.toFixed(2)}`);
    }
    s = await state();
    assert(s.producedToday >= target, `Day ${day} did not reach quota`);
    assert.equal(s.employees.filter(e => e.status === 'INCAPACITATED').length, 0);
    journey.push({ day, rounds, produced: s.producedToday, wallet: s.progress.wallet, simulatedSeconds: s.simulationTimeSec, breaches: s.logs.filter(e => e.kind === 'BREACH').length });
    await action('finish');
    await action('confirm-finish');
    await tick(0.2);
    if (day < 3) {
      assert.equal((await state()).modal, 'report');
      if (day === 1) {
        await shot('07-day-report.png');
        await action('logs');
        assert.equal((await state()).modal, 'logs');
        await close();
        assert.equal((await state()).modal, 'report');
        await record('P11 report to logs returns to mandatory report', { day });
      }
      await action('next-day');
      assert.equal((await state()).phase, 'DAY_PREP');
      await action('start-day');
      await action('speed2');
    } else {
      assert.equal((await state()).phase, 'COMPLETE');
      await shot('08-complete.png');
    }
  }
  await record('P13 UI-only three-day quota journey without resource or state injection', journey);
  await page.reload();
  await action('continue');
  assert.equal((await state()).phase, 'COMPLETE');
  assert.equal((await state()).modal, 'complete');
  await record('P07 completion marker survives browser reload', { day: (await state()).day, phase: (await state()).phase });
  }

  // Separate seeded day-entry fixture for affordable equipment and skills coverage.
  // This does not count toward the UI-only journey above. No live state is mutated.
  const fixtureSave = await page.evaluate(() => {
    const { ui } = window.__containmentTest;
    const snapshot = ui.simulation.snapshot();
    return { snapshot, demoCompleted: false };
  });
  fixtureSave.snapshot.day = 3;
  fixtureSave.snapshot.progress.wallet = 1000;
  fixtureSave.snapshot.progress.tutorialOfferHandled = true;
  for (const research of Object.values(fixtureSave.snapshot.progress.research)) {
    research.behavior = false; research.combat = false; research.equipmentDeveloped = false;
  }
  fixtureSave.snapshot.progress.ownedWeapons = [];
  fixtureSave.snapshot.progress.ownedArmors = [];
  fixtureSave.snapshot.progress.unlockedSkills = [];
  fixtureSave.snapshot.progress.employeeLoadouts = {};
  report.fixtures.push({ name: 'day-3-equipment-skills', method: 'explicit localStorage day-entry JSON; then reload and visible UI only', seededWallet: 1000, day: 3, liveStateMutation: false });
  await page.evaluate(save => localStorage.setItem('wanggeng.demo.v1', JSON.stringify(save)), fixtureSave);
  await page.reload();
  await action('continue');
  await action('archives');
  await page.locator('[data-archive="N01"]').click();
  assert(await page.locator('[data-purchase="SKILL"]').isEnabled(), 'Skill must have no archive prerequisite');
  assert(await page.locator('[data-purchase="EQUIPMENT"]').isDisabled());
  await page.locator('[data-purchase="BEHAVIOR"]').click();
  assert(await page.locator('[data-purchase="EQUIPMENT"]').isEnabled(), 'Equipment needs behavior, not combat archive');
  await page.locator('[data-purchase="EQUIPMENT"]').click();
  await page.locator('[data-purchase="SKILL"]').click();
  for (const id of ['N02', 'N03', 'N04', 'N05']) {
    await page.locator(`[data-archive="${id}"]`).click();
    await page.locator('[data-purchase="SKILL"]').click();
  }
  await close();
  assert.equal((await state()).modal, 'briefing');
  await action('start-day');
  await action('equipment');
  await page.locator('[data-equip-employee="E01"]').click();
  await page.locator('[data-weapon="W01"]').click();
  await page.locator('[data-equip-employee="E02"]').click();
  await page.locator('[data-weapon="W01"]').click();
  assert.equal((await state()).modal, 'transfer');
  assert.equal((await state()).employees.find(e => e.id === 'E01').weaponId, 'W01');
  await close();
  assert.equal((await state()).modal, 'equipment');
  assert.equal((await state()).employees.find(e => e.id === 'E01').weaponId, 'W01');
  await page.locator('[data-weapon="W01"]').click();
  await action('confirm-transfer');
  s = await state();
  assert.equal(s.modal, 'equipment');
  assert.equal(s.employees.find(e => e.id === 'E01').weaponId, 'W00');
  assert.equal(s.employees.find(e => e.id === 'E02').weaponId, 'W01');
  await shot('05-equipment.png');
  await record('C08 browser equipment transfer cancellation and confirmation', { originalHolder: 'E01 W00', newHolder: 'E02 W01', uniqueInstances: s.employees.filter(e => e.weaponId === 'W01').length });
  await close();
  await paused(true);
  await page.locator('[data-employee="E01"]').click();
  await page.keyboard.press('1');
  assert.equal((await state()).aiming, 'S01');
  const beforeCancel = await state();
  await point(800, 440, 'right');
  s = await state();
  assert.equal(s.aiming, null);
  assert.deepEqual(s.employees[0].order, beforeCancel.employees[0].order);
  assert.equal(s.progress.wallet, beforeCancel.progress.wallet);
  await page.keyboard.press('3');
  await page.keyboard.press('Escape');
  assert.equal((await state()).aiming, null);
  assert.equal((await state()).modal, null);
  await record('S02 aim cancellation consumes only the input, never movement or energy', { cancelledWith: ['right mouse', 'Escape'], wallet: s.progress.wallet });

  await page.setViewportSize({ width: 1280, height: 720 });
  await tick(0.2);
  const layoutCheck = await page.evaluate(() => {
    const visible = selector => [...document.querySelectorAll(selector)].map(element => {
      const r = element.getBoundingClientRect();
      return { id: element.getAttribute('data-employee') ?? element.getAttribute('data-skill'), withinViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    });
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, employees: visible('[data-employee]'), skills: visible('[data-skill]'), rooms: document.querySelectorAll('[data-room]').length };
  });
  assert.equal(layoutCheck.employees.length, 6);
  assert.equal(layoutCheck.skills.length, 5);
  assert.equal(layoutCheck.rooms, 5);
  assert(layoutCheck.employees.every(e => e.withinViewport));
  assert(layoutCheck.skills.every(e => e.withinViewport));
  assert(layoutCheck.scrollWidth <= layoutCheck.width && layoutCheck.scrollHeight <= layoutCheck.height);
  await record('P09 1280x720 all five rooms, six staff and five skills reachable without scrolling', layoutCheck);
  await page.setViewportSize({ width: 1600, height: 900 });

  // Cause the documented link through real repeated interactions, no forceBreach calls.
  await action('settings');
  await page.locator('#first-pause').uncheck();
  await close();
  await action('speed2');
  for (let round = 0; round < 2; round++) {
    await paused(true);
    await dispatch('E03', 'N03', 'INTERACT');
    if (!(await state()).rooms.find(r => r.anomalyId === 'N05').work) await dispatch('E05', 'N05', 'OBSERVE');
    await paused(false);
    await tick(16);
  }
  for (let round = 0; round < 3; round++) {
    await paused(true);
    await dispatch('E04', 'N04', 'INTERACT');
    if (!(await state()).rooms.find(r => r.anomalyId === 'N05').work) await dispatch('E05', 'N05', 'OBSERVE');
    await paused(false);
    await tick(16);
  }
  await paused(true);
  s = await state();
  assert.equal(s.rooms.find(r => r.anomalyId === 'N04').mode, 'BREACHED');
  assert.equal(s.rooms.find(r => r.anomalyId === 'N03').mode, 'BREACHED');
  assert(s.logs.some(log => log.kind === 'LINK'));
  await shot('04-linked-breach.png');
  await record('S09 browser repeated work causes actual N04 to N03 chain breach', { source: 'N04 BREACHED', target: 'N03 BREACHED', targetPressure: s.rooms.find(r => r.anomalyId === 'N03').pressure, links: s.logs.filter(log => log.kind === 'LINK').length });
  const broadcaster = s.enemies.find(e => e.sourceAnomalyId === 'N04');
  await page.keyboard.press('1');
  await point(broadcaster.location.x, broadcaster.location.y);
  s = await state();
  assert(s.skillCooldownRemainingSec.S01 > 0);
  await page.keyboard.press('2');
  await point(broadcaster.location.x, broadcaster.location.y);
  await page.keyboard.press('3');
  await point(broadcaster.location.x, broadcaster.location.y);
  await page.keyboard.press('4');
  await page.keyboard.press('5');
  s = await state();
  const hurt = s.employees.find(e => e.sp < e.spMax && e.status !== 'INCAPACITATED');
  assert(hurt, 'Repeated N04 interaction produces an injured SP target');
  await point(hurt.location.x, hurt.location.y);
  s = await state();
  assert(Object.values(s.skillCooldownRemainingSec).every(value => value > 0));
  await shot('06-skills.png');
  await record('S03-S07 all five browser skills act on live entities while paused', { cooldowns: s.skillCooldownRemainingSec, wallet: s.progress.wallet, targetSuppression: s.enemies.find(e => e.id === broadcaster.id)?.suppressionHp });

  await paused(false);
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  const visibility = await page.evaluate(() => document.visibilityState);
  await page.bringToFront();
  if (visibility === 'hidden') {
    assert.equal((await state()).timeScale, 0);
    await record('P04 native tab background pauses simulation', { observedVisibility: visibility });
  } else {
    report.checks.push({ name: 'P04 native tab background', result: 'not verified', detail: 'Headless Chrome kept the first page visible after bringToFront; no synthetic event counted as native evidence.' });
  }
  await other.close();
  assert.deepEqual(report.browserErrors, []);
  report.result = 'passed';
} catch (error) {
  report.result = 'failed';
  report.error = { message: error.message, stack: error.stack };
  console.error(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  // A fixture-only rerun updates its latest evidence without double-counting cases.
  report.checks = [...new Map(report.checks.map(check => [check.name, check])).values()];
  report.fixtures = [...new Map(report.fixtures.map(fixture => [fixture.name, fixture])).values()];
  report.screenshots = [...new Set(report.screenshots)];
  await writeFile(output, JSON.stringify(report, null, 2));
  await browser.close();
}
