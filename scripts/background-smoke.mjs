import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const output = 'docs/background-smoke.json';
const evidence = {
  test: 'P04 real native Chrome visibility and paused return',
  clock: 'Actual wall time; no fake clocks, dispatched visibility events or simulation mutations',
  windowPolicy: 'Owned Chrome helper started minimized and positioned at -32000,-32000; always closed in finally',
  status: 'UNVERIFIED',
  stages: [],
  errors: [],
};
let browser;
try {
  browser = await chromium.launch({
    channel: 'chrome', headless: false,
    args: ['--start-minimized', '--window-position=-32000,-32000', '--window-size=1600,1000'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => evidence.errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  // Restore only this owned window, keeping its bounds outside all normal desktop displays.
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: -32000, top: -32000, width: 1600, height: 1000 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.locator('[data-action="new-game"]').click();
  await page.locator('#modal-layer [data-action="start-day"]').click();
  await page.waitForFunction(() => window.__containmentTest?.ui.simulation.state.phase === 'RUNNING', null, { polling: 100 });
  const capture = async label => {
    const observation = await page.evaluate(() => ({
      visibility: document.visibilityState,
      hidden: document.hidden,
      phase: window.__containmentTest.ui.simulation.state.phase,
      timeScale: window.__containmentTest.ui.simulation.state.timeScale,
      simulationTimeSec: window.__containmentTest.ui.simulation.state.simulationTimeSec,
      realTimeMs: Date.now(),
    }));
    evidence.stages.push({ label, ...observation });
    return observation;
  };
  const initial = await capture('running-visible');
  if (initial.visibility !== 'visible' || initial.timeScale !== 1) throw new Error(`Cannot establish visible running helper: ${JSON.stringify(initial)}`);
  await page.waitForTimeout(700);
  const progressed = await capture('visible-clock-progressed');
  if (progressed.simulationTimeSec <= initial.simulationTimeSec) throw new Error('Visible game simulation did not progress on the actual renderer clock.');

  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  let backgroundTab;
  try {
    await page.waitForFunction(() => document.visibilityState === 'hidden', null, { polling: 100, timeout: 2000 });
    evidence.nativeHideMethod = 'Browser.setWindowBounds minimized';
  } catch {
    evidence.minimizeObservation = await cdp.send('Browser.getWindowBounds', { windowId });
    evidence.minimizeDidNotHideDocument = await page.evaluate(() => document.visibilityState);
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: -32000, top: -32000, width: 1600, height: 1000 } });
    backgroundTab = await context.newPage();
    await backgroundTab.goto('about:blank');
    await backgroundTab.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'hidden', null, { polling: 100, timeout: 5000 });
    evidence.nativeHideMethod = 'Native Chrome sibling tab brought to front';
  }
  await page.waitForFunction(() => window.__containmentTest.ui.simulation.state.timeScale === 0, null, { polling: 100, timeout: 5000 });
  const hidden = await capture('native-background-observed');
  await page.waitForTimeout(20000);
  const afterHidden = await capture('after-20-real-seconds-hidden');
  if (afterHidden.simulationTimeSec !== hidden.simulationTimeSec || afterHidden.timeScale !== 0) throw new Error('Simulation advanced while the native game page was hidden.');

  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: -32000, top: -32000, width: 1600, height: 1000 } });
  if (backgroundTab) await page.bringToFront();
  await page.waitForFunction(() => document.visibilityState === 'visible', null, { polling: 100, timeout: 5000 });
  await page.waitForTimeout(800);
  const returned = await capture('returned-visible-still-paused');
  if (returned.timeScale !== 0 || returned.simulationTimeSec !== hidden.simulationTimeSec) throw new Error('Returning to the page auto-resumed or caught up hidden wall time.');
  await page.locator('[data-action="pause"]').click();
  await page.waitForTimeout(600);
  const resumed = await capture('explicit-user-button-resumed');
  if (resumed.timeScale !== 1 || resumed.simulationTimeSec <= returned.simulationTimeSec) throw new Error('Explicit continue button did not resume simulation.');
  if (resumed.simulationTimeSec - returned.simulationTimeSec > 1.1) throw new Error('Old hidden elapsed time appeared after explicit continue.');
  if (evidence.errors.length) throw new Error(`Page errors: ${evidence.errors.join('; ')}`);
  evidence.status = 'PASS';
} catch (error) {
  evidence.reason = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  evidence.ownedBrowserClosed = true;
  await writeFile(output, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
