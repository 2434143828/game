"""Book-driven queue and mechanical import. No painted or synthetic replacement art."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
from PIL import Image, ImageOps

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'art-production/nm-v2'
QUEUE=BASE/'generation-queue.json'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,value):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
def prepare():
    approved={t['filename']:t for t in read(BASE/'approved-tasks.json')['tasks']}
    tasks=[]
    for name in ['characters-v2','environment-v2','ui-vfx-v2']:
        for group in read(ROOT/f'docs/art-brief-v2/{name}.json'):
            for unit in group['units']:
                filename=group['name']+('_'+unit['suffix'] if unit['suffix'] else '')+'.png'
                kind=group['deliveryType']
                scope='environment' if name=='environment-v2' else 'ui_vfx' if name=='ui-vfx-v2' else 'abnormalities' if '_ABN_' in group['id'] else 'equipment' if '_EQ_' in group['id'] else 'personnel'
                fmt=unit.get('format',group['format'])
                size=unit.get('size',group['size'])
                dims=re.search(r'(\d+)×(\d+)',size)
                assert dims, (filename,size)
                transparent=not ('不透明' in fmt or ('平铺背景' in fmt and '透明' not in fmt))
                prompt=('Use case: stylized-concept. Production game asset, ONE isolated unit only.\n'
                        f"唯一对象：{unit['displayName']}。{unit['focus']}\n"
                        f"风格和造型：{group['requirements']}\n参考对象：{group['reference']}\n"
                        f"建议制作尺寸：{size}。{fmt}\n"
                        '现代新媒体科研机构，清洁、清晰、舒服的二维平涂游戏美术，稳定适度轮廓、最多两级柔和阴影。单张只画限定对象，不要组内其他角色或零件。\n'
                        f"禁止：{group['negative']}\n"
                        '不要添加任何文字、数字、标签、背景棋盘格或水印。'+('真正透明背景。' if transparent else '不透明无缝平铺底图，不加其他物体。'))
                reference=None
                if scope=='personnel' and '_base_identity_' not in filename: reference='nm_v2_agent_base_identity_approved.png'
                if scope=='equipment': reference='nm_v2_agent_base_identity_approved.png'
                if scope=='abnormalities' and '_calm_identity_' not in filename:
                    slug=next(s for s in ['nailong','maodie','big_dog','dingdong_chicken','gugu_gaga'] if group['name'].startswith('nm_v2_abn_'+s+'_'))
                    reference='nm_v2_abn_'+slug+'_calm_identity_approved.png'
                task={'filename':filename,'groupId':group['id'],'displayName':unit['displayName'],'scope':scope,'kind':kind,'referenceOnly':bool(re.search('参考|定稿',kind)),'transparent':transparent,'size':[int(dims[1]),int(dims[2])],'prompt':prompt,'approvedPrompt':approved[filename]['prompt'],'referenceFilename':reference,'status':'pending'}
                tasks.append(task)
                (BASE/'prompts').mkdir(parents=True,exist_ok=True)
                (BASE/'prompts'/filename.replace('.png','.txt')).write_text(prompt,encoding='utf-8')
    assert len(tasks)==307
    existing={t['filename']:t for t in read(QUEUE)['tasks']} if QUEUE.exists() else {}
    for task in tasks:
        if task['filename'] in existing: task.update({k:v for k,v in existing[task['filename']].items() if k in ['status','source','original','runtime','delivery','imageInfo','visualReview','sha256']})
    write(QUEUE,{'expected':307,'sourceWorkbook':read(BASE/'approved-tasks.json')['source'],'tasks':tasks})
    print(json.dumps({'tasks':len(tasks),'ready':sum(t['status']!='pending' for t in tasks)}))
def ingest(filename,source,review):
    data=read(QUEUE);task=next(t for t in data['tasks'] if t['filename']==filename)
    source=Path(source);assert source.is_file(),source
    original=BASE/'originals'/task['scope']/filename;original.parent.mkdir(parents=True,exist_ok=True)
    if not original.exists(): shutil.copy2(source,original)
    im=Image.open(original).convert('RGBA');alpha=im.getchannel('A');extrema=alpha.getextrema()
    if task['transparent'] and extrema[0]!=0: raise ValueError('Expected real alpha; regenerate '+filename)
    # Image-generation exports may contain alpha=1 dust far outside the subject.
    # Use visible alpha for trim bounds, keep a two-pixel antialias margin, and
    # preserve the original RGBA pixels inside the crop (no alpha repainting).
    visible_box=alpha.point(lambda a: 255 if a >= 16 else 0).getbbox();assert visible_box
    box=(max(0,visible_box[0]-2),max(0,visible_box[1]-2),min(im.width,visible_box[2]+2),min(im.height,visible_box[3]+2)) if task['transparent'] else (0,0,im.width,im.height)
    content=im.crop(box) if task['transparent'] else im
    delivery=ROOT/'art_delivery/nm_v2'/task['scope']/filename;delivery.parent.mkdir(parents=True,exist_ok=True)
    if task['transparent']:
        exported=Image.new('RGBA',task['size'],(0,0,0,0))
        fitted=ImageOps.contain(content,task['size'],Image.Resampling.LANCZOS)
        exported.alpha_composite(fitted,((exported.width-fitted.width)//2,(exported.height-fitted.height)//2))
    else: exported=im.resize(task['size'],Image.Resampling.LANCZOS)
    exported.save(delivery,optimize=True)
    runtime=None
    if not task['referenceOnly']:
        runtime=ROOT/'public/art/nm-v2'/task['scope']/filename;runtime.parent.mkdir(parents=True,exist_ok=True)
        content.thumbnail((768,768),Image.Resampling.LANCZOS)
        content.save(runtime,optimize=True)
    task.update(status='generated_pending_runtime_review',source=str(source),original=str(original.relative_to(ROOT)),delivery=str(delivery.relative_to(ROOT)),runtime=str(runtime.relative_to(ROOT)) if runtime else None,sha256=hashlib.sha256(original.read_bytes()).hexdigest(),visualReview=review,imageInfo={'originalSize':list(im.size),'alphaExtrema':list(extrema),'contentBox':list(box),'runtimeSize':list(content.size) if runtime else None,'trimAlphaThreshold':16,'trimMarginPx':2,'postprocess':'Visible-alpha bounding-box crop with 2px antialias margin, aspect-preserving downsample and approved-canvas placement. Original alpha inside crop retained. No painting or recoloring.'})
    write(QUEUE,data)
    print(json.dumps({'filename':filename,'generated':sum(t['status']!='pending' for t in data['tasks']),'expected':307}))
def jobs(count,scope):
    data=read(QUEUE);ready={t['filename']:ROOT/t['original'] for t in data['tasks'] if t.get('original')}
    pending=[]
    for task in data['tasks']:
        if task['status']!='pending' or (scope and task['scope']!=scope):continue
        ref=task['referenceFilename']
        if ref and ref not in ready:continue
        row={k:task[k] for k in ['filename','displayName','prompt','transparent','scope','referenceOnly']}
        row['references']=[str(ready[ref])] if ref else []
        pending.append(row)
        if len(pending)>=count:break
    print(json.dumps(pending,ensure_ascii=False))
parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['prepare','import','jobs','status']);parser.add_argument('--filename');parser.add_argument('--source');parser.add_argument('--review',default='Generated original inspected for requested object; final in-game acceptance remains pending.');parser.add_argument('--count',type=int,default=4);parser.add_argument('--scope');args=parser.parse_args()
if args.mode=='prepare':prepare()
elif args.mode=='import':ingest(args.filename,args.source,args.review)
elif args.mode=='jobs':jobs(args.count,args.scope)
else:
    data=read(QUEUE);print(json.dumps({'expected':307,'generated':sum(t['status']!='pending' for t in data['tasks']),'pendingByScope':{s:sum(t['status']=='pending' and t['scope']==s for t in data['tasks']) for s in ['personnel','abnormalities','equipment','environment','ui_vfx']}},ensure_ascii=False))
