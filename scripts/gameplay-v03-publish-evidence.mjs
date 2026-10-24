import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const run='docs/gameplay-v03-evidence/run-2026-10-23T13-02-39.302Z';
const production=process.argv[2]??'docs/gameplay-v03-evidence/production-2026-10-23T13-24-12.513Z';
const files={
 'gameplay-v03-facility.png':`${production}/01-default-v3-facility.png`,
 'gameplay-v03-combat.png':'docs/gameplay-v03-evidence/visual-polish/separated-target-labels.png',
 'gameplay-v03-rank-II.png':`${run}/08-rank-II-production.png`,
 'gameplay-v03-cat-capture.png':`${run}/11-cat-result.png`,
 'gameplay-v03-two-rooms.png':`${run}/12-new-room-passive-production.png`,
};
const screenshots=[];
for(const [file,source] of Object.entries(files)){
 await copyFile(source,`docs/showcase/${file}`);
 const sha256=createHash('sha256').update(await readFile(source)).digest('hex');
 screenshots.push({file,source,sha256});
}
const report=JSON.parse(await readFile(`${run}/report.json`,'utf8'));
const summary={status:'P1_P2_VERIFIED_NOT_FULL_GAME_ACCEPTANCE',functionalReport:`${run}/report.json`,functionalChecks:report.checks,inputCount:report.inputs.length,productionReport:`${production}/report.json`,stabilityReport:'docs/gameplay-v03-evidence/stability/result.json',saveReport:'docs/gameplay-v03-evidence/save-reload/report.json',offlineReport:'docs/gameplay-v03-evidence/offline/report.json',limits:['All five objects and ranks not played through in browser','Card illustrations are glyph placeholders','Labels polished after continuous run and separately tested'],screenshots};
await writeFile('docs/showcase/gameplay-v03-verification-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(`Copied ${screenshots.length} authentic screenshots and evidence summary.`);
