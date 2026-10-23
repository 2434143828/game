"""Validate environment generation coverage and real-browser resource usage."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[1]
groups = json.loads((root / 'docs/art-brief-work/environment.json').read_text(encoding='utf-8'))
units = json.loads((root / 'docs/art-brief-work/environment_units.json').read_text(encoding='utf-8'))
expected = [group['name'] + '_' + unit['suffix'] for group in groups for unit in units[group['id']]]
raw = json.loads((root / 'art-production/generated/environment/generation-manifest.json').read_text(encoding='utf-8'))
runtime = json.loads((root / 'public/art/generated/environment/manifest.json').read_text(encoding='utf-8'))
inspection = json.loads((root / 'art-production/inspection/environment/state.json').read_text(encoding='utf-8'))
assert len(expected) == len(set(expected)) == 67
assert set(expected) == {entry['name'] for entry in raw['entries']}
assert set(expected) == {entry['name'] for entry in runtime['entries']}
for entry in runtime['entries']:
    assert hashlib.sha256((root / entry['sourcePath']).read_bytes()).hexdigest() == entry['sourceSha256']
    assert hashlib.sha256((root / entry['runtimePath']).read_bytes()).hexdigest() == entry['runtimeSha256']
state = inspection['state']
assert state['environmentComplete'] and not state['missing']
assert all(state['environmentUsage'].get(name, 0) > 0 for name in expected)
assert not inspection['errors']
assert not [message for message in inspection['consoleMessages'] if 'environment:' in message]
report = {
    'requested': 67, 'generated': len(raw['entries']), 'runtime': len(runtime['entries']),
    'uniqueGeneratedSources': len({entry['sourcePath'] for entry in raw['entries']}),
    'allSourceAndRuntimeHashesVerified': True,
    'browserEnvironmentComplete': True, 'browserUsedTextures': len(state['environmentUsage']),
    'browserUsage': state['environmentUsage'],
    'environmentLoadErrors': [], 'pageErrors': inspection['errors'],
    'evidence': 'art-production/inspection/environment',
    'scope': 'Environment image coverage, source provenance, runtime load and actual image placement. Gameplay regression is owned by the parent task.',
    'visualReview': 'Viewed actual default, overview and five-room screenshots. Darkened distant texture, closed ceiling gap and kept final ladder fragment at fixed rung scale. Original room/path/employee coordinates are unchanged.',
    'developmentNote': 'Vite watch-ignore can leave newly created public files absent from its startup file cache; restarting the dev server after generation resolved HTML responses for PNG paths.',
    'otherCategories': 'N04/N05 creature parts were still being generated during this bounded environment inspection. Their console messages are retained in the inspection state and are not reported as environment failures.'
}
(root / 'art-production/generated/environment/verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ['requested','generated','runtime','uniqueGeneratedSources','allSourceAndRuntimeHashesVerified','browserEnvironmentComplete','browserUsedTextures']}))
