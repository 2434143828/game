"""Build exact runtime texture inventory from the approved brief; no gameplay edits."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

tasks = read(ROOT / 'art-production/nm-v2/generation-queue.json')['tasks']
available = {t['filename'] for t in tasks if t.get('runtime') and
             t['status'] != 'pending' and (ROOT / t['runtime']).is_file()}
groups = read(ROOT / 'docs/art-brief-v2/characters-v2.json')
by_id = {g['id']: g for g in groups}
personnel = []
for task in tasks:
    if task['scope'] not in ('personnel', 'equipment') or task['filename'] not in available:
        continue
    group = by_id[task['groupId']]
    personnel.append({'id': (group['oldIds'] or [group['id']])[0],
        'key': task['filename'][:-4], 'url': '/art/nm-v2/' + task['scope'] + '/' + task['filename']})
write(ROOT / 'src/art/generated/nm-v2-personnel-manifest.json', personnel)

# The first 67 environment units retain the original mounting order and geometry.
source = (ROOT / 'src/art/generated/EnvironmentArt.ts').read_text(encoding='utf-8')
old_names = re.findall(r'"([a-z0-9_]+)"', source.split('] as const;')[0])
environment = [t for t in tasks if t['scope'] == 'environment']
assert len(old_names) == 67 and len(environment) == 81
write(ROOT / 'src/art/generated/nm-v2-environment-map.json',
      dict(zip(old_names, [t['filename'][:-4] for t in environment[:67]])))
write(ROOT / 'src/art/generated/nm-v2-runtime-inventory.json', [
    {'key': t['filename'][:-4], 'scope': t['scope'], 'url': '/art/nm-v2/' + t['scope'] + '/' + t['filename']}
    for t in tasks if t['filename'] in available])
write(ROOT / 'src/art/generated/nm-v2-coverage.json', {
    'expected': len(tasks), 'imported': sum(t['status'] != 'pending' for t in tasks),
    'runtimeExpected': sum(not t['referenceOnly'] for t in tasks), 'runtimeAvailable': len(available),
    'pending': [{'filename': t['filename'], 'scope': t['scope'], 'referenceOnly': t['referenceOnly']}
                for t in tasks if t['status'] == 'pending'],
})
print(json.dumps({'personnel': len(personnel), 'environment': len(environment),
    'runtime': sum(not t['referenceOnly'] for t in tasks)}))
