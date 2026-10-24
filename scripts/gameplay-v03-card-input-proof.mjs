import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const output=`docs/gameplay-v03-evidence/card-input-${new Date().toISOString().replaceAll(':','-')}`;
await mkdir(output,{recursive:true});
const report={status:'RUNNING',method:'Native Chrome input; read-only state. No injected positions, cards, damage or time.',checks:[],inputs:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage();
page.on('pageerror',e=>report.errors.push(String(e)));
const read=()=>page.evaluate(()=>structuredClone(window.__v3Test.simulation.state));
const click=async s=>{report.inputs.push(s);await page.locator(s).click()};
const pause=async wanted=>{if(((await read()).timeScale===0)!==wanted)await click('[data-v3="pause"]')};
const canvas=async p=>{const box=await page.locator('canvas').boundingBox();report.inputs.push({canvas:p});await page.mouse.click(box.x+p.x*box.width/1600,box.y+p.y*box.height/900)};
try{
 await page.goto('http://127.0.0.1:4173/',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__v3Test?.scene.getViewState().employees?.length===3);
 await click('[data-v3="equipment"]');await page.locator('[data-weapon-for="E01"]').selectOption('W01');await page.locator('[data-armor-for="E01"]').selectOption('A01');await click('[data-v3="equip"][data-id="E01"]');await click('[data-v3="close"]');
 await click('[data-v3="challenge"]');await click('[data-v3="confirm-encounter"]');
 await page.waitForFunction(()=>{const s=window.__v3Test.simulation.state,e=s.encounter;return e?.deck.hand.some(c=>c.cardId==='T03')&&s.employees.some(p=>e.enemies.some(n=>n.suppressionHp>0&&Math.abs(p.location.x-n.location.x)<48));},{},{timeout:15000});
 await pause(true);const before=await read(),enc=before.encounter;
 const ally=before.employees.find(p=>enc.enemies.some(n=>n.suppressionHp>0&&Math.abs(p.location.x-n.location.x)<48));assert(ally);
 const card=enc.deck.hand.find(c=>c.cardId==='T03');assert(card);
 await click(`[data-v3="card"][data-id="${card.instanceId}"]`);
 await canvas(await page.evaluate(id=>window.__v3Test.scene.getEmployeeScreenPoint(id),ally.id));
 await page.screenshot({path:`${output}/01-overlapped-ally-target.png`});
 const queued=await read();report.checks.push({name:'Overlapping ally can be targeted in scene',ally:ally.id,card:card.instanceId,pending:queued.encounter.deck.pendingCast,message:await page.locator('#v3-message').textContent()});
 assert.equal(queued.encounter.deck.pendingCast?.targetId,ally.id,'Healing card click was intercepted by overlapping enemy');
 await page.waitForTimeout(500);assert.deepEqual(await read(),queued);report.checks.push('Pause freezes queued card');
 await pause(false);await page.waitForFunction(id=>window.__v3Test.simulation.state.logs.some(e=>e.kind==='CARD'&&e.sourceId===id),card.ownerId,{timeout:8000});await pause(true);
 const cast=await read();assert(cast.encounter.deck.discardPile.some(c=>c.instanceId===card.instanceId));assert(cast.encounter.deck.globalCooldown>0);await page.screenshot({path:`${output}/02-heal-success.png`});report.checks.push({name:'Owner executes heal exactly once',events:cast.logs.filter(e=>e.kind==='CARD'),cooldown:cast.encounter.deck.globalCooldown});
 assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(e){report.status='FAIL';report.reason=String(e.stack??e);}
finally{await context.close();await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report},null,2));if(report.status!=='PASS')process.exitCode=1;}
