import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'docs/screenshots';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.clock.install();
try {
await page.goto('http://127.0.0.1:5173/');
await page.locator('canvas').waitFor();
await page.locator('[data-action="new-game"]').click();
await page.locator('#modal-layer [data-action="start-day"]').click();
await page.locator('[data-employee="E01"]').click();
await page.locator('[data-room="N01"]').click();
await page.locator('[data-work="OBSERVE"]').click();
await page.clock.runFor(17000);
const working = await page.evaluate(() => {
  const { ui } = window.__containmentTest;
  return { phase: ui.simulation.state.rooms[0].work?.phase, produced: ui.simulation.state.producedToday };
});
if (working.phase !== 'EXECUTING' || working.produced !== 0) throw new Error(`Unexpected early work state: ${JSON.stringify(working)}`);
await page.screenshot({ path: `${out}/01-normal-work.png` });
await page.keyboard.press('Space');
await page.locator('[data-action="archives"]').first().click();
await page.screenshot({ path: `${out}/02-archive.png` });
await page.locator('[data-action="close"]').first().click();
await page.setViewportSize({ width: 1280, height: 720 });
await page.clock.runFor(250);
await page.screenshot({ path: `${out}/03-1280-layout.png` });
const layout = await page.evaluate(() => ({
  width: innerWidth, height: innerHeight,
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight,
  canvas: !!document.querySelector('canvas'),
}));
await writeFile('docs/browser-smoke.json', JSON.stringify({ errors, layout, working }, null, 2));
console.log(JSON.stringify({ errors, layout, working }, null, 2));
if (errors.length || layout.scrollWidth > layout.width || layout.scrollHeight > layout.height) process.exitCode = 1;
} finally { await browser.close(); }
