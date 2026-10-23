"""Import only candidates explicitly inspected in saved review sheets."""
import json, runpy, sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
spec=Path(sys.argv[1])
selections=json.loads(spec.read_text(encoding='utf-8'))
sys.argv=['nm-v2-pipeline.py','status']
pipeline=runpy.run_path(str(root/'scripts/nm-v2-pipeline.py'))
for selection in selections:
    rows=json.loads((root/'art-production/nm-v2/review-pages'/f"{selection['sheet']}.json").read_text(encoding='utf-8'))
    for index in selection['indices']:
        row=rows[index]
        queue=json.loads((root/'art-production/nm-v2/generation-queue.json').read_text(encoding='utf-8'))
        task=next(t for t in queue['tasks'] if t['filename']==row['filename'])
        if task['status']!='pending': continue
        pipeline['ingest'](row['filename'],row['source'],selection['review'])
