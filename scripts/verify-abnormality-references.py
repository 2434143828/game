"""Audit the 49 generated animation references; never writes runtime assets."""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'art-production/generated/abnormalities-references'
records = json.loads((DEST / 'generation-records.json').read_text(encoding='utf-8'))
units = json.loads((ROOT / 'docs/art-brief-work/characters_units.json').read_text(encoding='utf-8'))
rows = json.loads((ROOT / 'docs/art-brief-work/characters.json').read_text(encoding='utf-8'))
expected = {row['name'] + '_' + unit['suffix']: row['id'] for row in rows
            if row['id'].startswith('ABN_') and row['id'].endswith(('_02', '_05'))
            for unit in units[row['id']]}
assert len(expected) == 49
assert len(records) == len({record['name'] for record in records}), 'Duplicate manifest key'
actual = {record['name']: record for record in records}
missing = sorted(set(expected) - set(actual))
extra = sorted(set(actual) - set(expected))
assets = []
for name, record in actual.items():
    path = ROOT / record['original']
    image = Image.open(path).convert('RGBA')
    alpha = image.getchannel('A')
    alpha_min, alpha_max = alpha.getextrema()
    assert alpha_min == 0 and alpha_max >= 250, f'Alpha range invalid: {name}'
    assert record['runtime'] is False
    assets.append({'name': name, 'rowId': record['id'], 'path': record['original'],
        'size': list(image.size), 'alphaExtrema': list(alpha.getextrema()),
        'contentBounds': list(alpha.getbbox()), 'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
font_path = Path('C:/Windows/Fonts/consola.ttf')
font = ImageFont.truetype(str(font_path), 12) if font_path.exists() else ImageFont.load_default()
for animal in ['N01', 'N02', 'N03', 'N04', 'N05']:
    selected = [asset for asset in assets if animal in asset['rowId']]
    if not selected:
        continue
    sheet = Image.new('RGB', (1500, ((len(selected) + 4) // 5) * 360), '#514943')
    draw = ImageDraw.Draw(sheet)
    for i, asset in enumerate(selected):
        x, y = i % 5 * 300, i // 5 * 360
        draw.rectangle((x + 3, y + 3, x + 297, y + 357), fill='#d9c9a4', outline='#211e24')
        image = Image.open(ROOT / asset['path']).convert('RGBA')
        thumb = ImageOps.contain(image, (280, 306), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (x + 150 - thumb.width // 2, y + 10 + (306 - thumb.height) // 2), thumb)
        draw.text((x + 12, y + 322), asset['rowId'], font=font, fill='#211e24')
        draw.text((x + 12, y + 340), actual[asset['name']]['suffix'], font=font, fill='#211e24')
    sheet.save(DEST / f'contact-sheet-{animal}.png')
report = {'expectedCount': 49, 'generatedCount': len(records), 'missing': missing, 'extra': extra,
    'scope': 'Independent static production pose references only; not runtime sprites or completed animation.',
    'totalBytes': sum(asset['bytes'] for asset in assets), 'assets': assets}
(DEST / 'verification-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ['expectedCount', 'generatedCount', 'missing', 'extra', 'totalBytes']}))
assert not missing and not extra, 'Incomplete reference coverage'
