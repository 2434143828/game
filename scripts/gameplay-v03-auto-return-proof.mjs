import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const output = `docs/gameplay-v03-evidence/auto-return-${new Date().toISOString().replaceAll(':','-')}`;
await mkdir(output,{recursive:true});
const report={status:'RUNNING',checks:[],shots:[],errors:[],httpErrors:[],inputs:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1280,height:720}});
const page=await context.newPage();
page.on('pageerror',e=>report.errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)report.httpErrors.push(`${r.status()} ${r.url()}`)});
const read=()=>page.evaluate(()=>structuredClone(window.__v3Test.simulation.state));
const shot=async name=>{await page.screenshot({path:`${output}/${name}.png`});report.shots.push(name)};
try{
  await page.goto('http://127.0.0.1:4173/?cardArtPreview=N01',{waitUntil:'networkidle'});
  await page.locator('[data-v3="pause"]').waitFor();
  assert.equal((await read()).encounter.mode,'CAPTURE');
  await shot('01-entry-paused');
  await page.locator('[data-v3="pause"]').click();report.inputs.push('resume');
  await page.waitForFunction(()=>window.__v3Test.simulation.state.encounter?.result==='VICTORY',{timeout:60000,polling:50});
  const result=await read();assert.equal(result.encounter.result,'VICTORY');await shot('02-victory-result');
  await page.waitForFunction(()=>window.__v3Test.simulation.state.encounter===null,{timeout:10000,polling:50});
  const returned=await read();assert.equal(returned.encounter,null);assert.equal(returned.phase,'FACILITY');
  assert.match(await page.locator('#v3-mode').textContent(),/设施/);assert.match(await page.locator('#v3-message').textContent(),/自动返回设施/);
  await shot('03-auto-returned-facility');
  report.checks.push({name:'victory-auto-return',victoryAtSec:result.encounter.elapsedSec,returnedPhase:returned.phase,mode:await page.locator('#v3-mode').textContent(),message:await page.locator('#v3-message').textContent()});
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.status='PASS';
}catch(e){report.status='FAIL';report.reason=String(e.stack??e);await shot('failure').catch(()=>{});}
finally{await context.close();await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,checks:report.checks,reason:report.reason}));if(report.status!=='PASS')process.exitCode=1;}
