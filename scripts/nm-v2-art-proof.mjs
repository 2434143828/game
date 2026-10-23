import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

// Real input and elapsed simulation only. The DEV bridge below is observation-only.
const url=process.env.FACILITY_URL??'http://127.0.0.1:4173/';
const output=`${process.env.FACILITY_EVIDENCE_ROOT??'docs/nm-v2-evidence-2026-10-23'}/run-${new Date().toISOString().replaceAll(':','-')}`;
await mkdir(output,{recursive:true});
const report={status:'RUNNING',url,output,method:'Real Chrome input, live simulation, read-only state observation. No injected commands, clocks, resources or poses.',errors:[],consoleErrors:[],httpErrors:[],failedRequests:[],inputs:[],checks:[],screenshots:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:`${output}/video`,size:{width:1600,height:900}}});
const page=await context.newPage();let serial=0;
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text())});
page.on('requestfailed',r=>report.failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()})});
const read=()=>page.evaluate(()=>{
 const {controller,scene}=window.__facilityTest,s=controller.state;
 return {time:s.simulationTimeSec,timeScale:s.timeScale,phase:s.phase,mode:controller.mode,wallet:s.progress.wallet,produced:s.producedToday,
   selected:[...controller.selected],employees:structuredClone(s.employees),rooms:structuredClone(s.rooms),enemies:structuredClone(s.enemies),
   events:structuredClone(controller.events),logs:structuredClone(s.logs),animation:scene.getAnimationState(),art:scene.getGeneratedArtState(),camera:scene.getCameraState()};
});
const click=async(selector)=>{report.inputs.push({at:new Date().toISOString(),action:'dom_click',selector});await page.locator(selector).click()};
const key=async(value)=>{report.inputs.push({at:new Date().toISOString(),action:'key',value});await page.keyboard.press(value)};
const canvasClick=async(point,button='left')=>{assert(point&&Number.isFinite(point.x)&&Number.isFinite(point.y));const r=await page.locator('canvas').boundingBox();report.inputs.push({at:new Date().toISOString(),action:'canvas_click',point,button});await page.mouse.click(r.x+point.x*r.width/1600,r.y+point.y*r.height/900,{button})};
const pause=async(wanted)=>{if(((await read()).timeScale===0)!==wanted)await click('[data-action="pause"]');await page.waitForFunction(w=>(window.__facilityTest.controller.state.timeScale===0)===w,wanted)};
const restart=async()=>{await click('[data-action="restart"]');await click('[data-action="confirm-restart"]');await pause(true)};
const control=async(id)=>canvasClick(await page.evaluate(id=>window.__facilityTest.scene.getCameraControls().rooms[id],id));
const shot=async(label)=>{await page.mouse.move(15,885);await page.waitForTimeout(180);const file=`${String(++serial).padStart(2,'0')}-${label}.png`;await page.screenshot({path:`${output}/${file}`});const s=await read();report.screenshots.push({label,file,state:s});console.log(JSON.stringify({checkpoint:label,time:s.time}));return s};
const check=(name,details)=>report.checks.push({name,details});
const wait=async(fn,arg,timeout=60000)=>page.waitForFunction(fn,arg,{polling:50,timeout});
const freezeComparable=s=>({time:s.time,employees:s.employees,enemies:s.enemies,rooms:s.rooms,produced:s.produced,art:s.art});
try{
 await page.goto(url,{waitUntil:'networkidle'});
 await wait(()=>window.__facilityTest?.scene.getEmployeeScreenPoint('E01'));
 await pause(true);
 const opening=await shot('default-generated-facility');
 assert.equal(opening.art.environmentComplete,true);
 assert.deepEqual(opening.art.loadErrors,[]);
 assert.equal(opening.art.personnel.length,6);
 assert.equal(opening.rooms.length,5); report.artCoverage=opening.art.coverage; report.creatureReadiness=opening.art.creatureReadiness;
 report.assetDelivery=opening.art.coverage.pending.length===0?'COMPLETE':'INCOMPLETE';
 report.artAcceptance='REQUIRES_VISUAL_REVIEW'; // Input checks alone cannot certify art quality.
 assert.equal(opening.art.coverage.runtimeAvailable,opening.art.coverage.runtimeExpected);
 assert.equal(opening.art.creatures.length,5,'Every abnormality must use its generated rig');
 assert(Object.keys(opening.art.environmentUsage).length>=60,'All environment modules must have actual placement uses');
 check('runtime-loads',{staff:6,actualRooms:5,generatedCreatures:opening.art.creatures.length,modules:Object.keys(opening.art.environmentUsage).length});
 const before=await read();await page.waitForTimeout(700);assert.deepEqual(freezeComparable(await read()),freezeComparable(before));check('paused-art-is-frozen',true);
 await key('Home');await shot('whole-generated-facility');
 // Select actual employee body, then change a real route halfway through travel.
 await click('[data-employee="E01"]');await key('f');
 await canvasClick(await page.evaluate(()=>window.__facilityTest.scene.getEmployeeScreenPoint('E01')));
 assert((await read()).selected.includes('E01'));
 await key('Home');
 const destinations=[{x:1750,y:850},{x:2050,y:850}];
 await canvasClick(await page.evaluate(p=>window.__facilityTest.scene.getCorridorScreenPoint({...p,y:p.y-25}),destinations[0]),'right');
 const start=await read();await click('[data-action="speed2"]');await pause(false);
 await wait(p=>{const e=window.__facilityTest.controller.state.employees[0];return Math.hypot(e.location.x-p.x,e.location.y-p.y)>100},start.employees[0].location);
 await pause(true);await key('f');const moving=await shot('moving-before-order-change');
 assert.equal(moving.employees[0].order.kind,'MOVE');
 const frozen=await read();await key('Home');
 await canvasClick(await page.evaluate(p=>window.__facilityTest.scene.getCorridorScreenPoint({...p,y:p.y-25}),destinations[1]),'right');
 await page.waitForTimeout(650);const changed=await read();
 assert.equal(changed.time,frozen.time);assert.deepEqual(changed.employees[0].location,frozen.employees[0].location);
 assert.notDeepEqual(changed.employees[0].order,frozen.employees[0].order);
 await pause(false);await wait(p=>{const e=window.__facilityTest.controller.state.employees[0];return Math.hypot(e.location.x-p.x,e.location.y-p.y)<3},destinations[1]);
 await pause(true);await key('s');await key('f');await shot('arrived-after-order-change');
 check('mid-move-pause-and-change',{before:moving.employees[0].order,after:changed.employees[0].order,destination:destinations[1]});
 // Work is dispatched through the room menu. Observe travel then actual execution.
 await control('N01');await canvasClick(await page.evaluate(()=>window.__facilityTest.scene.getRoomClickPoint('N01')));
 await canvasClick(await page.evaluate(()=>window.__facilityTest.scene.getWorkChoicePoint('OBSERVE')));
 const dispatch=await read();assert.equal(dispatch.rooms.find(r=>r.anomalyId==='N01').work?.phase,'TRAVELLING');
 await pause(false);await wait(()=>window.__facilityTest.controller.state.rooms.find(r=>r.anomalyId==='N01').work?.phase==='EXECUTING');
 await pause(true);await control('N01');const working=await shot('employee-inside-room-working');
 assert.equal(working.employees[0].status,'WORKING');
 const workFreeze=await read();await page.waitForTimeout(650);assert.deepEqual(freezeComparable(await read()),freezeComparable(workFreeze));
 check('arrive-before-work',{dispatch:dispatch.rooms.find(r=>r.anomalyId==='N01').work,execution:working.rooms.find(r=>r.anomalyId==='N01').work});
 await pause(false);await wait(()=>window.__facilityTest.controller.state.producedToday>0);await pause(true);
 await shot('actual-work-energy');
 // Existing debug breach button, real three enemy entities, canvas target, real attacks.
 await control('N01');await click('[data-action="breach"]');await pause(true);
 const breached=await shot('nailong-main-and-two-clones');
 assert.equal(breached.enemies.filter(e=>e.sourceAnomalyId==='N01').length,3);
 const main=breached.enemies.find(e=>e.sourceAnomalyId==='N01'&&!e.isClone);
 await click('[data-employee="E01"]');await canvasClick(await page.evaluate(id=>window.__facilityTest.scene.getEnemyScreenPoint(id),main.id),'right');
 const ordered=await read();check('canvas-suppression-order',ordered.employees[0]);assert.equal(ordered.employees[0].order.kind,'SUPPRESS');
 await pause(false);await wait(id=>{const e=window.__facilityTest.controller.state.enemies.find(e=>e.id===id);return e&&e.suppressionHp<e.suppressionHpMax},main.id);
 await pause(true);await key('f');const combat=await shot('actual-suppression-hit');
 check('suppression-real-damage',{enemy:combat.enemies.find(e=>e.id===main.id),employee:combat.employees[0]});
 const combatFreeze=await read();await page.waitForTimeout(700);assert.deepEqual(freezeComparable(await read()),freezeComparable(combatFreeze));
 await key('r');const retreatOrder=await read();assert.equal(retreatOrder.employees[0].order.kind,'RETREAT');
 await pause(false);await wait(loc=>{const e=window.__facilityTest.controller.state.employees[0];return e.order.kind==='RETREAT'&&Math.hypot(e.location.x-loc.x,e.location.y-loc.y)>80},retreatOrder.employees[0].location);
 await pause(true);await key('f');await shot('retreating-after-suppression');
 check('continuous-sequence',true);
 // Other four default/breach silhouettes are inspected in fresh sandbox state through UI reset.
 for(const id of ['N02','N03','N04','N05']){
   await restart();await control(id);
   const calm=await shot(`${id}-calm`);assert(calm.rooms.some(r=>r.anomalyId===id && r.mode==='CONTAINED'));
   await click('[data-action="breach"]');await pause(true);const breach=await shot(`${id}-breached`);
   assert(breach.enemies.some(e=>e.sourceAnomalyId===id));assert(breach.art.creatureReadiness.some(c=>c.id===id));
 }
 await restart();
 await click('.facility-toolbar [data-action="archives"]');await shot('generated-archive-ui');
 await click('.facility-dialog > header [data-action="close"]');
 await page.setViewportSize({width:1280,height:720});await click('[data-action="toggle-details"]');await key('Home');await shot('1280-generated-facility');
 const layout=await page.evaluate(()=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight}));assert.deepEqual(layout,{w:1280,h:720,sw:1280,sh:720});
 check('1280-no-page-overflow',layout);
 assert.equal(report.errors.length+report.consoleErrors.length+report.httpErrors.length+report.failedRequests.length,0);
 report.status='PASS';
}catch(e){report.status='FAIL';report.reason=String(e.stack??e);report.failureState=await read().catch(()=>null);await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});}
finally{await context.close();await browser.close();report.finishedAt=new Date().toISOString();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,reason:report.reason,checks:report.checks.length}));if(report.status!=='PASS')process.exitCode=1;}
