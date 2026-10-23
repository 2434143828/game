import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const out='art-production/inspection/environment';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:900}});
const errors=[],consoleMessages=[],requests=[],badResponses=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')consoleMessages.push(m.text());});
page.on('request',r=>{if(r.url().includes('/environment/'))requests.push(r.url());});
page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status()});});
try {
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__facilityTest?.scene.getEmployeeScreenPoint('E01'));
  if(await page.evaluate(()=>window.__facilityTest.controller.state.timeScale!==0))await page.locator('[data-action="pause"]').click();
  const state=await page.evaluate(async()=>{
    const scene=window.__facilityTest.scene;
    const {ENVIRONMENT_TEXTURE_NAMES,EnvironmentArt}=await import('/src/art/generated/EnvironmentArt.ts');
    const art=scene.getGeneratedArtState();
    return {environmentComplete:art.environmentComplete,environmentUsage:art.environmentUsage,loadErrors:art.loadErrors,keys:scene.textures.getTextureKeys().filter(k=>k.includes('environment')),missing:ENVIRONMENT_TEXTURE_NAMES.filter(n=>!scene.textures.exists(EnvironmentArt.key(n)))};
  });
  await writeFile(`${out}/state.json`,JSON.stringify({state,errors,consoleMessages,requests,badResponses},null,2));
  await page.screenshot({path:`${out}/01-default.png`});
  await page.keyboard.press('Home');
  await page.screenshot({path:`${out}/02-overview.png`});
  for(const id of ['N01','N02','N03','N04','N05']) {
    const point=await page.evaluate(id=>window.__facilityTest.scene.getCameraControls().rooms[id],id);
    await page.mouse.click(point.x,point.y);
    await page.screenshot({path:`${out}/room-${id}.png`});
  }
  await writeFile(`${out}/state.json`,JSON.stringify({state,errors,consoleMessages,requests,badResponses},null,2));
  console.log(JSON.stringify({out,state,errors,consoleMessages,badResponses}));
} finally {await browser.close();}
