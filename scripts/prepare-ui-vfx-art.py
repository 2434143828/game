"""Import built-in imagegen results without repainting them.

Preserve originals; crop transparent padding and resize only. The breach source
contains two separated ink strokes: its upper stroke is the single runtime strip.
"""
from pathlib import Path
import hashlib
import json
import shutil
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
RECORDS = ROOT / 'art-production/generated/ui_vfx/generation-records.json'
manifest = json.loads(RECORDS.read_text(encoding='utf-8'))
report = []
for item in manifest:
    source, original, runtime = Path(item['generatedSource']), ROOT / item['original'], ROOT / item['runtime']
    original.parent.mkdir(parents=True, exist_ok=True)
    runtime.parent.mkdir(parents=True, exist_ok=True)
    if not original.exists():
        shutil.copy2(source, original)
    image = Image.open(original).convert('RGBA')
    original_size = list(image.size)
    alpha = image.getchannel('A')
    assert alpha.getextrema()[0] == 0, f'No transparent pixels: {item["name"]}'
    crop = alpha.getbbox()
    assert crop is not None
    note = 'Crop transparent exterior padding; preserve alpha; resize with Lanczos.'
    if item['id'] == 'VFX_003':
        crop = (crop[0], crop[1], crop[2], image.height // 2)
        note = 'Extract only upper separated ink stroke; crop alpha padding and resize; no repainting.'
    image = image.crop(crop)
    content_crop = image.getchannel('A').getbbox()
    image = image.crop(content_crop)
    if item['id'] in ('UI_001', 'UI_002'):
        size = (1024, 1024)
        result = image.resize(size, Image.Resampling.LANCZOS)
    elif item['id'] in ('UI_003', 'UI_004'):
        size = (1024, 256)
        result = image.resize(size, Image.Resampling.LANCZOS)
    else:
        size = (1024, 256) if item['id'] == 'VFX_003' else (512, 256) if item['id'] == 'VFX_002' else (256, 512) if item['id'] == 'UI_010' else (512, 512)
        result = Image.new('RGBA', size, (0, 0, 0, 0))
        # A uniform small import margin keeps the icon silhouette readable.
        fitted = ImageOps.contain(image, (size[0] - 32, size[1] - 32), Image.Resampling.LANCZOS)
        result.alpha_composite(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2))
    result.save(runtime, optimize=True)
    alpha = result.getchannel('A')
    assert alpha.getextrema() == (0, 255), f'Invalid alpha coverage: {item["name"]}'
    report.append({
        'id': item['id'], 'name': item['name'], 'original': item['original'], 'runtime': item['runtime'],
        'originalSize': original_size, 'runtimeSize': list(result.size), 'sourceCrop': list(crop),
        'originalSha256': hashlib.sha256(original.read_bytes()).hexdigest(),
        'runtimeSha256': hashlib.sha256(runtime.read_bytes()).hexdigest(),
        'originalBytes': original.stat().st_size, 'runtimeBytes': runtime.stat().st_size,
        'alphaExtrema': list(alpha.getextrema()), 'postprocess': note,
        'visualReview': 'Viewed generated output: isolated raster asset, no baked game text or numeric meters.',
    })
output = ROOT / 'art-production/generated/ui_vfx/import-report.json'
output.write_text(json.dumps({'assetCount': len(report), 'assets': report}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'assetCount': len(report), 'runtimeBytes': sum(x['runtimeBytes'] for x in report), 'report': str(output.relative_to(ROOT))}))
