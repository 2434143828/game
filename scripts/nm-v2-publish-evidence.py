"""Copy verified screenshots and publish a scoped summary from explicit reports."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
for name in ['run', 'production', 'equipment']:
    parser.add_argument('--' + name, required=True)
args = parser.parse_args()
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
run, prod, equipment = (root / p for p in [args.run, args.production, args.equipment])
r, p, e = (read(folder / 'report.json') for folder in [run, prod, equipment])
assert all(report['status'] == 'PASS' for report in [r, p, e])
queue = read(root / 'art-production/nm-v2/generation-queue.json')['tasks']
coverage = read(root / 'src/art/generated/nm-v2-coverage.json')
assert coverage == r['artCoverage'] and not coverage['pending']
assert all(not c['missing'] for c in r['creatureReadiness'])
assert all((root / t['delivery']).is_file() for t in queue)
assert all((root / t['runtime']).is_file() for t in queue if not t['referenceOnly'])
showcase = root / 'docs/showcase'
copies = {
    run / '05-employee-inside-room-working.png': 'nm-v2-work.png',
    run / '07-nailong-main-and-two-clones.png': 'nm-v2-breach.png',
    run / '08-actual-suppression-hit.png': 'nm-v2-combat.png',
    run / '09-retreating-after-suppression.png': 'nm-v2-retreat.png',
    run / '13-N03-breached.png': 'nm-v2-dog.png',
    run / '17-N05-breached.png': 'nm-v2-penguin.png',
    prod / '01-production-central-view.png': 'nm-v2-facility.png',
    prod / '02-home-overview.png': 'nm-v2-overview.png',
    prod / '15-formal-day-one-started.png': 'nm-v2-day-one.png',
    equipment / 'equipment-W01-A01.png': 'nm-v2-equipment.png',
}
hashes = []
for source, name in copies.items():
    destination = showcase / name
    shutil.copy2(source, destination)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert digest == hashlib.sha256(destination.read_bytes()).hexdigest()
    hashes.append({'file': name, 'source': source.relative_to(root).as_posix(), 'sha256': digest})
summary = {
    'date': r['finishedAt'][:10], 'assetDelivery': 'COMPLETE',
    'runtimeReplacement': 'VERIFIED_WITHIN_REPORTED_SCOPE',
    'fullGameAcceptance': 'NOT_REVALIDATED', 'coverage': coverage,
    'functional': {'status': r['status'], 'checks': len(r['checks']), 'inputs': len(r['inputs']), 'screenshots': len(r['screenshots'])},
    'equipment': {'status': e['status'], 'checks': len(e['checks']), 'inputs': len(e['inputs']), 'screenshots': len(e['screenshots'])},
    'production': {'status': p['status'], 'checks': len(p['checks']), 'pausePixels': p['pausePixels']},
    'sources': [(folder / 'report.json').relative_to(root).as_posix() for folder in [run, prod, equipment]],
    'screenshots': hashes,
    'limits': ['Full three-day replay not repeated for v2', 'All skill and equipment attack combinations not replayed', 'No cross-device performance claim', 'Legacy slice retains procedural art'],
}
(showcase / 'nm-v2-verification-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'coverage': coverage, 'showcaseCopies': len(hashes)}, ensure_ascii=False))
