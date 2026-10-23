"""Re-export accepted images with visible-alpha bounds; originals remain intact."""
import json
import runpy
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
rows = json.loads((root / 'art-production/nm-v2/generation-queue.json').read_text(encoding='utf-8'))['tasks']
sys.argv = ['nm-v2-pipeline.py', 'status']
pipeline = runpy.run_path(str(root / 'scripts/nm-v2-pipeline.py'))
for row in rows:
    if row['status'] == 'pending':
        continue
    pipeline['ingest'](row['filename'], row['source'], row['visualReview'])
