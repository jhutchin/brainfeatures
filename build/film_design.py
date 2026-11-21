"""Write page 3's film design: the film's feature series for the simulated features.

Reads page 2's payload (SITE/data/tears-of-steel.js, from the media-v1 release)
and writes SITE/data/film-design.js with one series per simulated feature, as
the film measured it. Values are copied unchanged; page 3 (sim.js
makeFilmDesign) does the scaling and the hemodynamic convolution in the open.
Deriving this at build time keeps one source of truth: the payload.

Run (after fetch_assets):  python3 build/film_design.py _site
"""

import json
import sys
from pathlib import Path

#: Simulated feature -> the film series that measures it (page 2 shows the same
#: eight lanes). `binary` turns a count into presence, matching how page 3
#: defines the feature ("whether a face is on screen").
MAP = {
    "brightness": {"f": "llstat_luminance_mean", "name": "Brightness"},
    "motion": {"f": "motion_energy", "name": "Visual motion"},
    "faces": {"f": "faces_count", "name": "Faces", "binary": True},
    "places": {"f": "sunattr_open_area", "name": "Open space"},
    "valence": {"f": "context_affect_valence", "name": "Scene pleasantness"},
    "loudness": {"f": "loudness_db", "name": "Loudness"},
    "speech": {"f": "conversation_speech_fraction", "name": "Speech"},
    "social": {"f": "conversation_n_speakers", "name": "Voices talking"},
}


def main(site):
    js = (Path(site) / "data" / "tears-of-steel.js").read_text()
    film = json.loads(js[js.index("= {") + 2:js.rindex("}") + 1])
    series = {s["f"]: s for s in film["series"]}
    out = {"slug": film["slug"], "title": film["title"], "duration": film["duration"], "features": {}}
    for fid, m in MAP.items():
        s = series.get(m["f"])
        if s is None or s["align"] != "grid":
            raise SystemExit(f"{fid}: series {m['f']} missing from the payload or not on a grid")
        if any(v is None for v in s["v"]):
            raise SystemExit(f"{fid}: series {m['f']} has gaps; page 3 needs a complete series")
        out["features"][fid] = {"series": m["f"], "model": s["model"], "name": m["name"],
                                "binary": bool(m.get("binary")), "t0": s["t0"], "dt": s["dt"], "v": s["v"]}
    dest = Path(site) / "data" / "film-design.js"
    dest.write_text("window.FILM_DESIGN = " + json.dumps(out, separators=(",", ":")) + ";\n")
    print(f"film design: {len(out['features'])} series, {dest.stat().st_size / 1e3:.0f} KB -> {dest}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
