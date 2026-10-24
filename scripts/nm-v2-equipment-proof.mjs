import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const output=`${process.env.FACILITY_EVIDENCE_ROOT??'docs/nm-v2-evidence-2026-10-23'}/equipment-${new Date().toISOString().replaceAll(':','-')}`;
await mkdir(output,{recursive:true});
const report={status:'RUNNING',method:'Native inputs and real work earnings. No injected state, commands, resources or time.',inputs:[],checks:[],screenshots:[],errors:[],httpErrors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:`${output}/video`,size:{width:1600,height:900}}});
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)report.httpErrors.push(r.url())});
const read=()=>page.evaluate(()=>{const {controller:c,scene}=window.__facilityTest;return {time:c.state.simulationTimeSec,timeScale:c.state.timeScale,wallet:c.state.progress.wallet,produced:c.state.producedToday,employees:structuredClone(c.state.employees),rooms:structuredClone(c.state.rooms),logs:structuredClone(c.state.logs),art:scene.getGeneratedArtState()}});
const click=async selector=>{report.inputs.push({type:'dom',selector});await page.locator(selector).click()};
const key=async value=>{report.inputs.push({type:'key',value});await page.keyboard.press(value)};
const canvas=async(point,button='left')=>{const r=await page.locator('canvas').boundingBox();report.inputs.push({type:'canvas',point,button});await page.mouse.click(r.x+point.x*r.width/1600,r.y+point.y*r.height/900,{button})};
const pause=async wanted=>{if(((await read()).timeScale===0)!==wanted)await click('[data-action="pause"]')};
const wait=async fn=>page.waitForFunction(fn,null,{polling:100,timeout:100000});
const close=()=>click('.facility-dialog > header [data-action="close"]');
const shot=async name=>{await page.mouse.move(10,885);await page.waitForTimeout(150);await page.screenshot({path:`${output}/${name}.png`});report.screenshots.push({name,state:await read()});console.log(JSON.stringify({shot:name}))};
try{
 await page.goto(process.env.FACILITY_URL??'http://127.0.0.1:4173/',{waitUntil:'networkidle'});await wait(()=>window.__facilityTest?.scene.getEmployeeScreenPoint('E01'));await pause(true);
 const opening=await read();assert.equal(opening.art.environmentComplete,true);assert.deepEqual(opening.art.loadErrors,[]);
 await click('[data-action="speed2"]');await pause(true);
 for(let round=0;round<4;round++){
  for(let i=1;i<=5;i++){
   const id=`N0${i}`;await click(`[data-employee="E0${i}"]`);
   await canvas(await page.evaluate(id=>window.__facilityTest.scene.getCameraControls().rooms[id],id));
   await canvas(await page.evaluate(id=>window.__facilityTest.scene.getRoomClickPoint(id),id));
   await canvas(await page.evaluate(()=>window.__facilityTest.scene.getWorkChoicePoint('OBSERVE')));
  }
  assert.equal((await read()).rooms.filter(r=>r.work).length,5);
  await pause(false);await wait(()=>window.__facilityTest.controller.state.rooms.every(r=>!r.work));await pause(true);
  const result=await read();assert(result.rooms.every(r=>r.mode==='CONTAINED'));assert(result.employees.every(e=>e.status!=='INCAPACITATED'&&e.status!=='PANICKED'));
  report.checks.push({name:`five-real-work-round-${round+1}`,time:result.time,wallet:result.wallet,produced:result.produced});
 }
 assert((await read()).wallet>=285);
 await click('[data-action="select-all"]');await key('r');await pause(false);
 await wait(()=>window.__facilityTest.controller.state.employees.every(e=>e.location.zone==='SAFE'&&e.status==='IDLE'));await pause(true);
 for(let i=1;i<=5;i++){
  await click('.facility-toolbar [data-action="archives"]');await click(`[data-archive-room="N0${i}"]`);await click('[data-purchase="BEHAVIOR"]');await click('[data-purchase="EQUIPMENT"]');await close();
  await click(`[data-employee="E0${i}"]`);await click('.facility-toolbar [data-action="equipment"]');await click(`[data-weapon="W0${i}"]`);await click(`[data-armor="A0${i}"]`);await close();
  const state=await read(),e=state.employees.find(e=>e.id===`E0${i}`);assert.equal(e.weaponId,`W0${i}`);assert.equal(e.armorId,`A0${i}`);
 }
 // Spread the equipped employees through actual corridor orders, then stop at destinations.
 for(let i=1;i<=5;i++){
  await click(`[data-employee="E0${i}"]`);await key('Home');
  await canvas(await page.evaluate(p=>window.__facilityTest.scene.getCorridorScreenPoint(p),{x:1650+(i-1)*115,y:825}),'right');
 }
 await pause(false);await wait(()=>window.__facilityTest.controller.state.employees.slice(0,5).every((e,i)=>Math.hypot(e.location.x-(1650+i*115),e.location.y-850)<3));await pause(true);
 for(let i=1;i<=5;i++){
  await click(`[data-employee="E0${i}"]`);await key('s');await key('f');await shot(`equipment-W0${i}-A0${i}`);
  const s=await read(),rig=s.art.personnel.find(p=>p.id===`E0${i}`);assert(rig.parts.some(p=>p.slot==='weapon'&&p.key.startsWith('nm_v2_weapon_')));assert(rig.parts.some(p=>p.slot.startsWith('armor-')&&p.key.startsWith('nm_v2_armor_')));
 }
 report.checks.push({name:'five-loadouts-earned-equipped-and-rendered',state:await read()});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.reason=String(error.stack??error);await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});report.failureState=await read().catch(()=>null)}
finally{await context.close();await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,reason:report.reason}));if(report.status!=='PASS')process.exitCode=1}

