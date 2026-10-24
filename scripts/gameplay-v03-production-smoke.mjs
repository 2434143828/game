import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const origin=process.env.FACILITY_URL??'http://127.0.0.1:4174';
const output=`docs/gameplay-v03-evidence/production-${new Date().toISOString().replaceAll(':','-')}`;
await mkdir(output,{recursive:true});
const report={status:'RUNNING',method:'Production bundle, native UI only. No DEV state or simulation injection.',checks:[],inputs:[],errors:[],httpErrors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1280,height:720}});
const page=await context.newPage();
page.on('pageerror',e=>report.errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)report.httpErrors.push(r.url())});
const click=async selector=>{report.inputs.push(selector);await page.locator(selector).click()};
const shot=async name=>page.screenshot({path:`${output}/${name}.png`});
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 await page.goto(origin,{waitUntil:'networkidle'});await page.locator('[data-v3="equipment"]').waitFor();
 assert(await page.evaluate(()=>!('__v3Test' in window)&&!('__facilityTest' in window)));
 await click('[data-v3="pause"]');assert.match(await page.locator('[data-v3="pause"]').textContent(),/继续/);
 assert.equal(await page.locator('#v3-roster button').count(),3);assert.equal(await page.locator('#v3-facility-actions [data-v3="room"]').count(),5);
 await shot('01-default-v3-facility');report.checks.push('Default v3 facility, three staff, five room controls, no DEV bridge');
 await click('[data-v3="equipment"]');await page.locator('[data-weapon-for="E01"]').selectOption('W01');await page.locator('[data-armor-for="E01"]').selectOption('A01');await click('[data-v3="equip"][data-id="E01"]');await click('[data-v3="close"]');
 await click('[data-v3="challenge"]');await click('[data-v3="confirm-encounter"]');await page.waitForTimeout(2400);await click('[data-v3="pause"]');await page.mouse.move(1,719);await page.waitForTimeout(100);
 const clock=await page.locator('#v3-clock').textContent();const before=await page.screenshot();await page.waitForTimeout(800);const after=await page.screenshot();
 assert.equal(await page.locator('#v3-clock').textContent(),clock);assert.equal(sha(after),sha(before));
 assert.equal(await page.locator('[data-v3="card"]').count(),3);await shot('02-production-battle-paused');report.checks.push({name:'Production combat and pause freezes entire visible frame',wallMs:800,screenshotSha256:sha(after)});
 await click('[data-v3="pause"]');await page.waitForTimeout(1500);assert.notEqual(await page.locator('#v3-clock').textContent(),clock);await click('[data-v3="pause"]');
 await page.reload({waitUntil:'networkidle'});await page.locator('[data-v3="equipment"]').waitFor();assert.equal(await page.locator('[data-v3="card"]').count(),0);assert.match(await page.locator('#v3-message').textContent(),/放弃/);await shot('03-reload-abandons');report.checks.push('Refresh abandons unfinished battle with no victory');
 const layout=await page.evaluate(()=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,buttons:[...document.querySelectorAll('#v3-facility-actions button')].map(e=>{const r=e.getBoundingClientRect();return {bottom:r.bottom,right:r.right}})}));assert.equal(layout.w,layout.sw);assert.equal(layout.h,layout.sh);assert(layout.buttons.every(r=>r.bottom<=720&&r.right<=1280));report.checks.push({name:'1280 layout',layout});
 await page.goto(`${origin}/?classic=1`,{waitUntil:'networkidle'});await page.locator('canvas').waitFor();assert.equal(await page.locator('#v3-roster').count(),0);assert.match(await page.locator('#interface').textContent(),/三日|演练/);await shot('04-classic-preserved');report.checks.push('Classic entry still renders original facility UI');
 await page.goto(`${origin}/?fieldPreview=N04`,{waitUntil:'networkidle'});await page.locator('[data-v3="equipment"]').waitFor();assert.equal(await page.locator('#v3-field-preview').count(),0);assert.equal(await page.locator('[data-v3="card"]').count(),0);report.checks.push('Production ignores art-fixture query and keeps real campaign');
 await page.goto(`${origin}/?cardArtPreview=N04`,{waitUntil:'networkidle'});await page.locator('[data-v3="equipment"]').waitFor();assert.equal(await page.locator('#v3-field-preview').count(),0);assert.equal(await page.locator('[data-v3="card"]').count(),0);report.checks.push('Production ignores card-art fixture query and keeps real campaign');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.status='PASS';
}catch(e){report.status='FAIL';report.reason=String(e.stack??e);await shot('failure').catch(()=>{});}
finally{await context.close();await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report},null,2));if(report.status!=='PASS')process.exitCode=1;}
