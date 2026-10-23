import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../..');
const sourceDir=path.join(root,'art-production/generated/personnel');
const runtimeDir=path.join(root,'public/art/generated/personnel');
const manifestPath=path.join(sourceDir,'manifest.json');
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const groups=(await read(path.join(dir,'characters.json'))).filter(x=>!x.id.startsWith('ABN_'));
const mapping=await read(path.join(dir,'characters_units.json'));
const tasks=groups.flatMap(a=>mapping[a.id].map(u=>({id:a.id,key:a.name+'_'+u.suffix,filename:a.name+'_'+u.suffix+'.png',displayName:u.displayName,kind:a.deliveryType,state:a.state,priority:a.priority,requirements:a.requirements,canvas:u.canvas,focus:u.focus,negative:a.negative,source:a.source,pivot:a.pivot,dependsOn:a.dependsOn})));
await fs.mkdir(sourceDir,{recursive:true});await fs.mkdir(runtimeDir,{recursive:true});
let manifest=[];try{manifest=await read(manifestPath)}catch{}
async function syncRuntimeIndex(){
  const destination=path.join(root,'src/art/generated/personnel-manifest.json');
  const value=JSON.stringify(manifest.filter(a=>!a.referenceOnly).map(({id,key,url})=>({id,key,url})).sort((a,b)=>a.key.localeCompare(b.key)),null,2)+'\n';
  const previous=await fs.readFile(destination,'utf8').catch(()=>null);
  if(previous!==value)await fs.writeFile(destination,value);
}
const [mode,...args]=process.argv.slice(2);
if(mode==='all')console.log(JSON.stringify(tasks));
else if(mode==='queue') {
  console.log(JSON.stringify(tasks.filter(t=>!manifest.some(m=>m.key===t.key)),null,0));
} else if(mode==='ingest') {
  const [key,input]=args;const task=tasks.find(t=>t.key===key);if(!task)throw new Error('Unknown '+key);
  const original=path.join(sourceDir,task.filename),runtime=path.join(runtimeDir,task.filename);
  const previous=manifest.find(m=>m.key===key),revisions=[...(previous?.revisions??[])];
  if(previous&&previous.originalGenerationPath!==input){
    const revisionDir=path.join(root,'art-production/revisions/personnel');await fs.mkdir(revisionDir,{recursive:true});
    const revision=path.join(revisionDir,`${key}_${Date.now()}.png`);await fs.copyFile(original,revision);
    revisions.push({sourcePath:path.relative(root,revision).replaceAll('\\','/'),originalGenerationPath:previous.originalGenerationPath,generatedAt:previous.generatedAt});
  }
  await fs.copyFile(input,original);
  const image=sharp(original).ensureAlpha();const meta=await image.metadata();
  const raw=await image.clone().raw().toBuffer({resolveWithObject:true});
  let l=raw.info.width,t=raw.info.height,r=-1,b=-1;
  for(let y=0;y<raw.info.height;y++)for(let x=0;x<raw.info.width;x++)if(raw.data[(y*raw.info.width+x)*4+3]>16){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}
  if(r<l)throw new Error('Empty alpha '+key);
  const crop={left:Math.max(0,l-3),top:Math.max(0,t-3),width:Math.min(raw.info.width-l+3,r-l+7),height:Math.min(raw.info.height-t+3,b-t+7)};
  const isReference=task.kind==='动作参考'||task.kind==='定稿';
  await image.extract(crop).resize({width:isReference?512:256,height:isReference?512:256,fit:'inside',withoutEnlargement:true}).png({compressionLevel:9}).toFile(runtime);
  const output=await sharp(runtime).metadata();
  const item={...task,sourcePath:path.relative(root,original).replaceAll('\\','/'),originalGenerationPath:input,sourceDimensions:[meta.width,meta.height],alphaBounds:crop,url:'/art/generated/personnel/'+task.filename,width:output.width,height:output.height,runtimeBytes:(await fs.stat(runtime)).size,generated:true,referenceOnly:task.kind==='动作参考'||task.kind==='定稿',status:'GENERATED',generatedAt:new Date().toISOString()};
  if(revisions.length)item.revisions=revisions;
  manifest=manifest.filter(m=>m.key!==key);manifest.push(item);
  await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2));
  await fs.writeFile(path.join(runtimeDir,'manifest.json'),JSON.stringify(manifest.map(({originalGenerationPath,source,...m})=>m),null,2));
  await syncRuntimeIndex();
  console.log(JSON.stringify({key,count:manifest.length,total:tasks.length,source:original,runtime,dimensions:[output.width,output.height]}));
} else if(mode==='status')console.log(JSON.stringify({complete:manifest.length,total:tasks.length,remaining:tasks.filter(t=>!manifest.some(m=>m.key===t.key)).map(t=>t.key)}));
else if(mode==='sync-runtime-index')await syncRuntimeIndex();
