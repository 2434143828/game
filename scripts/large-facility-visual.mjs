import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = `docs/large-facility-evidence-2026-10-20/visual-${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__facilityTest?.scene.getEmployeeScreenPoint('E01'));
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.screenshot({ path: `${output}/01-central-view.png` });
  await page.keyboard.press('Home');
  await page.screenshot({ path: `${output}/02-overview.png` });
  for (const id of ['N01', 'N03', 'N04', 'N05']) {
    const point = await page.evaluate(id => window.__facilityTest.scene.getCameraControls().rooms[id], id);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${output}/03-${id}-room.png` });
  }
  await writeFile(`${output}/report.json`, JSON.stringify({
    errors,
    camera: await page.evaluate(() => window.__facilityTest.scene.getCameraState()),
    employees: await page.evaluate(() => window.__facilityTest.controller.state.employees.map(e => ({ id: e.id, location: e.location, status: e.status }))),
  }, null, 2));
  console.log(JSON.stringify({ output, errors }));
} finally {
  await browser.close();
}
