"""Collect generated candidates without treating them as accepted art."""
import json
import re
import shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'art-production/nm-v2'
tasks = {t['filename']: t for t in json.loads((BASE/'generation-queue.json').read_text(encoding='utf-8'))['tasks']}
found = {}
for path in sorted((BASE/'records').glob('*.json'), key=lambda p: p.stat().st_mtime):
    raw = json.loads(path.read_text(encoding='utf-8'))
    for item in raw if isinstance(raw, list) else [raw]:
        if item.get('filename') not in tasks:
            continue
        source = item.get('source')
        if not source and item.get('result'):
            match = re.search(r' as (.+?\.png) by default', item['result'].get('output_hint',''))
            if match:
                source = match.group(1)
        if source and Path(source).is_file():
            item.pop('result', None)
            item['source'] = source
            found[item['filename']] = item
    # Image bytes stay in immutable image files, never duplicate base64 in metadata.
    if isinstance(raw, dict) and 'result' in raw:
        raw.pop('result', None)
        if raw.get('filename') in found:
            raw['source'] = found[raw['filename']]['source']
        path.write_text(json.dumps(raw,ensure_ascii=False,indent=2),encoding='utf-8')
rows=[]
for name,item in found.items():
    task=tasks[name]
    dest=BASE/'candidates'/task['scope']/name
    dest.parent.mkdir(parents=True,exist_ok=True)
    if not dest.exists() or dest.stat().st_mtime < Path(item['source']).stat().st_mtime:
        shutil.copy2(item['source'],dest)
    rows.append({'filename':name,'source':item['source'],'candidate':str(dest.relative_to(ROOT)).replace('\\','/'),
        'scope':task['scope'],'displayName':task['displayName'],'status':task['status'], 'recordPrompt':item.get('prompt','')})
(BASE/'candidate-index.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'candidates':len(rows),'pending':sum(r['status']=='pending' for r in rows)}))
