import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch {
  sharp = require('C:/Users/SEASUN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root, 'art-production/abnormalities-manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const records = path.join(root, 'art-production/abnormalities-records');
const byId = new Map(manifest.jobs.map(j => [j.id, j]));
for (const file of (await fs.readdir(records).catch(() => [])).sort()) {
  if (!file.endsWith('.json')) continue;
  const record = JSON.parse(await fs.readFile(path.join(records, file), 'utf8'));
  byId.set(record.id, { ...byId.get(record.id), ...record });
}
manifest.jobs = [...byId.values()];
const reviews = JSON.parse(await fs.readFile(path.join(root, 'art-production/abnormalities-visual-reviews.json'), 'utf8').catch(() => '{}'));
const rawDir = path.join(root, 'art-production/generated/abnormalities');
const runtimeDir = path.join(root, 'public/art/generated/abnormalities');
await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(runtimeDir, { recursive: true });
for (const job of manifest.jobs) {
  if (job.status !== 'generated') continue;
  const rawPath = path.join(rawDir, job.file);
  await fs.copyFile(job.sourcePath, rawPath);
  job.rawPath = rawPath;
  const { data, info } = await sharp(rawPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1, minAlpha = 255, maxAlpha = 0;
  let transparent = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const a = data[(y * info.width + x) * 4 + 3];
    minAlpha = Math.min(minAlpha, a); maxAlpha = Math.max(maxAlpha, a);
    if (a === 0) transparent++;
    if (a > 16) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }
  job.alphaQa = { size: [info.width, info.height], minAlpha, maxAlpha, transparentFraction: transparent / (info.width * info.height) };
  if (minAlpha !== 0 || maxX < minX) throw new Error(`Missing transparent cutout: ${job.id}`);
  // The approved cat foot sources include surplus upper-leg overlap. Retain the ankle/foot
  // portion by rectangular crop only; preserve the original source without pixel alteration.
  if (job.id === 'ABN_N02_04__hind_foot_left' || job.id === 'ABN_N02_04__hind_foot_right') {
    minY += Math.floor((maxY - minY + 1) * 0.72);
    minX = info.width; maxX = -1;
    for (let y = minY; y <= maxY; y++) for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 16) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    job.sourceCrop = { mode: 'retain-lower-alpha-bounds', fraction: 0.28, reason: 'Discard surplus upper-leg overlap; retain the requested ankle and paw.' };
  }
  const left = Math.max(0, minX - 3), top = Math.max(0, minY - 3);
  const width = Math.min(info.width - left, maxX - left + 4);
  const height = Math.min(info.height - top, maxY - top + 4);
  job.trim = { left, top, width, height, boundsAlphaThreshold: 16 };
  job.runtimePath = path.join(runtimeDir, job.file);
  await sharp(rawPath).extract({ left, top, width, height }).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).png().toFile(job.runtimePath);
  job.runtimeProcess = 'Alpha-bounds crop and proportional downsample only; original image preserved unchanged.';
  job.url = '/art/generated/abnormalities/' + job.file;
  if (reviews[job.id]?.sourcePath === job.sourcePath) job.visualReview = reviews[job.id];
}
manifest.scope = { ownedUnits: 68, delegatedReferenceUnits: 49, delegatedOwner: 'game_tests', referenceDirectory: 'art-production/generated/abnormalities-references' };
manifest.generated = manifest.jobs.filter(j => j.status === 'generated').length;
manifest.inspected = manifest.jobs.filter(j => j.visualReview?.status === 'inspected').length;
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(JSON.stringify({ requested: manifest.requested, generated: manifest.generated, inspected: manifest.inspected }));
