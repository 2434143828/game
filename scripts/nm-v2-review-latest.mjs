import {readFile,readdir,stat,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const base='art-production/nm-v2',date=process.argv[2]??'20261023';
const files=await Promise.all((await readdir(`${base}/records`)).filter(f=>f.startsWith(date)&&f.endsWith('.json')).map(async f=>({f,time:(await stat(`${base}/records/${f}`)).mtimeMs})));
const latest=new Map();for(const {f} of files.sort((a,b)=>a.time-b.time)){const row=JSON.parse(await readFile(`${base}/records/${f}`,'utf8'));if(row.source)latest.set(row.filename,row);}
const rows=[...latest.values()];const cells=await Promise.all(rows.map(async(r,i)=>`<article><div><img src="data:image/png;base64,${(await readFile(r.source)).toString('base64')}"></div><small>${i}: ${r.filename}</small></article>`));
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:Math.ceil(rows.length/4)*280+50}});
await page.setContent(`<style>body{margin:0;background:#b9c8d7;font-family:Arial}h3{margin:12px}main{display:grid;grid-template-columns:repeat(4,1fr)}article{height:280px;padding:8px;border:1px solid #39424e;box-sizing:border-box}article div{height:235px;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#eef3f8 0% 25%,#dde6ee 0% 50%) 0/24px 24px}img{max-width:100%;max-height:100%}small{overflow-wrap:anywhere}</style><h3>独立素材检查（非实机） ${date}</h3><main>${cells.join('')}</main>`);
await page.locator('img').evaluateAll(images=>Promise.all(images.map(im=>im.decode())));await mkdir(`${base}/review-pages`,{recursive:true});
await page.screenshot({path:`${base}/review-pages/latest-${date}.png`,fullPage:true});await writeFile(`${base}/review-pages/latest-${date}.json`,JSON.stringify(rows,null,2));await browser.close();console.log(JSON.stringify(rows.map((r,i)=>({i,filename:r.filename}))));
