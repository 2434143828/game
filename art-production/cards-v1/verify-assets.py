"""Read PNG metadata and verify byte-for-byte provenance; never edit images."""
import hashlib
import json
import struct
from pathlib import Path

root = Path(__file__).resolve().parents[2]
folder = root / 'art-production/cards-v1'
req = json.loads((folder / 'requirements.json').read_text(encoding='utf-8'))
imports = json.loads((folder / 'generated-imports.json').read_text(encoding='utf-8-sig'))
index = {x['cardId']: x for x in imports}
assets = []
for item in req['items']:
    source = index[item['cardId']]
    data = (root / item['path']).read_bytes()
    original = Path(source['original']).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', item['path']
    assert data == original, f"Imported file differs from generated original: {item['path']}"
    width, height = struct.unpack('>II', data[16:24])
    assert width == height, item['path']
    sha = hashlib.sha256(data).hexdigest()
    assets.append({'cardId': item['cardId'], 'name': item['name'], 'path': item['path'],
                   'original': source['original'], 'sha256': sha, 'bytes': len(data),
                   'width': width, 'height': height, 'sourceUnchanged': True,
                   'generation': 'built-in imagegen',
                   'implementation': 'src/v3/CardHand.ts',
                   'runtimeVerification': 'See root gameplay evidence; not established by this asset audit'})
    item.update(status='已生成', actualWidth=width, actualHeight=height,
                implementationStatus='已接入代码', implementation='src/v3/CardHand.ts', sha256=sha)
manifest = {'version': 'cards-v1', 'verifiedDate': '2026-10-24', 'assetCount': len(assets),
            'totalBytes': sum(x['bytes'] for x in assets), 'sourceUnchangedCount': len(assets),
            'validationScope': 'PNG dimensions, exact byte equality against source, SHA-256, card ID coverage',
            'assets': assets}
(folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
(folder / 'requirements.json').write_text(json.dumps(req, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'count': len(assets), 'dimensions': sorted(set((x['width'],x['height']) for x in assets)), 'totalBytes': manifest['totalBytes']},ensure_ascii=False))
