import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output = `docs/art-evidence-2026-10-20/visual-${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(output, { recursive: true });
const report = {
  status: 'RUNNING', startedAt: new Date().toISOString(), output,
  method: 'Real Chrome, native inputs and elapsed time; DEV bridge is read-only. Existing sandbox breach control is clicked through the UI.',
  errors: [], consoleErrors: [], failedRequests: [], httpErrors: [], checks: [], inputTrace: [], uiAssetRequests: 0,
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let activeContext;
let activePage;
let serial = 0;
const read = page => page.evaluate(() => {
  const bridge = window.__facilityTest;
  const s = bridge.controller.state;
  return { time: s.simulationTimeSec, timeScale: s.timeScale, phase: s.phase, wallet: s.progress.wallet,
    produced: s.producedToday, employees: structuredClone(s.employees), enemies: structuredClone(s.enemies),
    rooms: structuredClone(s.rooms), camera: bridge.scene.getCameraState(), animation: bridge.scene.getAnimationState() };
});
async function fresh(name) {
  if (activeContext) await activeContext.close();
  activeContext = await browser.newContext({ viewport: { width: 1600, height: 900 },
    recordVideo: { dir: `${output}/${name}/video`, size: { width: 1600, height: 900 } } });
  const page = activePage = await activeContext.newPage();
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
  page.on('requestfailed', r => report.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
  page.on('request', r => { if (r.url().includes('/art/ui/')) report.uiAssetRequests++; });
  page.on('response', r => { if (r.status() >= 400) report.httpErrors.push({ url: r.url(), status: r.status() }); });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__facilityTest?.scene.getEmployeeScreenPoint('E01'));
  await pause(page, true);
  return page;
}
async function click(page, selector) {
  report.inputTrace.push({ at: new Date().toISOString(), action: 'dom_click', selector });
  await page.locator(selector).click();
}
async function key(page, value) {
  report.inputTrace.push({ at: new Date().toISOString(), action: 'key', value });
  await page.keyboard.press(value);
}
async function canvasClick(page, point, button = 'left') {
  const rect = await page.locator('canvas').boundingBox();
  assert(rect);
  report.inputTrace.push({ at: new Date().toISOString(), action: 'canvas_click', point, button });
  await page.mouse.click(rect.x + point.x * rect.width / 1600, rect.y + point.y * rect.height / 900, { button });
}
async function pause(page, wanted) {
  const currentlyPaused = (await read(page)).timeScale === 0;
  if (currentlyPaused !== wanted) await click(page, '[data-action="pause"]');
  await page.waitForFunction(wanted => (window.__facilityTest.controller.state.timeScale === 0) === wanted, wanted);
}
async function room(page, id) {
  const point = await page.evaluate(id => window.__facilityTest.scene.getCameraControls().rooms[id], id);
  await canvasClick(page, point);
}
async function shot(page, label) {
  const screenshot = `${String(++serial).padStart(2, '0')}-${label}.png`;
  await page.mouse.move(15, 885);
  await page.waitForTimeout(220);
  const state = await read(page);
  await page.screenshot({ path: `${output}/${screenshot}` });
  report.checks.push({ label, screenshot, state });
  console.log(JSON.stringify({ checkpoint: label, time: state.time, enemies: state.enemies.length }));
  return state;
}
async function moveBeforeBreach(page, id) {
  await click(page, '[data-action="speed2"]');
  await pause(page, true);
  await click(page, '[data-employee="E01"]');
  await room(page, id);
  const target = await page.evaluate(id => {
    const map = window.__facilityTest.scene.getMapState();
    return map.nodes.find(n => n.id === map.rooms[id].entryNodeId);
  }, id);
  assert(target, 'No real corridor entry node');
  const screen = await page.evaluate(p => window.__facilityTest.scene.getCorridorScreenPoint(p), target);
  await canvasClick(page, screen, 'right');
  await pause(page, false);
  await page.waitForFunction(p => {
    const e = window.__facilityTest.controller.state.employees[0];
    return Math.hypot(e.location.x - p.x, e.location.y - p.y) < 5;
  }, target, { timeout: 60000, polling: 50 });
  await pause(page, true);
  await key(page, 's');
  await room(page, id);
}
try {
  const page = await fresh('gallery');
  await shot(page, 'default-facility');
  const beforeRequests = report.uiAssetRequests;
  await page.waitForTimeout(700);
  assert.equal(report.uiAssetRequests, beforeRequests, 'Paused HUD must not repeatedly request unchanged SVG assets');
  report.pausedAssetRequestIncrease = report.uiAssetRequests - beforeRequests;
  await key(page, 'Home');
  await shot(page, 'whole-facility');
  await click(page, '[data-employee="E01"]');
  await key(page, 'f');
  await shot(page, 'articulated-personnel-idle');
  for (const id of ['N01', 'N02', 'N03', 'N04', 'N05']) {
    await room(page, id);
    const s = await shot(page, `${id}-contained`);
    assert.equal(s.rooms.find(r => r.anomalyId === id).mode, 'CONTAINED');
  }
  await click(page, '.facility-toolbar [data-action="archives"]');
  await shot(page, 'archive-template');
  await click(page, '[data-archive-room="N05"]');
  await shot(page, 'archive-gugu-gaga');
  await click(page, '.facility-dialog > header [data-action="close"]');
  await page.setViewportSize({ width: 1280, height: 720 });
  await click(page, '[data-action="toggle-details"]');
  await key(page, 'Home');
  await shot(page, '1280-facility-inspector-collapsed');
  const layout = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }));
  assert.deepEqual(layout, { w: 1280, h: 720, sw: 1280, sh: 720 });

  for (const id of ['N01', 'N02', 'N03', 'N04', 'N05']) {
    const p = await fresh(id);
    if (id === 'N01' || id === 'N02') await moveBeforeBreach(p, id);
    else await room(p, id);
    await click(p, '[data-action="breach"]');
    await pause(p, true);
    const s = await shot(p, `${id}-actual-breach`);
    assert.equal(s.rooms.find(r => r.anomalyId === id).mode, 'BREACHED');
    assert.equal(s.enemies.filter(e => e.sourceAnomalyId === id).length, id === 'N01' ? 3 : 1);
    if (id === 'N01' || id === 'N02') {
      await click(p, '[data-employee="E01"]');
      await key(p, 'f');
      await pause(p, false);
      await p.waitForFunction(() => {
        const e = window.__facilityTest.controller.state.employees[0];
        return e.hp < e.hpMax || e.sp < e.spMax;
      }, null, { timeout: 30000, polling: 25 });
      await pause(p, true);
      await shot(p, `${id}-actual-hit`);
      await pause(p, false);
      const expected = id === 'N01' ? 'PANICKED' : 'INCAPACITATED';
      await p.waitForFunction(status => window.__facilityTest.controller.state.employees[0].status === status,
        expected, { timeout: 45000, polling: 25 });
      await pause(p, true);
      const actual = await shot(p, `employee-${expected.toLowerCase()}`);
      assert.equal(actual.employees[0].status, expected);
      const frozen = await read(p);
      await p.waitForTimeout(700);
      const after = await read(p);
      assert.deepEqual(after, frozen, 'Actual state and animation must freeze during panic/incapacitation');
    }
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.httpErrors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.reason = String(error.stack ?? error); process.exitCode = 1;
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  if (activeContext) await activeContext.close();
  await browser.close();
  report.finishedAt = new Date().toISOString();
  report.ownedBrowserClosed = true;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, status: report.status, checks: report.checks.length, reason: report.reason }));
}
