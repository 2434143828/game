import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';
const scope=process.argv[2]??'environment', start=Number(process.argv[3]??0), count=Number(process.argv[4]??16);
const base='art-production/nm-v2';
const rows=JSON.parse(await readFile(`${base}/candidate-index.json`,'utf8')).filter(x=>x.scope===scope);
const cells=await Promise.all(rows.slice(start,start+count).map(async(r,i)=>{
  const bytes=await readFile(r.candidate);
  return `<article><div class="image"><img src="data:image/png;base64,${bytes.toString('base64')}"></div><b>${start+i}: ${r.displayName}</b><small>${r.filename}</small></article>`;
}));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:Math.ceil(cells.length/4)*300+60},deviceScaleFactor:1});
await page.setContent(`<html><meta charset="utf-8"><style>body{margin:0;background:#c6d1db;font-family:Arial;color:#12161c}h3{margin:12px}main{display:grid;grid-template-columns:repeat(4,1fr)}article{height:300px;border:1px solid #788895;box-sizing:border-box;padding:8px}.image{height:238px;background:repeating-conic-gradient(#eef3f8 0% 25%,#dde6ee 0% 50%) 0/24px 24px;display:flex;justify-content:center;align-items:center}img{max-width:100%;max-height:100%;object-fit:contain}b,small{display:block;overflow-wrap:anywhere}small{font-size:10px}</style><h3>素材候选检查 · 非游戏实机 · ${scope} ${start}–${start+cells.length-1}</h3><main>${cells.join('')}</main></html>`);
await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
await mkdir(`${base}/review-pages`,{recursive:true});
const out=path.resolve(`${base}/review-pages/${scope}-${start}.png`);
await page.screenshot({path:out,fullPage:true});
await writeFile(`${base}/review-pages/${scope}-${start}.json`,JSON.stringify(rows.slice(start,start+count),null,2));
await browser.close();console.log(out);
