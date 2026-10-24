"""Import reviewed researcher cutouts; preserve imagegen originals and alpha."""
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'art-production/personnel-v3'
target = root / 'public/art/personnel-v3'
target.mkdir(parents=True, exist_ok=True)
brief = json.loads((source / 'brief.json').read_text(encoding='utf-8'))
manifest = []
records = []
for job in brief['jobs']:
    path = source / (job['key'] + '.png')
    im = Image.open(path).convert('RGBA')
    alpha = im.getchannel('A')
    low, high = alpha.getextrema()
    assert low == 0 and high >= 250, path
    box = alpha.point(lambda a: 255 if a >= 128 else 0).getbbox()
    assert box
    box = (max(0, box[0]-2), max(0, box[1]-2), min(im.width, box[2]+2), min(im.height, box[3]+2))
    image = im.crop(box)
    image.thumbnail((512, 512), Image.Resampling.LANCZOS)
    image.save(target / path.name, optimize=True)
    manifest.append({'key': 'personnel_v3_' + job['key'], 'url': '/art/personnel-v3/' + path.name})
    records.append({'key': job['key'], 'source': path.relative_to(root).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'trim': box, 'runtimeSize': image.size})
(root / 'src/art/generated/personnel-v3-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
(source / 'import-records.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'imported': len(records)}))
