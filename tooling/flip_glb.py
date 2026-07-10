"""Flip GLB(s) 180 deg about X (turn an upside-down Hunyuan/TripoSR export upright) and re-rest the
base on y=0, preserving textures. Usage: flip_glb.py <glb-or-dir> [key1 key2 ...]

The realistic-3d-objects Blender step can emit pedestal-up (inverted) meshes for pedestalled
figurines; the only reliable orientation QA is the isolated Three.js viewer (web/_viewer.html) with an
AxesHelper. When a set comes out uniformly inverted, run this to correct them on disk."""
import sys
import pathlib
import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix, translation_matrix

target = pathlib.Path(sys.argv[1])
keys = sys.argv[2:]
paths = ([target] if target.is_file()
         else [target / f"{k}.glb" for k in keys] if keys
         else sorted(target.glob("*.glb")))

for p in paths:
    s = trimesh.load(str(p))
    s.apply_transform(rotation_matrix(np.pi, [1, 0, 0]))         # pedestal: top -> bottom
    b = s.bounds
    s.apply_transform(translation_matrix([-(b[0][0] + b[1][0]) / 2, -b[0][1], -(b[0][2] + b[1][2]) / 2]))
    s.export(str(p))
    nb = s.bounds
    print(f"{p.name}: y {nb[0][1]:.2f}..{nb[1][1]:.2f}")
