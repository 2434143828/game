import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch {
  sharp = require('C:/Users/SEASUN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'art-production/abnormalities-manifest.json'), 'utf8'));
const jobs = manifest.jobs.filter(job => /_0[134]$/.test(job.rowId));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const problems = [];
const rows = [];
for (const job of jobs) {
  const expectedName = job.row.name + '_' + job.unit.suffix + '.png';
  const row = { id: job.id, file: job.file, runtimePart: job.rowId.endsWith('_04'), generated: job.status === 'generated', inspected: job.visualReview?.status === 'inspected' };
  if (job.file !== expectedName) problems.push(`${job.id}: filename differs from Excel unit`);
  if (!row.generated) { problems.push(`${job.id}: generation missing`); rows.push(row); continue; }
  if (!row.inspected) problems.push(`${job.id}: visual inspection pending`);
  try {
    const [source, raw, runtime] = await Promise.all([fs.readFile(job.sourcePath), fs.readFile(job.rawPath), fs.readFile(job.runtimePath)]);
    row.sourceSha256 = hash(source); row.rawSha256 = hash(raw); row.runtimeSha256 = hash(runtime);
    row.originalPreserved = row.sourceSha256 === row.rawSha256;
    if (!row.originalPreserved) problems.push(`${job.id}: original copy changed`);
    const { data, info } = await sharp(runtime).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minAlpha = 255, maxAlpha = 0, clear = 0;
    for (let i = 3; i < data.length; i += 4) { const a = data[i]; minAlpha = Math.min(minAlpha, a); maxAlpha = Math.max(maxAlpha, a); if (a === 0) clear++; }
    row.runtimeAlpha = { width: info.width, height: info.height, minAlpha, maxAlpha, transparentFraction: clear / (info.width * info.height) };
    if (minAlpha !== 0 || maxAlpha < 200) problems.push(`${job.id}: unsuitable alpha range`);
    row.sourcePath = job.sourcePath; row.rawPath = job.rawPath; row.runtimePath = job.runtimePath;
    row.technicalProcess = job.runtimeProcess;
    if (job.sourceCrop) row.sourceCrop = job.sourceCrop;
  } catch (error) { problems.push(`${job.id}: ${String(error)}`); }
  rows.push(row);
}
if (jobs.length !== 68) problems.push(`Expected 68 owned units, got ${jobs.length}`);
if (new Set(jobs.map(job => job.file)).size !== jobs.length) problems.push('Duplicate filenames');
const report = {
  scope: '10 calm/breach identity approvals + 58 runtime cutout components; 49 action references delegated separately',
  expected: 68, generated: rows.filter(row => row.generated).length, inspected: rows.filter(row => row.inspected).length,
  runtimeParts: rows.filter(row => row.runtimePart).length, originalsPreserved: rows.filter(row => row.originalPreserved).length,
  status: problems.length ? 'INCOMPLETE' : 'PASS', problems, units: rows,
  limitations: ['This checks asset provenance, coverage, filenames and transparent PNGs. It does not replace actual in-game assembly, animation, input or pause verification.', 'Approval illustrations and action references are not runtime animation frames.'],
};
await fs.writeFile(path.join(root, 'art-production/abnormalities-coverage.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ status: report.status, expected: report.expected, generated: report.generated, inspected: report.inspected, runtimeParts: report.runtimeParts, originalsPreserved: report.originalsPreserved, problems }));
if (problems.length) process.exitCode = 1;
