import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';

// Production-only black-box smoke. No simulation reads, DEV API calls, injected
// clocks, state mutation, or imported browser modules are used anywhere below.
const origin = 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile(new URL('../config/facility.json', import.meta.url), 'utf8'));
const output = `docs/large-facility-evidence-2026-10-20/production-${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(output, { recursive: true });
const view = { x: 16, y: 76, width: 1328, height: 720 };
const roomControls = ['N01', 'N02', 'N03', 'N04', 'N05'].map((id, index) => ({ id, x: 86 + index * 110, y: 100 }));
// Deterministic screenshot rasterization; does not alter the game's normal
// hardware-rendered launch or any simulation state.
const browserArgs = ['--use-angle=swiftshader'];
const report = {
  status: 'RUNNING', startedAt: new Date().toISOString(), url: origin,
  policy: 'Production bundle; DOM observations and real mouse/keyboard only. No runtime state or DEV bridge access.',
  browserLaunch: { channel: 'chrome', headless: true, args: browserArgs },
  errors: [], consoleErrors: [], failedRequests: [], httpErrors: [], externalRequests: [], developmentRequests: [], checks: [], screenshots: [],
};
let browser;
let context;
let page;
let serial = 0;
const sha = data => createHash('sha256').update(data).digest('hex');

/** Decode Chromium screenshot pixels using only Node built-ins. This inspects
 * the actual displayed selection ring, never an offscreen or simulated actor. */
function pngPixels(buffer) {
  assert.equal(buffer.subarray(1, 4).toString(), 'PNG', 'Expected PNG screenshot');
  let width, height, channels;
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'Only Chromium 8-bit screenshots are supported');
      assert([2, 6].includes(data[9]), 'Expected true-color RGB/RGBA screenshot');
      assert.equal(data[12], 0, 'Expected non-interlaced screenshot');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = packed[source++]; assert(filter <= 4, 'Invalid PNG row filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const left = x >= channels ? pixels[i - channels] : 0;
      const up = y ? pixels[i - stride] : 0;
      const upperLeft = y && x >= channels ? pixels[i - stride - channels] : 0;
      const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
      pixels[i] = (packed[source++] + predicted) & 255;
    }
  }
  return { width, height, channels, pixels };
}
function selectedRingPixels(buffer) {
  const { pixels, channels } = pngPixels(buffer);
  let count = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    // Scene selection ellipse: #ffcf43, with antialiased edges.
    if (r > 230 && g > 175 && g < 225 && b < 112 && r - g > 24) count++;
  }
  return count;
}
function pixelDifference(before, after) {
  const a = pngPixels(before), b = pngPixels(after);
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let changed = 0, maxDelta = 0, minX = a.width, minY = a.height, maxX = -1, maxY = -1;
  const tiles = new Map();
  const changedPixelSamples = [];
  const regions = { employeeAnchor: 0, topNavigation: 0, bottomHelp: 0, minimap: 0, remainingWorld: 0 };
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const ai = (y * a.width + x) * a.channels, bi = (y * b.width + x) * b.channels;
    let delta = 0;
    for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs((c < a.channels ? a.pixels[ai + c] : 255) - (c < b.channels ? b.pixels[bi + c] : 255)));
    if (!delta) continue;
    changed++; maxDelta = Math.max(maxDelta, delta);
    if (changedPixelSamples.length < 256) changedPixelSamples.push({
      x: x + view.x, y: y + view.y, delta,
      before: [...a.pixels.subarray(ai, ai + a.channels)],
      after: [...b.pixels.subarray(bi, bi + b.channels)],
    });
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    const tile = `${Math.floor(x / 64)},${Math.floor(y / 64)}`; tiles.set(tile, (tiles.get(tile) ?? 0) + 1);
    const sx = x + view.x, sy = y + view.y;
    if (sx >= 590 && sx <= 680 && sy >= 440 && sy <= 550) regions.employeeAnchor++;
    else if (sy <= 145) regions.topNavigation++;
    else if (sy >= 760) regions.bottomHelp++;
    else if (sx >= 1098 && sx <= 1328 && sy >= 608 && sy <= 782) regions.minimap++;
    else regions.remainingWorld++;
  }
  const bounds = changed ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
  return {
    changedPixels: changed, totalPixels: a.width * a.height, maxChannelDelta: maxDelta,
    boundsWithinCapture: bounds,
    boundsOnCanvas: bounds && { ...bounds, x: bounds.x + view.x, y: bounds.y + view.y },
    regions,
    changedPixelSamples,
    changedTiles: [...tiles.entries()].sort((aa, bb) => bb[1] - aa[1]).map(([key, count]) => {
      const [tx, ty] = key.split(',').map(Number);
      return { x: tx * 64 + view.x, y: ty * 64 + view.y, width: 64, height: 64, pixels: count };
    }),
  };
}
async function scalePoint(point) {
  const canvas = await page.locator('canvas').boundingBox();
  assert(canvas, 'Canvas has no visible bounds');
  return { x: canvas.x + point.x * canvas.width / 1600, y: canvas.y + point.y * canvas.height / 900 };
}
async function clickCanvas(point, options) {
  const p = await scalePoint(point); await page.mouse.click(p.x, p.y, options);
}
async function canvasClip(rect = view) {
  const canvas = await page.locator('canvas').boundingBox();
  assert(canvas, 'Canvas has no visible bounds');
  return {
    x: Math.round(canvas.x + rect.x * canvas.width / 1600),
    y: Math.round(canvas.y + rect.y * canvas.height / 900),
    width: Math.round(rect.width * canvas.width / 1600),
    height: Math.round(rect.height * canvas.height / 900),
  };
}
async function worldImage() { return page.screenshot({ clip: await canvasClip() }); }
async function checkpoint(name, detail) {
  const file = `${String(++serial).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  report.screenshots.push(file);
  report.checks.push({ name, detail, at: new Date().toISOString(), screenshot: file });
}
async function pause(wanted = true) {
  const button = page.locator('[data-action="pause"]');
  const text = await button.innerText();
  if ((text.includes('继续')) !== wanted) await page.keyboard.press('Space');
  await page.waitForFunction(wantedPause => {
    const label = document.querySelector('[data-action="pause"]')?.textContent ?? '';
    return wantedPause ? label.includes('继续') : label.includes('暂停');
  }, wanted);
}
async function stablePointer() {
  const p = await scalePoint({ x: 20, y: 882 });
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(500); // Let the throttled HUD and hover rendering settle.
}
async function layout(width, height) {
  const actual = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')?.getBoundingClientRect();
    return {
      width: innerWidth, height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      canvas: canvas && { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
    };
  });
  assert.equal(actual.width, width); assert.equal(actual.height, height);
  assert.equal(actual.scrollWidth, width, 'Page must not scroll horizontally');
  assert.equal(actual.scrollHeight, height, 'Page must not scroll vertically');
  assert(actual.canvas && Math.abs(actual.canvas.width - width) < 1 && Math.abs(actual.canvas.height - height) < 1, 'Canvas must scale with the 16:9 viewport');
  return actual;
}
async function noDevelopmentBridge() {
  const absent = await page.evaluate(() =>
    !['__facilityTest', '__sliceTest', '__containmentTest'].some(name => Object.prototype.hasOwnProperty.call(window, name)));
  assert.equal(absent, true, 'Production bundle must not expose development bridges');
  return absent;
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: browserArgs });
  context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() }); });
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith(`${origin}/`) && !url.startsWith('data:')) report.externalRequests.push(url);
    if (url.includes('/@vite/client') || url.includes('/src/main.ts')) report.developmentRequests.push(url);
  });
  const response = await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200, 'Production entry did not return HTTP 200');
  await page.locator('canvas').waitFor({ state: 'visible' });
  await page.locator('[data-employee="E06"]').waitFor();
  assert.equal(await page.locator('.facility-employee').count(), 6, 'Default sandbox needs six employees');
  report.productionBridgeAbsent = await noDevelopmentBridge();
  await pause(true); await stablePointer();
  report.initialLayout = await layout(1600, 900);
  await checkpoint('production-central-view', 'Production entry loaded six-person sandbox without a development bridge.');
  const central = await worldImage();

  await page.keyboard.press('Home'); await stablePointer();
  const overview = await worldImage();
  assert.notEqual(sha(overview), sha(central), 'Home did not change the displayed facility');
  await checkpoint('home-overview', 'Real Home key switches from the central view to the whole-facility view.');
  let previous = overview;
  for (const control of roomControls) {
    await clickCanvas(control); await stablePointer();
    await page.locator('#facility-room-status > small').filter({ hasText: control.id }).waitFor();
    const current = await worldImage();
    assert.notEqual(sha(current), sha(previous), `${control.id} navigation did not change the displayed world`);
    await checkpoint(`${control.id}-navigation`, `Clicked the fixed canvas navigation button for ${control.id}; matching room detail and a changed facility image are visible.`);
    previous = current;
  }

  await page.locator('[data-employee="E01"]').click();
  await page.locator('[data-employee="E01"].selected').waitFor();
  await page.keyboard.press('f'); await stablePointer();
  const focused = await worldImage();
  assert.notEqual(sha(focused), sha(previous), 'F did not focus the selected employee');
  // At zoom 1, the followed employee is fixed at the viewport center. E01 has
  // the documented constant visual lane (-45, 0); no runtime is queried.
  const ringRect = { x: view.x + view.width / 2 - 45 - 25, y: view.y + view.height / 2 + 90 - 6, width: 50, height: 15 };
  const focusedRing = selectedRingPixels(await page.screenshot({ clip: await canvasClip(ringRect) }));
  assert(focusedRing > 16, `The selected employee's world ring is not at the expected F-follow position (${focusedRing} pixels)`);
  await checkpoint('roster-selection-and-follow', { selected: 'E01', realKey: 'F', ringPixelsAtFollowAnchor: focusedRing });

  // E01 is still at the initial safe point because all preceding navigation was
  // paused before ambient wandering began. A real corridor click orders movement.
  const corridorNode = map.nodes.find(node => node.id === 'a-safe');
  const corridorDestination = { x: corridorNode.x + 100, y: corridorNode.y };
  const followCenter = { x: map.safePoint.x, y: map.safePoint.y - 90 };
  const corridorScreen = { x: view.x + view.width / 2 + corridorDestination.x - followCenter.x, y: view.y + view.height / 2 + corridorDestination.y - followCenter.y };
  await clickCanvas(corridorScreen, { button: 'right' });
  await page.locator('[data-employee="E01"] .employee-state').filter({ hasText: '移动中' }).waitFor();
  await pause(false); await page.waitForTimeout(1400); await stablePointer();
  const moving = await worldImage();
  const movingRing = selectedRingPixels(await page.screenshot({ clip: await canvasClip(ringRect) }));
  assert(movingRing > 16, `Following did not keep the moving employee at the screen anchor (${movingRing} pixels)`);
  assert.notEqual(sha(moving), sha(focused), 'No visible movement/camera change after a real move order');
  await checkpoint('follow-during-real-movement', { employee: 'E01', commandInput: 'Right mouse button on medical corridor', ringPixelsAtFollowAnchor: movingRing });

  await pause(true); await stablePointer();
  const clockBefore = await page.locator('#facility-clock').innerText();
  const frozenBefore = await worldImage();
  await page.waitForTimeout(700);
  const frozenAfter = await worldImage();
  await writeFile(`${output}/paused-before.png`, frozenBefore); await writeFile(`${output}/paused-after.png`, frozenAfter);
  const clockAfter = await page.locator('#facility-clock').innerText();
  report.screenshots.push('paused-before.png', 'paused-after.png');
  report.pausePixels = {
    identical: frozenBefore.equals(frozenAfter), before: sha(frozenBefore), after: sha(frozenAfter),
    clockBefore, clockAfter, pauseButton: await page.locator('[data-action="pause"]').innerText(),
    realWaitMs: 700, difference: pixelDifference(frozenBefore, frozenAfter),
  };
  if (!report.pausePixels.identical) {
    await page.waitForTimeout(700);
    const frozenThird = await worldImage();
    await writeFile(`${output}/paused-third.png`, frozenThird);
    report.screenshots.push('paused-third.png');
    report.pausePixels.additionalObservation = {
      clock: await page.locator('#facility-clock').innerText(),
      after: sha(frozenThird), differenceFromSecond: pixelDifference(frozenAfter, frozenThird),
    };
  }
  await writeFile(`${output}/pause-diagnostic.json`, JSON.stringify(report.pausePixels, null, 2));
  assert.equal(frozenBefore.equals(frozenAfter), true, 'Visible facility did not freeze after pause and UI settling');
  assert.equal(clockAfter, clockBefore, 'Visible clock advanced while paused');
  await checkpoint('paused-pixel-identical', report.pausePixels);

  // Exercise the public camera gestures while simulation stays paused.
  const wheelPoint = await scalePoint({ x: 680, y: 430 });
  await page.mouse.move(wheelPoint.x, wheelPoint.y); await page.mouse.wheel(0, 200); await stablePointer();
  const zoomed = await worldImage();
  assert.notEqual(sha(zoomed), sha(frozenAfter), 'Real mouse wheel did not change the facility zoom');
  const panA = await scalePoint({ x: 650, y: 440 }); const panB = await scalePoint({ x: 815, y: 485 });
  await page.mouse.move(panA.x, panA.y); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(panB.x, panB.y, { steps: 12 }); await page.mouse.up({ button: 'middle' }); await stablePointer();
  assert.notEqual(sha(await worldImage()), sha(zoomed), 'Real middle-button drag did not pan the facility');
  await checkpoint('wheel-and-middle-drag', 'Camera zoom and pan respond to actual mouse gestures while the paused clock remains stable.');
  assert.equal(await page.locator('#facility-clock').innerText(), clockBefore);

  await page.setViewportSize({ width: 1280, height: 720 }); await stablePointer();
  report.layout1280 = await layout(1280, 720);
  await page.locator('[data-action="toggle-details"]').click(); await stablePointer();
  assert.equal(await page.locator('#facility-details').isVisible(), false);
  await clickCanvas(roomControls[2]); await stablePointer();
  await checkpoint('1280-collapsed-room-navigation', 'Scaled canvas navigation remains clickable with the inspector collapsed and no page scrolling.');
  await page.locator('[data-action="toggle-details"]').click();
  await page.locator('#facility-room-status > small').filter({ hasText: 'N03' }).waitFor();
  await page.setViewportSize({ width: 1600, height: 900 }); await stablePointer();
  report.returnedLayout1600 = await layout(1600, 900);
  await checkpoint('returned-to-1600', 'Restored 1600×900 after the 1280×720 layout check.');

  await page.goto(`${origin}/?mode=campaign`, { waitUntil: 'networkidle' });
  await page.locator('[data-action="start"]').waitFor();
  assert.equal(await page.locator('.facility-employee').count(), 4, 'Formal day one must begin with four employees');
  assert.match(await page.locator('#facility-day').innerText(), /DAY 01/);
  await noDevelopmentBridge();
  await checkpoint('formal-day-one-preparation', 'Production campaign begins at day one with exactly four personnel.');
  await page.locator('[data-action="start"]').click();
  await page.locator('[data-action="pause"]').filter({ hasText: '暂停' }).waitFor();
  await page.waitForFunction(() => {
    const clock = document.querySelector('#facility-clock')?.textContent?.trim();
    return Boolean(clock && clock !== '00:00');
  }, null, { timeout: 15000 });
  assert.notEqual((await page.locator('#facility-clock').innerText()).trim(), '00:00', 'Formal day clock did not start');
  await pause(true); await stablePointer();
  assert.equal(await page.locator('.facility-employee').count(), 4);
  assert.equal(await page.locator('[data-action="start"]').count(), 0);
  await checkpoint('formal-day-one-started', 'Real start button advanced the formal day clock; all four personnel remain present.');

  assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.failedRequests, []); assert.deepEqual(report.httpErrors, []); assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.developmentRequests, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.reason = error.stack ?? String(error); process.exitCode = 1;
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: `${output}/failure-state.png` }); report.screenshots.push('failure-state.png'); }
    catch (captureError) { report.failureScreenshotError = String(captureError); }
  }
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString(); report.ownedBrowserClosed = true;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ directory: output, ...report }, null, 2));
}
