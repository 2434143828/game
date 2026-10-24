import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const cfg=JSON.parse(await readFile('config/gameplay-v3.json','utf8'));
const output=`docs/gameplay-v03-evidence/run-${new Date().toISOString().replaceAll(':','-')}`;
await mkdir(output,{recursive:true});
const report={status:'RUNNING',method:'Native Chrome mouse/keyboard only; read-only game snapshots. No injected state/time/damage/energy/cards.',inputs:[],checks:[],shots:[],events:[],errors:[],httpErrors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:`${output}/video`,size:{width:1600,height:900}}});
const page=await context.newPage();
page.on('pageerror',e=>report.errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)report.httpErrors.push(r.url())});
const seen=new Set();
const read=async()=>{const s=await page.evaluate(()=>structuredClone(window.__v3Test.simulation.state));for(const e of s.logs)if(!seen.has(e.id)){seen.add(e.id);report.events.push(e);}return s};
const click=async selector=>{report.inputs.push({at:new Date().toISOString(),type:'click',selector});await page.locator(selector).click()};
const pause=async wanted=>{if(((await read()).timeScale===0)!==wanted)await click('[data-v3="pause"]')};
const canvas=async(point)=>{const r=await page.locator('canvas').boundingBox();assert(point&&r);report.inputs.push({type:'canvas',point});await page.mouse.click(r.x+point.x*r.width/1600,r.y+point.y*r.height/900)};
const target=async(id,enemy)=>canvas(await page.evaluate(({id,enemy})=>enemy?window.__v3Test.scene.getEnemyScreenPoint(id):window.__v3Test.scene.getEmployeeScreenPoint(id),{id,enemy}));
const shot=async(name)=>{await page.mouse.move(10,890);await page.screenshot({path:`${output}/${name}.png`});report.shots.push({name,state:await read(),view:await page.evaluate(()=>window.__v3Test.scene.getViewState())});console.log(JSON.stringify({shot:name}));};
const check=(name,detail)=>report.checks.push({name,detail});
const freeze=async()=>{await pause(true);await page.waitForTimeout(100);const before=await read(),view=await page.evaluate(()=>window.__v3Test.scene.getViewState());await page.waitForTimeout(750);assert.deepEqual(await read(),before);assert.deepEqual(await page.evaluate(()=>window.__v3Test.scene.getViewState()),view);check('paused-simulation-and-render-frozen',{time:before.simulationTimeSec,wallMs:750});};
const choose=async(s,preferInterrupt=false)=>{
 const e=s.encounter,d=e.deck;if(d.pendingCast||d.globalCooldown>1e-7)return null;
 const usable=d.hand.filter(c=>{const owner=s.employees.find(o=>o.id===c.ownerId);return owner.hp>0&&owner.status!=='PANICKED'&&owner.status!=='INCAPACITATED'&&(cfg.cards[c.cardId].effect!=='COPY'||e.lastAttackCard)});
 usable.sort((a,b)=>{const priority=c=>cfg.cards[c.cardId].effect==='STUN'?(preferInterrupt?0:10):cfg.cards[c.cardId].effect==='DAMAGE'?1:cfg.cards[c.cardId].effect==='COPY'?2:3;return priority(a)-priority(b)});
 for(const c of usable){const def=cfg.cards[c.cardId],owner=s.employees.find(o=>o.id===c.ownerId);let id;
 if(def.target==='ENEMY'){const n=def.effect==='COPY'?e.enemies.find(n=>n.id===e.lastAttackCard?.targetId&&n.suppressionHp>0):e.enemies.find(n=>!n.isClone&&n.suppressionHp>0);if(!n)continue;if(def.effect==='STUN'&&!n.windupEndsAtSec)continue;id=n.id;}
 else if(def.target==='ALLY')id=[...s.employees].filter(o=>e.squadIds.includes(o.id)&&o.hp>0).sort((a,b)=>a.sp-b.sp)[0]?.id;
 else id=def.target==='SELF'?owner.id:'TEAM';
 const button=page.locator(`[data-v3="card"][data-id="${c.instanceId}"]`);if(!await button.isEnabled())continue;
 // Victory can land between the snapshot and this DOM click. Re-read and
 // treat that boundary as a normal end of the battle, not a proof failure.
 if((await read()).encounter.result) return null;
 try { await click(`[data-v3="card"][data-id="${c.instanceId}"]`); } catch (error) { if((await read()).encounter?.result) return null; throw error; }
 if(def.target==='ENEMY')await target(id,true);if(def.target==='ALLY')await click(`[data-v3="employee"][data-id="${id}"]`);
 return c;
 }
 return null;
};
const autoplay=async(label)=>{
 const started=Date.now();let capturedInterrupt=false;
 while(Date.now()-started<150000){const s=await read();if(s.encounter.result)break;
 const boss=s.encounter.enemies.find(n=>!n.isClone);
 await choose(s,Boolean(boss?.windupEndsAtSec));
 if(!capturedInterrupt&&s.logs.some(e=>e.kind==='INTERRUPT')){await pause(true);await shot(`${label}-card-interrupt`);capturedInterrupt=true;await pause(false);}
 await page.waitForTimeout(120);
 }
 await pause(true);const done=await read();await shot(`${label}-result`);assert.equal(done.encounter.result,'VICTORY');
 assert(done.encounter.elapsedSec<=20,'Corresponding equipped squad should win within 20 simulation seconds');
 check(`${label}-real-battle-victory`,{elapsed:done.encounter.elapsedSec,rank:done.rooms.find(r=>r.anomalyId===done.encounter.targetAnomalyId).rank,damageEvents:report.events.filter(e=>e.kind==='HIT').length,cardEvents:report.events.filter(e=>e.kind==='CARD').length,interrupted:capturedInterrupt});return done;
};
try{
 await page.goto(process.env.FACILITY_URL??'http://127.0.0.1:4173/',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__v3Test?.scene.getViewState().employees?.length===3);await pause(true);await shot('01-stable-facility');
 const initial=await read();assert.equal(initial.rooms.filter(r=>r.owned).length,1);assert.equal(initial.rooms[0].rank,1);
 await click('[data-v3="equipment"]');await page.locator('[data-weapon-for="E01"]').selectOption('W01');await page.locator('[data-armor-for="E01"]').selectOption('A01');await click('[data-v3="equip"][data-id="E01"]');await shot('02-nine-card-equipment');await click('[data-v3="close"]');
 await click('[data-v3="challenge"]');assert.equal((await read()).encounter,null);await page.keyboard.press('Space');await page.waitForTimeout(300);assert.equal((await read()).timeScale,0);check('modal-space-does-not-resume-hidden-simulation');await shot('03-confirm-manual-challenge');await click('[data-v3="confirm-encounter"]');await pause(true);
 const opening=await read(),deck=opening.encounter.deck;assert.equal(deck.hand.length,3);assert.equal(deck.drawPile.length,6);assert.equal(opening.encounter.enemies.length,3);assert.equal(opening.rooms[0].state,'IN_CHALLENGE');
 const all=[...deck.hand,...deck.drawPile];assert.equal(new Set(all.map(c=>c.instanceId)).size,9);for(const id of opening.encounter.squadIds)assert.equal(all.filter(c=>c.ownerId===id).length,3);
 await shot('04-three-staff-nine-cards');await freeze();
 // Queue only one actually available card while paused, then let its actual owner move/cast.
 const chosen=await choose(await read());assert(chosen);const queued=await read();assert(queued.encounter.deck.pendingCast);assert.equal(queued.encounter.deck.globalCooldown,0);assert(queued.encounter.deck.hand.some(c=>c.instanceId===chosen.instanceId));
 await shot('05-paused-one-card-queued');await freeze();await click('[data-v3="speed"][data-value="1"]');await pause(false);
 await page.waitForFunction(id=>!window.__v3Test.simulation.state.encounter.deck.pendingCast&&window.__v3Test.simulation.state.encounter.deck.discardPile.some(c=>c.instanceId===id),chosen.instanceId,{timeout:30000,polling:20});await pause(true);
 const cast=await read();assert(cast.encounter.deck.globalCooldown>0);assert(cast.encounter.deck.globalCooldown<=2.5);assert.equal(cast.wallet,opening.wallet);assert(cast.logs.some(e=>e.kind==='CARD'&&e.sourceId===chosen.ownerId));
 assert.equal(await page.locator('[data-v3="card"]:enabled').count(),0);await shot('06-card-hit-global-cooldown');check('card-ownership-and-hit-cooldown',{owner:chosen.ownerId,card:chosen.cardId,cooldown:cast.encounter.deck.globalCooldown});
 await pause(false);await page.waitForFunction(()=>window.__v3Test.simulation.state.simulationTimeSec>=6,{timeout:15000,polling:20});await pause(true);const persistedAfterCard=await page.evaluate(()=>JSON.parse(localStorage.getItem('wanggeng.demo.v3')??'null'));assert(persistedAfterCard?.state?.logs?.some(e=>e.kind==='CARD'&&e.cardId===chosen.cardId));check('card-event-autosave-roundtrip',{simulationTime:persistedAfterCard.state.simulationTimeSec,cardId:chosen.cardId});
 await pause(false);const won=await autoplay('07-nailong');assert.equal(won.rooms[0].rank,2);assert(won.encounter.rewardApplied);await click('[data-v3="return"]');await pause(true);await shot('08-rank-II-production');
 const before=await read();await pause(false);await page.waitForFunction(t=>window.__v3Test.simulation.state.simulationTimeSec>=t+20,before.simulationTimeSec,{timeout:25000});await pause(true);const recovered=await read();assert(Math.abs((recovered.wallet-before.wallet)-(recovered.simulationTimeSec-before.simulationTimeSec)*4/60)<1e-6);
 await click('[data-v3="equipment"]');await click('[data-v3="upgrade"][data-id="E01"]');assert.equal((await read()).employees[0].weaponTier,2);await shot('09-explicit-ego-II-upgrade');await click('[data-v3="close"]');
 await click('[data-v3="room"][data-id="N02"]');await click('[data-v3="capture"][data-id="N02"]');const wallet=(await read()).wallet;await click('[data-v3="confirm-encounter"]');await pause(true);assert(Math.abs((await read()).wallet-(wallet-50))<.03);await shot('10-cat-capture-entry');
 const captureStart=await read();await pause(false);const captured=await autoplay('11-cat');assert(captured.rooms.find(r=>r.anomalyId==='N02').owned);assert.equal(captured.rooms[1].rank,1);assert(captured.ownedWeapons.includes('W02'));assert(captured.wallet>captureStart.wallet);await click('[data-v3="return"]');await pause(true);await shot('12-new-room-passive-production');
 check('P1-P2-shared-engine',{wallet:captured.wallet,rooms:captured.rooms,weaponTier:captured.employees[0].weaponTier});
 // Failure and reload cannot award another rank or capture. Start next challenge, then reload via browser.
 await click('[data-v3="room"][data-id="N01"]');await click('[data-v3="challenge"]');await click('[data-v3="confirm-encounter"]');await pause(true);const active=await read();await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__v3Test?.simulation.state.phase==='FACILITY');await pause(true);const reloaded=await read();assert.equal(reloaded.rooms[0].rank,2);assert.equal(reloaded.encounter,null);assert(Math.abs(reloaded.wallet-active.wallet)<.1);await shot('13-refresh-abandons-without-reward');check('refresh-abandons-no-reward',{rank:reloaded.rooms[0].rank,message:await page.locator('#v3-message').textContent()});
 await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(200);await shot('14-layout-1280');const layout=await page.evaluate(()=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,buttons:[...document.querySelectorAll('#v3-facility-actions button')].map(e=>{const r=e.getBoundingClientRect();return {bottom:r.bottom,right:r.right}})}));assert.equal(layout.sw,layout.w);assert.equal(layout.sh,layout.h);assert(layout.buttons.every(r=>r.bottom<=720&&r.right<=1280));check('1280-real-layout',layout);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.status='PASS';
}catch(e){report.status='FAIL';report.reason=String(e.stack??e);await shot('failure').catch(()=>{});}
finally{await context.close();await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,checks:report.checks,reason:report.reason}));if(report.status!=='PASS')process.exitCode=1;}
