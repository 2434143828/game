import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const output = `docs/gameplay-v03-evidence/cards-art-${new Date().toISOString().replaceAll(':', '-')}`;
const config = JSON.parse(await readFile('config/gameplay-v3.json', 'utf8'));
const groups = ['T', 'N01', 'N02', 'N03', 'N04', 'N05'];
const expected = Object.keys(config.cards).sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assetHashes = await Promise.all(expected.map(async id => ({ id, sha256: hash(await readFile(`public/art/cards-v1/${id.toLowerCase()}.png`)) })));
assert.equal(expected.length, 18);
assert.equal(new Set(assetHashes.map(a => a.sha256)).size, 18, 'Each card must have its own image');
await mkdir(output, { recursive: true });
const report = {
  status: 'RUNNING',
  boundary: 'Six explicitly labelled DEV no-save art fixtures. Initial equipment, unlocks and hands are fixture setup; all targeting, queueing, movement, windup, cast and pause use native game input and real simulation. Not a campaign unlock proof. No state/time/damage injected by browser script.',
  assetHashes, assets: [], checks: [], inputs: [], shots: [], errors: [], storageCalls: [],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.exposeFunction('__reportCardStorage', entry => report.storageCalls.push(entry));
await context.addInitScript(() => {
  const proto = Storage.prototype, originals = Object.fromEntries(['getItem', 'setItem', 'removeItem', 'clear', 'key'].map(key => [key, proto[key]]));
  originals.setItem.call(localStorage, 'cards-art-sentinel', 'existing-save-must-survive');
  window.__cardStorageCalls = [];
  for (const key of Object.keys(originals)) proto[key] = function (...args) {
    const entry = { method: key, key: args[0], url: location.href };
    window.__cardStorageCalls.push(entry); void window.__reportCardStorage(entry);
    return originals[key].apply(this, args);
  };
  window.__cardReadSentinel = () => originals.getItem.call(localStorage, 'cards-art-sentinel');
});
let page;
const read = () => page.evaluate(() => structuredClone(window.__v3Test.simulation.state));
const view = () => page.evaluate(() => window.__v3Test.scene.getViewState());
const click = async selector => { report.inputs.push({ type: 'click', url: page.url(), selector }); await page.locator(selector).click(); };
const shot = async name => {
  await page.screenshot({ path: `${output}/${name}.png` });
  report.shots.push({ name, state: await read(), view: await view() }); console.log(name);
};
const storage = async group => {
  assert.deepEqual(await page.evaluate(() => window.__cardStorageCalls), []);
  assert.equal(await page.evaluate(() => window.__cardReadSentinel()), 'existing-save-must-survive');
  report.checks.push({ group, check: 'No storage API calls; sentinel untouched' });
};
const freeze = async group => {
  await page.waitForTimeout(100);
  const state = await read(), visual = await view(), screenshot = hash(await page.screenshot());
  await page.waitForTimeout(600);
  assert.deepEqual(await read(), state, 'Paused simulation changed');
  assert.deepEqual(await view(), visual, 'Paused scene targeting, actors or card effects changed');
  assert.equal(hash(await page.screenshot()), screenshot, 'Paused screenshot changed without input');
  report.checks.push({ group, check: 'Paused simulation, scene evidence and exact screenshot frozen for 600 ms' });
};
try {
  for (const group of groups) {
    page = await context.newPage();
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
    const url = new URL(process.env.FACILITY_URL ?? 'http://127.0.0.1:4173/'); url.searchParams.set('cardArtPreview', group);
    await page.goto(url.href, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__v3Test?.scene.getViewState().employees?.length === 3);
    assert.match(await page.locator('#v3-field-preview').textContent(), /卡牌美术 调试预览，不保存进度/);
    const initial = await read(), hand = initial.encounter.deck.hand;
    assert.equal(hand.length, 3); assert.equal(initial.timeScale, 0); assert.equal(initial.encounter.mode, 'CAPTURE');
    const definitions = expected.filter(id => group === 'T' ? id.startsWith('T') : id.startsWith(`${group}_`));
    assert.deepEqual(hand.map(c => c.cardId).sort(), definitions);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-v3="card"] .v3-card-art img')].every(img => img.complete && img.naturalWidth > 0));
    const assets = await page.locator('[data-v3="card"] .v3-card-art img').evaluateAll(images => images.map(img => ({
      id: img.closest('[data-card-id]').dataset.cardId, url: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight,
    })));
    for (const asset of assets) { assert(asset.width >= 512 && asset.height >= 512); assert.match(asset.url, /\/art\/cards-v1\//); }
    report.assets.push(...assets);
    await page.mouse.move(1200, 90); await shot(`${group}-01-three-illustrations`); await freeze(`${group}-entry`); await storage(`${group}-entry`);
    const card = hand[0], definition = config.cards[card.cardId];
    await click(`[data-v3="card"][data-id="${card.instanceId}"]`);
    await page.mouse.move(1200, 90);
    if (definition.target === 'ENEMY' || definition.target === 'ALLY') {
      await page.waitForFunction(id => window.__v3Test.scene.getViewState().cards?.targeting?.cardId === id, card.cardId);
      const targeting = (await view()).cards.targeting;
      assert.equal(targeting.ownerId, card.ownerId); assert.equal(targeting.rangePx, definition.rangePx);
      assert(targeting.targetIds.length > 0); await shot(`${group}-02-valid-targets`);
      report.checks.push({ group, check: 'Selected owner and valid targets use actual card state', targeting });
      const target = definition.target === 'ENEMY' ? initial.encounter.enemies.find(e => !e.isClone) : initial.employees.find(e => e.id === card.ownerId);
      const point = await page.evaluate(({ id, enemy }) => enemy ? window.__v3Test.scene.getEnemyTargetPoint(id) : window.__v3Test.scene.getEmployeeScreenPoint(id), { id: target.id, enemy: definition.target === 'ENEMY' });
      const bounds = await page.locator('canvas').boundingBox(); assert(point && bounds);
      report.inputs.push({ type: 'canvas-target', group, targetId: target.id, point });
      await page.mouse.click(bounds.x + point.x * bounds.width / 1600, bounds.y + point.y * bounds.height / 900);
    }
    assert.equal((await read()).encounter.deck.pendingCast?.instanceId, card.instanceId);
    await page.mouse.move(1200, 90); await shot(`${group}-03-native-paused-queue`); await freeze(`${group}-queue`);
    await click('[data-v3="pause"]');
    await page.waitForFunction(id => window.__v3Test.simulation.state.logs.some(e => e.kind === 'CARD' && e.instanceId === id), card.instanceId, { timeout: 15000, polling: 10 });
    await click('[data-v3="pause"]'); await page.mouse.move(1200, 90);
    const after = await read(), rendered = await view();
    const events = after.logs.filter(e => e.kind === 'CARD' && e.instanceId === card.instanceId);
    assert.equal(events.length, 1); assert.equal(events[0].cardId, card.cardId); assert.equal(events[0].sourceId, card.ownerId);
    assert(events[0].sourcePoint && events[0].targetPoint);
    assert(after.encounter.deck.discardPile.some(c => c.instanceId === card.instanceId));
    assert(after.encounter.deck.globalCooldown > 0);
    assert(rendered.cards.casts.some(c => c.eventId === events[0].id && c.cardId === card.cardId), 'Successful card has no live scene effect');
    assert(after.simulationTimeSec > initial.simulationTimeSec);
    assert.notDeepEqual(after.employees.find(e => e.id === card.ownerId).location, initial.employees.find(e => e.id === card.ownerId).location, 'Owner did not approach actual target');
    await shot(`${group}-04-successful-cast-impact`); await freeze(`${group}-impact`); await storage(`${group}-cast`);
    report.checks.push({ group, check: 'Native queued cast executed once after real approach; exact CARD metadata drives scene effect', event: events[0], cardEffects: rendered.cards, cooldown: after.encounter.deck.globalCooldown });
    await page.setViewportSize({ width: 1280, height: 720 }); await page.mouse.move(1000, 60);
    for (const box of await page.locator('[data-v3="card"]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))) {
      assert(box.left >= 0 && box.right <= 1280 && box.bottom <= 720);
    }
    await shot(`${group}-05-1280-impact-layout`);
    report.checks.push({ group, check: 'Cards remain inside viewport at 1280 × 720' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__v3Test?.simulation.state.encounter?.deck.hand.length === 3);
    assert.equal((await read()).simulationTimeSec, 0); assert.equal((await read()).encounter.result, null);
    await storage(`${group}-reload`); await page.close();
  }
  assert.deepEqual(report.assets.map(asset => asset.id).sort(), expected);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.storageCalls, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.reason = String(error.stack ?? error);
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  await context.close(); await browser.close(); await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, status: report.status, assets: report.assets.length, checks: report.checks.length, reason: report.reason }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
