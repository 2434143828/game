import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const output = `docs/gameplay-v03-evidence/profile-${new Date().toISOString().replaceAll(':','-')}`;
await mkdir(output,{recursive:true});
const report={status:'RUNNING',checks:[],shots:[],errors:[],httpErrors:[],inputs:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1280,height:720}});const page=await context.newPage();
page.on('pageerror',e=>report.errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)report.httpErrors.push(`${r.status()} ${r.url()}`)});
const shot=async name=>{await page.screenshot({path:`${output}/${name}.png`});report.shots.push(name)};
try{
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'networkidle'});
  await page.locator('[data-v3="profile"]').click();report.inputs.push('N01-profile');
  const n01=await page.locator('[data-profile-id="N01"]').innerText();assert.match(n01,/ARCHIVE|收容档案/);assert.match(n01,/LIVE|稳定收容/);assert.equal(await page.locator('.v3-profile-portrait img').count(),1);await shot('01-n01-contained-profile');
  await page.getByRole('button',{name:'关闭 ×'}).click();await page.locator('[data-v3="room"][data-id="N02"]').click();await page.locator('[data-v3="profile"]').click();report.inputs.push('N02-profile');
  const n02=await page.locator('[data-profile-id="N02"]').innerText();assert.match(n02,/ARCHIVE|收容档案/);assert.match(n02,/LOCKED|未收容|待外勤/);await shot('02-n02-uncontained-profile');
  await page.getByRole('button',{name:'返回设施'}).click();assert.equal(await page.locator('.v3-profile-page').count(),0);assert.equal(await page.locator('[data-v3="equipment"]').count(),1);report.checks.push({name:'profile-states-and-return',n01Contained:true,n02Uncontained:true,returnedToFacility:true});assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.status='PASS';
}catch(e){report.status='FAIL';report.reason=String(e.stack??e);await shot('failure').catch(()=>{});}
finally{await context.close();await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,checks:report.checks,reason:report.reason}));if(report.status!=='PASS')process.exitCode=1;}
