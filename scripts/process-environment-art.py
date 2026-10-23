"""Preserve generated originals; trim transparent margins and downscale runtime copies.
No content is painted or generated here. Image generation uses the built-in image_gen tool.
"""
from pathlib import Path
import hashlib
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "art-production/generated/environment"
RUNTIME = ROOT / "public/art/generated/environment"
RUNTIME.mkdir(parents=True, exist_ok=True)
manifest = json.loads((RAW / "generation-manifest.json").read_text(encoding="utf-8"))
records = []
for entry in manifest["entries"]:
    source = Path(entry["sourcePath"])
    original = RAW / (entry["name"] + ".png")
    if source.resolve() != original.resolve():
        shutil.copy2(source, original)
    image = Image.open(original).convert("RGBA")
    original_size = list(image.size)
    alpha = image.getchannel("A")
    bounds = alpha.getbbox() or (0, 0, image.width, image.height)
    # Opaque material tiles retain their full edge alignment. Alpha remains untouched.
    image = image.crop(bounds)
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    target = RUNTIME / original.name
    image.save(target, optimize=True)
    records.append({
        "name": entry["name"], "sourcePath": str(original.relative_to(ROOT)).replace("\\", "/"),
        "runtimePath": str(target.relative_to(ROOT)).replace("\\", "/"),
        "originalSize": original_size, "cropBounds": list(bounds), "runtimeSize": list(image.size),
        "alphaExtrema": list(image.getchannel("A").getextrema()),
        "sourceSha256": hashlib.sha256(original.read_bytes()).hexdigest(),
        "runtimeSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "processing": "original preserved; alpha-bounds crop; Lanczos downscale only"
    })
(RUNTIME / "manifest.json").write_text(json.dumps({"generator": "built-in image_gen", "requested": manifest["requested"], "count": len(records), "entries": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"processed": len(records), "requested": manifest["requested"]}))
