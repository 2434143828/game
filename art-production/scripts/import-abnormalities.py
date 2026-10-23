"""Copy built-in imagegen outputs; inspect alpha without modifying image pixels."""
import json
from pathlib import Path
from shutil import copy2
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'art-production/abnormalities-manifest.json'
data = json.loads(MANIFEST.read_text(encoding='utf-8'))
raw = ROOT / 'art-production/generated/abnormalities'
runtime = ROOT / 'public/art/generated/abnormalities'
raw.mkdir(parents=True, exist_ok=True)
runtime.mkdir(parents=True, exist_ok=True)
for job in data['jobs']:
    if job['status'] != 'generated':
        continue
    source = Path(job['sourcePath'])
    target = raw / job['file']
    if not target.exists() or source.stat().st_mtime_ns > target.stat().st_mtime_ns:
        copy2(source, target)
    if not (runtime / job['file']).exists():
        copy2(source, runtime / job['file'])
    with Image.open(target) as image:
        alpha = image.getchannel('A') if 'A' in image.getbands() else None
        bounds = alpha.getbbox() if alpha else None
        job['alphaQa'] = {'size': list(image.size), 'mode': image.mode,
                         'alphaExtrema': list(alpha.getextrema()) if alpha else None,
                         'alphaBounds': list(bounds) if bounds else None}
    job['rawPath'] = str(target)
    job['runtimePath'] = str(runtime / job['file'])
    job['url'] = '/art/generated/abnormalities/' + job['file']
data['generated'] = sum(job['status'] == 'generated' for job in data['jobs'])
MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'requested':data['requested'], 'generated':data['generated']}))
