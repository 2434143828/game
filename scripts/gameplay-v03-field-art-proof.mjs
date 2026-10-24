import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const output=`docs/gameplay-v03-evidence/field-art-${new Date().toISOString().replaceAll(':','-')}`;
await mkdir(output,{recursive:true});
const cfg=JSON.parse(await readFile('config/gameplay-v3.json','utf8'));
const report={status:'RUNNING',boundary:'Five DEV art fixtures, explicitly labelled and isolated from saves. Unlocks/wallet supplied at fixture creation; actual CAPTURE startup, simulation, cards, entities, input and rendering. This is visual acceptance, not five campaign unlock/capture wins.',inputs:[],checks:[],shots:[],errors:[],storageCalls:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:900}});
await context.exposeFunction('__reportFieldStorage',entry=>report.storageCalls.push(entry));
await context.addInitScript(()=>{
  const proto=Storage.prototype, originals=Object.fromEntries(['getItem','setItem','removeItem','clear','key'].map(k=>[k,proto[k]]));
  originals.setItem.call(localStorage,'field-art-sentinel','original-save-must-survive');
  window.__fieldStorageCalls=[];
  for(const key of Object.keys(originals))proto[key]=function(...args){const entry={method:key,key:args[0],url:location.href};window.__fieldStorageCalls.push(entry);void window.__reportFieldStorage(entry);return originals[key].apply(this,args)};
  window.__fieldReadSentinel=()=>originals.getItem.call(localStorage,'field-art-sentinel');
});
let page;
const read=()=>page.evaluate(()=>structuredClone(window.__v3Test.simulation.state));
const view=()=>page.evaluate(()=>window.__v3Test.scene.getViewState());
const click=async selector=>{report.inputs.push({type:'click',url:page.url(),selector});await page.locator(selector).click()};
const shot=async name=>{await page.mouse.move(1590,890);await page.screenshot({path:`${output}/${name}.png`});report.shots.push({name,state:await read(),view:await view()});console.log(name)};
const storageCheck=async id=>{const calls=await page.evaluate(()=>window.__fieldStorageCalls);assert.deepEqual(calls,[]);assert.equal(await page.evaluate(()=>window.__fieldReadSentinel()),'original-save-must-survive');report.checks.push({id,check:'No storage API calls; sentinel unchanged'});};
const freeze=async id=>{await page.waitForTimeout(100);const state=await read(),render=await view();await page.waitForTimeout(600);assert.deepEqual(await read(),state);assert.deepEqual(await view(),render);report.checks.push({id,check:'Paused simulation/entities/pollution all frozen for 600ms'});};
try{
  for(const id of ['N01','N02','N03','N04','N05']){
    page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(String(e)));
    page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`)});
    await page.goto(`${process.env.FACILITY_URL??'http://127.0.0.1:4173/'}?fieldPreview=${id}`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__v3Test?.scene.getViewState().field?.loaded===true,undefined,{timeout:30000});
    assert.equal((await view()).field.theme,id);
    assert.equal((await read()).encounter.mode,'CAPTURE');
    assert.match(await page.locator('#v3-field-preview').textContent(),/美术调试预览，不保存进度/);
    await shot(`${id}-01-entry-paused`);await freeze(id);await storageCheck(id);
    const before=await read(),card=before.encounter.deck.hand[0],def=cfg.cards[card.cardId];
    await click(`[data-v3="card"][data-id="${card.instanceId}"]`);
    if(def.target==='ENEMY'){
      const target=before.encounter.enemies.find(e=>!e.isClone),point=await page.evaluate(id=>window.__v3Test.scene.getEnemyScreenPoint(id),target.id),bounds=await page.locator('canvas').boundingBox();
      assert(point&&bounds);report.inputs.push({type:'canvas-target',id:target.id,point});
      await page.mouse.click(bounds.x+point.x*bounds.width/1600,bounds.y+point.y*bounds.height/900);
    }else if(def.target==='ALLY')await click(`[data-v3="employee"][data-id="${card.ownerId}"]`);
    assert.equal((await read()).encounter.deck.pendingCast?.instanceId,card.instanceId);
    await freeze(`${id}-queued`);await shot(`${id}-02-card-queued`);
    await click('[data-v3="pause"]');
    await page.waitForFunction(instanceId=>window.__v3Test.simulation.state.encounter.deck.discardPile.some(c=>c.instanceId===instanceId),card.instanceId,{timeout:15000,polling:20});
    await click('[data-v3="pause"]');
    const after=await read();assert(after.logs.some(e=>e.kind==='CARD'&&e.sourceId===card.ownerId));
    assert(after.simulationTimeSec>before.simulationTimeSec);assert.notDeepEqual(after.employees.map(e=>e.location),before.employees.map(e=>e.location));
    await shot(`${id}-03-real-card-action`);await freeze(`${id}-action`);await storageCheck(`${id}-action`);
    report.checks.push({id,check:'Real native card cast, owner movement and successful effect',cardId:card.cardId,simulationTime:after.simulationTimeSec});
    await click('[data-v3="pause"]');
    await page.waitForFunction(()=>window.__v3Test.scene.getViewState().field?.windup===true,undefined,{timeout:12000,polling:20});
    await click('[data-v3="pause"]');
    assert.equal((await view()).field.windup,true);
    await shot(`${id}-04-enemy-windup-pollution`);await freeze(`${id}-enemy-windup`);await storageCheck(`${id}-enemy-windup`);
    await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__v3Test?.scene.getViewState().field?.loaded);
    assert.equal((await read()).simulationTimeSec,0);assert.equal((await read()).encounter.result,null);await storageCheck(`${id}-reload`);
    await page.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.storageCalls,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.reason=String(error.stack??error);if(page&&!page.isClosed())await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});}
finally{await context.close();await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,checks:report.checks.length,reason:report.reason}));if(report.status!=='PASS')process.exitCode=1;}
