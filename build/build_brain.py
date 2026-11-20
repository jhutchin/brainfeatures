"""Export the fsaverage5 surfaces and Destrieux labels as web/brain.js.

The page loads brain.js with a <script> tag, so it also opens from disk
(file://) without a local server.

Run:  uv run --no-project --with nilearn python build/build_brain.py
"""

import base64
import json
from pathlib import Path

import numpy as np
from nilearn import datasets, surface

OUT = Path(__file__).resolve().parent.parent / "web" / "brain.js"

# FreeSurfer's license (Part B 1(b), 1(d)) asks that every copy carry its
# terms with this preface and that modified data be marked as modified.
NOTICE = """/* MODIFIED data derived from FreeSurfer (fsaverage5 surfaces, sulcal depth,
 * Destrieux aparc.a2009s labels): converted to binary arrays, sulcal depth
 * rescaled and quantized to 8 bits. Not the original FreeSurfer files.
 *
 * All or portions of this licensed product (such portions are the
 * "Software") have been obtained under license from The General Hospital
 * Corporation "MGH" and are subject to the following terms and conditions:
 * the FreeSurfer Software License Agreement, Version 1.0 (February 2011),
 * reproduced in full in licenses/FreeSurfer.txt, served beside this file
 * as FreeSurfer-license.txt.
 */
"""


def b64(array):
    return base64.b64encode(np.ascontiguousarray(array).tobytes()).decode("ascii")


def main():
    fs = datasets.fetch_surf_fsaverage("fsaverage5")
    atlas = datasets.fetch_atlas_surf_destrieux()
    labels = [l.decode() if isinstance(l, bytes) else str(l) for l in atlas["labels"]]

    hemis = {}
    for hemi, key in (("L", "left"), ("R", "right")):
        meshes = {name: surface.load_surf_mesh(fs[f"{name}_{key}"]) for name in ("infl", "pial", "sphere")}
        faces = meshes["infl"].faces
        assert faces.max() < 2**16
        sulc = surface.load_surf_data(fs[f"sulc_{key}"]).astype(np.float64)
        sulc = np.clip(sulc / np.percentile(np.abs(sulc), 99), -1, 1)
        hemis[hemi] = {
            "n": int(meshes["infl"].coordinates.shape[0]),
            "infl": b64(meshes["infl"].coordinates.astype(np.float32)),
            "pial": b64(meshes["pial"].coordinates.astype(np.float32)),
            "sphere": b64(meshes["sphere"].coordinates.astype(np.float32)),
            "faces": b64(faces.astype(np.uint16)),
            "sulc": b64(np.round(sulc * 127).astype(np.int8)),
            "label": b64(np.asarray(atlas[f"map_{key}"]).astype(np.uint8)),
        }

    payload = {
        "template": "fsaverage5",
        "atlas": "Destrieux (aparc.a2009s)",
        "labels": labels,
        "hemis": hemis,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(NOTICE + "window.BRAIN_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
