import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const output = `docs/gameplay-v03-evidence/card-arrow-${new Date().toISOString().replaceAll(':','-')}`;
await mkdir(output,{recursive:true});
const report={status:'RUNNING',checks:[],shots:[],errors:[],httpErrors:[],inputs:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:900}});const page=await context.newPage();
page.on('pageerror',e=>report.errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)report.httpErrors.push(`${r.status()} ${r.url()}`)});
const view=()=>page.evaluate(()=>window.__v3Test.scene.getViewState());
const shot=async name=>{await page.screenshot({path:`${output}/${name}.png`});report.shots.push(name)};
try{
  await page.goto('http://127.0.0.1:4173/?cardArtPreview=N01',{waitUntil:'networkidle'});
  await page.locator('[data-v3="card"]').first().click();report.inputs.push('select-targeted-card');
  const state=await page.evaluate(()=>window.__v3Test.simulation.state);
  const enemy=state.encounter.enemies.find(e=>!e.isClone&&e.suppressionHp>0);assert(enemy);
  const point=await page.evaluate(id=>window.__v3Test.scene.getEnemyScreenPoint(id),enemy.id);const box=await page.locator('canvas').boundingBox();assert(point&&box);
  await page.mouse.move(point.x,point.y);await page.waitForTimeout(120);const legal=await view();const lt=legal.cards.targeting;assert.equal(lt.pointerTargetId,enemy.id);assert.equal(lt.arrowLegal,true);assert(lt.arrowTarget);await shot('01-arrow-snaps-to-legal-target');
  await page.mouse.move(box.x+box.width*0.32,box.y+box.height*0.22);await page.waitForTimeout(120);const free=await view();const ft=free.cards.targeting;assert.equal(ft.arrowLegal,false);assert.equal(ft.pointerTargetId,null);assert(ft.pointer&&ft.arrowTarget);assert.notDeepEqual(ft.arrowTarget,lt.arrowTarget);await shot('02-arrow-follows-empty-aim');
  report.checks.push({name:'pointer-direction-arrow',legal:{pointerTargetId:lt.pointerTargetId,arrowLegal:lt.arrowLegal,arrowTarget:lt.arrowTarget},emptyAim:{arrowLegal:ft.arrowLegal,pointer:ft.pointer,arrowTarget:ft.arrowTarget}});assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.status='PASS';
}catch(e){report.status='FAIL';report.reason=String(e.stack??e);await shot('failure').catch(()=>{});}
finally{await context.close();await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,checks:report.checks,reason:report.reason}));if(report.status!=='PASS')process.exitCode=1;}
