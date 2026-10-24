import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sourceDirectory='C:/Users/SEASUN/.codex/generated_images/01a144a7-9b8e-7ec0-91c1-cb1e9446d500/';
const rows=[
 ['N01','n01-mall.png','商场中庭亲子活动区','exec-9c15ae90-fb29-47a6-8a51-87bd11ad0700.png'],
 ['N02','n02-community.png','老旧居民区棋牌室外','exec-08e24c24-0369-442d-8559-4da28a146ab3.png'],
 ['N03','n03-pet-park.png','城市宠物公园直播草坪','exec-69238a2b-8951-4837-a37f-fee1bc4ce12e.png'],
 ['N04','n04-transit.png','地铁连通广播区','exec-dd64b4a4-4e29-496d-ba13-7a2aec0159b6.png'],
 ['N05','n05-nursery.png','商场母婴儿童角','exec-7321d634-84e3-4db3-a7a2-dfb3572023ef.png'],
];
const assets=[];
for(const [id,file,theme,source] of rows){
 const path=`public/art/field-v1/${file}`,data=await readFile(path);
 assets.push({id,path,theme,width:data.readUInt32BE(16),height:data.readUInt32BE(20),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),originalGeneratedPath:sourceDirectory+source});
}
await writeFile('art-production/field-v1/manifest.json',JSON.stringify({tool:'built-in image_gen',prompts:'art-production/field-v1/prompts.json',generation:'Five separate original PNGs. Copied unchanged; no image editing after generation.',runtime:'CAPTURE chooses target anomaly theme; actors, cards, damage, warnings and animated pollution rendered separately from real simulation state.',assets},null,2)+'\n');
const evidence='docs/gameplay-v03-evidence/field-art-2026-10-23T14-14-15.981Z';
const report=JSON.parse(await readFile(`${evidence}/report.json`,'utf8'));
const screenshots=[];
for(const [id] of rows){
 const source=`${evidence}/${id}-04-enemy-windup-pollution.png`,path=`docs/showcase/field-v1-${id.toLowerCase()}.png`;
 await copyFile(source,path);screenshots.push({path,source,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
}
const normal='docs/gameplay-v03-evidence/run-2026-10-23T14-17-47.136Z';
const normalSource=`${normal}/11-cat-card-interrupt.png`,normalPath='docs/showcase/field-v1-community-live-capture.png';
await copyFile(normalSource,normalPath);screenshots.push({path:normalPath,source:normalSource,sha256:createHash('sha256').update(await readFile(normalPath)).digest('hex')});
const normalReport=JSON.parse(await readFile(`${normal}/report.json`,'utf8'));
await writeFile('docs/showcase/field-v1-verification-summary.json',JSON.stringify({status:report.status,boundary:report.boundary,checks:report.checks,errors:report.errors,storageCalls:report.storageCalls,report:`${evidence}/report.json`,normalCampaign:{report:`${normal}/report.json`,checks:normalReport.checks,fieldTransitions:normalReport.shots.filter(s=>['04-three-staff-nine-cards','10-cat-capture-entry','12-new-room-passive-production'].includes(s.name)).map(s=>({shot:s.name,field:s.view.field}))},productionReport:'docs/gameplay-v03-evidence/production-2026-10-23T14-25-51.968Z/report.json',screenshots},null,2)+'\n');
console.log(JSON.stringify({assets:assets.length,screenshots:screenshots.length,totalBytes:assets.reduce((n,a)=>n+a.bytes,0),dimensions:assets.map(a=>[a.id,a.width,a.height])}));
