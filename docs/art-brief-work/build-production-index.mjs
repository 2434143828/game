import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const read=async name=>JSON.parse((await fs.readFile(path.join(dir,name),'utf8')).replace(/^\uFEFF/,''));
const [characters,environment,ui,charUnits,envUnits]=await Promise.all(['characters.json','environment.json','ui_vfx.json','characters_units.json','environment_units.json'].map(read));
const groups=[...characters,...environment,...ui];
const entries=[];
for(const group of groups){
 if(!group.quantity)continue;
 const units=charUnits[group.id]??envUnits[group.id]??(group.id==='UI_014'?[{suffix:'walk',displayName:'移动图标'},{suffix:'retreat',displayName:'撤退图标'}]:[{suffix:'',displayName:group.displayName}]);
 if(units.length!==group.quantity)throw Error('Quantity mismatch '+group.id);
 for(const unit of units){
  const briefFilename=group.name+(unit.suffix?'_'+unit.suffix:'')+'.png';
  // UI_014's explicit delivery-note filenames differ from its automatic worksheet names.
  const filename=group.id==='UI_014'?`ui_status_${unit.suffix}_badge.png`:briefFilename;
  const isAbn=group.id.startsWith('ABN'),referenceOnly=/定稿|动作参考/.test(group.deliveryType);
  const folder=group.id.startsWith('ENV')?'environment':/^(UI|VFX)_/.test(group.id)?'ui_vfx':isAbn?(group.deliveryType==='动作参考'?'abnormalities-references':'abnormalities'):'personnel';
  const original=`art-production/generated/${folder}/${filename}`;
  const runtime=referenceOnly?null:`public/art/generated/${folder}/${filename}`;
  const entry={requirementId:group.id,name:unit.displayName,briefFilename,filename,folder,referenceOnly,original,runtime,requirements:group.requirements,unitFocus:unit.focus??group.requirements,pivotIntent:group.pivot,status:'MISSING'};
  const file=path.join(root,original);
  try {
   const source=await fs.readFile(file),metadata=await sharp(source).metadata();
   const raw=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});let minA=255,maxA=0,clear=0;
   for(let i=3;i<raw.data.length;i+=4){const a=raw.data[i];minA=Math.min(minA,a);maxA=Math.max(maxA,a);if(a===0)clear++;}
   entry.sourceSize=[metadata.width,metadata.height];entry.sourceBytes=source.length;entry.sourceSha256=createHash('sha256').update(source).digest('hex');
   entry.alpha={channel:metadata.hasAlpha,min:minA,max:maxA,transparentFraction:clear/(raw.info.width*raw.info.height)};
   entry.status='GENERATED';
   if(runtime){const bytes=await fs.readFile(path.join(root,runtime)),m=await sharp(bytes).metadata();entry.runtimeSize=[m.width,m.height];entry.runtimeBytes=bytes.length;entry.runtimeSha256=createHash('sha256').update(bytes).digest('hex');entry.status='PREPARED_FOR_RUNTIME';}
  }catch(error){entry.status='MISSING';entry.error=String(error);}
  entries.push(entry);
 }
}
const summary={generatedAt:new Date().toISOString(),generator:'built-in image_gen',requestedGroups:groups.length,requestedPng:entries.length,generated:entries.filter(x=>x.status!=='MISSING').length,runtime:entries.filter(x=>x.runtime&&x.status==='PREPARED_FOR_RUNTIME').length,referenceOnly:entries.filter(x=>x.referenceOnly).length,proceduralGroups:groups.filter(g=>!g.quantity).map(g=>({id:g.id,name:g.displayName,reason:g.notes})),missing:entries.filter(x=>x.status==='MISSING').map(x=>({file:x.filename,error:x.error})),entries};
if(new Set(entries.map(e=>e.filename)).size!==entries.length)throw Error('Duplicate production filename');
const out=path.join(root,'art-production');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'production-index.json'),JSON.stringify(summary,null,2));
const columns=['requirementId','name','briefFilename','filename','status','referenceOnly','original','runtime'];
const csv=rows=>rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
await fs.writeFile(path.join(out,'production-index.csv'),'\uFEFF'+csv([columns,...entries.map(e=>columns.map(c=>e[c]))]));
if(process.argv.includes('--contacts')){
 const gallery=path.join(out,'contact-sheets');await fs.mkdir(gallery,{recursive:true});
 const categories=[...new Set(entries.map(e=>e.folder))];
 for(const category of categories){
  const group=entries.filter(e=>e.folder===category&&e.status!=='MISSING');
  const cols=6,w=220,h=210,rows=Math.ceil(group.length/cols),layers=[];
  for(let i=0;i<group.length;i++){
   const entry=group[i],left=(i%cols)*w,top=Math.floor(i/cols)*h;
   const thumbnail=await sharp(path.join(root,entry.original)).trim({background:'#00000000'}).resize(184,166,{fit:'inside'}).png().toBuffer();
   const m=await sharp(thumbnail).metadata();layers.push({input:thumbnail,left:left+Math.round((w-m.width)/2),top:top+5+Math.round((166-m.height)/2)});
   const label=(entry.requirementId+' '+entry.filename.replace('.png','')).replaceAll('&','&amp;').replaceAll('<','&lt;');
   const chunks=[label.slice(0,32),label.slice(32,64)];
   const svg=`<svg width="220" height="38"><text x="8" y="13" font-family="Arial" font-size="9" fill="#292422">${chunks[0]}</text><text x="8" y="27" font-family="Arial" font-size="9" fill="#292422">${chunks[1]}</text></svg>`;
   layers.push({input:Buffer.from(svg),left,top:top+171});
  }
  if(rows)await sharp({create:{width:cols*w,height:rows*h,channels:3,background:'#d4cec0'}}).composite(layers).png().toFile(path.join(gallery,category+'.png'));
 }
}
console.log(JSON.stringify({...summary,entries:undefined},null,2));
if(summary.missing.length)process.exitCode=1;
