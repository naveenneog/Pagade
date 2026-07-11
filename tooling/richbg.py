"""Make richer projection images: cut the object (rembg), composite it on a background of the
object's OWN dominant colour (so mesh faces that sample the bg read as matching stone, not ivory
cream), and boost saturation/contrast a touch. Fixes the pale two-tone look of concept-projection.

Usage: richbg.py <in_dir> <out_dir> key1 key2 ...
Writes <out_dir>/<key>.proj.jpg
"""
import sys
import pathlib
import numpy as np
import rembg
from PIL import Image, ImageEnhance

in_dir = pathlib.Path(sys.argv[1])
out_dir = pathlib.Path(sys.argv[2])
keys = sys.argv[3:]
out_dir.mkdir(parents=True, exist_ok=True)
session = rembg.new_session()

for k in keys:
    src = in_dir / f"{k}.jpg"
    if not src.exists():
        print("skip", k); continue
    img = Image.open(src).convert("RGB")
    cut = rembg.remove(img, session=session).convert("RGBA")
    arr = np.array(cut)
    mask = arr[:, :, 3] > 128
    px = arr[:, :, :3][mask]
    # dominant = median of the object pixels, nudged a touch darker for a deeper stone base
    dom = tuple(int(c * 0.9) for c in np.median(px, axis=0).astype(int))
    bg = Image.new("RGBA", cut.size, dom + (255,))
    out = Image.alpha_composite(bg, cut).convert("RGB")
    out = ImageEnhance.Color(out).enhance(1.4)      # richer saturation
    out = ImageEnhance.Contrast(out).enhance(1.12)
    dst = out_dir / f"{k}.proj.jpg"
    out.save(dst, "JPEG", quality=92)
    print(f"richbg {k} dom={dom}")
