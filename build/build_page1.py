"""Build page 1's media and data (What a feature is) from the extracted features.

Inputs are the series' own stimuli and the feature tables the extraction wrote
(viz2psy / word2psy outputs, aggregated by psytwill). Nothing here is fitted
or tuned: the script resizes, crops, cuts and summarises.

Writes into OUT_DIR, flat, one file per release asset:
  img-<id>.jpg      each image at viz2psy's canonical pixel area (425 x 425,
                    aspect kept, bicubic), JPEG q95 with 4:4:4 chroma. llstat
                    scores at exactly this size, so the page recomputes the
                    hand features on the same pixels the pipeline saw.
  atlas.jpg         all images as 96 px square thumbnails, 10 per row, in
                    payload order (loads first; the full image loads on pick)
  clip-<key>.mp3    short excerpts of the film for the live sound step
  features1.js      the payload: per-image features, credits, the 2-D maps and
                    item-by-item dissimilarities (RDMs) of each space. Raw
                    embedding vectors never ship (output-licence policy).

Run (Talapas, the stimfeat env, which has viz2psy, pandas, scikit-learn):
  python build/build_page1.py --features <teaching_dir>/derivatives/stimuli_features/psytwill \
      --images <teaching_dir>/images/set-v1 --film <teaching_dir>/media/tears-of-steel/tears-of-steel.mov \
      --out OUT_DIR
"""

import argparse
import csv
import json
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image
from scipy.stats import spearmanr
from sklearn.manifold import MDS
from viz2psy.models.base import canonical_size

ROOT = Path(__file__).resolve().parent.parent
CLASSES = ("face", "place", "object")
THUMB, COLS = 96, 10
NPERM = 10000

#: The live-sound excerpts (film seconds). Chosen from the film's own feature
#: series: diarized speech with no music, music with no speech, and loud
#: effects with neither (opening storm and explosion). Pitch is patchy on
#: this mix (music and room sound sit under every voice), so the notes promise
#: a pitch line only in patches.
CLIPS = [
    {"key": "speech", "label": "Two voices", "t0": 23.0, "t1": 30.5,
     "note": "Celia, then Thom. The pitch line appears only in patches: the film mixes room sound and music under the voices.",
     "lines": ["You're a jerk, Thom.", "Look Celia, we have to follow our passions;",
               "...you have your robotics, and I just want to be awesome in space."]},
    {"key": "music", "label": "Music", "t0": 269.5, "t1": 275.5,
     "note": "Score with a sung line and no dialogue. Several notes sound at once, so there is rarely a single pitch to find.", "lines": []},
    {"key": "effects", "label": "Storm and blast", "t0": 11.0, "t1": 17.0,
     "note": "Thunder, wind and an explosion: the loudest clip by far, energy at every frequency, and no pitch at all.", "lines": []},
]

#: Spaces shown as similarity structure. `z` z-scores each column across the
#: images first (llstat mixes units); the network spaces are used as computed.
SPACES = [
    {"key": "llstat", "label": "Pixel statistics", "table": "image", "model": "llstat", "z": True,
     "what": "viz2psy llstat: 17 hand-written image statistics"},
    {"key": "gist", "label": "GIST", "table": "image", "model": "gist", "z": False,
     "what": "GIST: oriented-filter energy over a 4 x 4 grid (no learning)"},
    {"key": "dinov2", "label": "DINOv2", "table": "image", "model": "dinov2", "z": False,
     "what": "DINOv2 ViT-B/14: a vision network trained without labels"},
    {"key": "clip", "label": "CLIP (image)", "table": "image", "model": "clip", "z": False,
     "what": "CLIP ViT-B/32 image embedding: trained to match pictures to captions"},
    {"key": "clip_text", "label": "CLIP (caption text)", "table": "caption", "model": "clip_text", "z": False,
     "what": "CLIP's text encoder run on each image's BLIP caption"},
    {"key": "minilm", "label": "MiniLM (caption text)", "table": "caption", "model": "minilm", "z": False,
     "what": "all-MiniLM-L6-v2 sentence embedding of each image's BLIP caption"},
]

HAND = {"lum": "llstat_luminance_mean", "contrast": "llstat_rms_contrast",
        "colour": "llstat_colorfulness", "edges": "llstat_edge_density"}


def wide(df, model):
    return df[df.model == model].pivot_table(index="stimulus_id", columns="feature", values="value")


def topk(row, prefix, k):
    s = row[[c for c in row.index if c.startswith(prefix)]].sort_values(ascending=False)[:k]
    return [[c[len(prefix):].replace("_", " "), round(float(v), 3)] for c, v in s.items()]


def r(x, nd=4):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def rdm(X):
    """1 - Pearson r between rows (items)."""
    Xc = X - X.mean(1, keepdims=True)
    Xc /= np.linalg.norm(Xc, axis=1, keepdims=True)
    return 1.0 - Xc @ Xc.T


def separation(D, cls):
    """Category structure in a dissimilarity matrix (MEASURED, shown on the page)."""
    n = len(cls)
    same = cls[:, None] == cls[None, :]
    iu = np.triu_indices(n, 1)
    Dn = D + np.diag(np.full(n, np.inf))
    nn = Dn.argmin(1)
    nn1 = float((cls[nn] == cls).mean())
    # Label-permutation null for nn1: neighbours fixed, categories shuffled.
    rng = np.random.default_rng(0)
    null = np.array([(p[nn] == p).mean() for p in (rng.permutation(cls) for _ in range(NPERM))])
    rho = spearmanr(D[iu], (~same)[iu].astype(float)).statistic
    return {"nn1": round(nn1, 3), "nn1_null95": round(float(np.quantile(null, 0.95)), 3),
            "nn1_p": round(float((np.sum(null >= nn1) + 1) / (NPERM + 1)), 4),
            "within": round(float(D[iu][same[iu]].mean()), 3),
            "between": round(float(D[iu][~same[iu]].mean()), 3), "rsa_category": round(float(rho), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--features", required=True, type=Path)
    ap.add_argument("--images", required=True, type=Path)
    ap.add_argument("--film", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    out = a.out
    out.mkdir(parents=True, exist_ok=True)

    with open(ROOT / "stimuli" / "manifest.tsv", newline="") as f:
        man = {m["id"]: m for m in csv.DictReader(f, delimiter="\t")}
    ids = sorted((i for i in man if man[i]["kind"].startswith("image")),
                 key=lambda i: (CLASSES.index(i.split("-")[0]), i))
    cls = np.array([i.split("-")[0] for i in ids])

    img = pd.read_parquet(a.features / "shared1000_image_features.parquet")
    cap = pd.read_parquet(a.features / "shared1000_caption_chunks_features.parquet")
    missing = set(ids) - set(img.stimulus_id)
    if missing:
        raise SystemExit(f"no features for {sorted(missing)}")
    W = {m: wide(img, m).reindex(ids) for m in
         ("llstat", "faces", "places", "yolo", "aesthetics", "resmem", "emonet", "depth", "context_affect")}
    captions = (img[(img.model == "caption") & (img.feature == "caption_text")]
                .set_index("stimulus_id").value_str.reindex(ids))

    # Images: canonical-size JPEGs plus the thumbnail atlas.
    rows = -(-len(ids) // COLS)
    atlas = Image.new("RGB", (COLS * THUMB, rows * THUMB), "white")
    items = []
    for k, sid in enumerate(ids):
        path, = a.images.glob(f"{sid}.*")
        src = Image.open(path).convert("RGB")  # as viz2psy loads it (alpha dropped)
        size = canonical_size(src.width, src.height)
        im = src.resize(size, Image.BICUBIC) if size != src.size else src
        im.save(out / f"img-{sid}.jpg", "JPEG", quality=95, subsampling=0)
        s = min(im.size)
        sq = im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width + s) // 2, (im.height + s) // 2))
        atlas.paste(sq.resize((THUMB, THUMB), Image.LANCZOS), ((k % COLS) * THUMB, (k // COLS) * THUMB))

        m = man[sid]
        ll, fa, pl, yo = W["llstat"].loc[sid], W["faces"].loc[sid], W["places"].loc[sid], W["yolo"].loc[sid]
        yolo_classes = [[c[5:].replace("_", " "), int(v)] for c, v in yo.items()
                        if v > 0 and c[5:] not in ("object_count", "category_count", "mean_confidence",
                                                     "object_coverage", "largest_object_ratio")]
        items.append({
            "id": sid, "cls": cls[k], "w": im.width, "h": im.height,
            "title": m["title"].rsplit(".", 1)[0].replace("_", " "), "page": m["source_url"],
            "credit": m["attribution"], "license": m["license"], "license_url": m["license_url"],
            "caption": captions[sid],
            "hand": {k2: r(ll[c]) for k2, c in HAND.items()},
            "ll": {c[7:]: r(v) for c, v in ll.items()},
            "learned": {
                "faces": int(fa["faces_count"]), "face_area": r(fa["faces_total_area"], 3),
                "places": topk(pl, "places_", 3), "sun": topk(pl, "sunattr_", 3),
                "objects": sorted(yolo_classes, key=lambda x: -x[1]),
                "aesthetics": r(W["aesthetics"].loc[sid, "aesthetics_score"], 2),
                "memorability": r(W["resmem"].loc[sid, "resmem_memorability"], 3),
                "emotions": topk(W["emonet"].loc[sid], "emonet_", 3),
                "openness": r(W["depth"].loc[sid, "depth_openness"], 3),
                "valence": r(W["context_affect"].loc[sid, "context_affect_valence"], 2),
                "arousal": r(W["context_affect"].loc[sid, "context_affect_arousal"], 2),
            },
        })
    atlas.save(out / "atlas.jpg", "JPEG", quality=85)

    # Step 2's claim: the four hand features alone (z-scored, Euclidean 1-NN).
    H = W["llstat"][list(HAND.values())].to_numpy(float)
    H = (H - H.mean(0)) / H.std(0)
    Dh = np.sqrt(((H[:, None] - H[None]) ** 2).sum(-1))
    hand_sep = separation(Dh, cls)

    # Spaces: RDM, category separation and a 2-D map.
    spaces = []
    for sp in SPACES:
        src = img if sp["table"] == "image" else cap
        X = wide(src, sp["model"]).reindex(ids).to_numpy(float)
        if np.isnan(X).any():
            raise SystemExit(f"{sp['key']}: NaN in the feature matrix")
        if sp["z"]:
            X = (X - X.mean(0)) / X.std(0)
        D = rdm(X)
        xy = MDS(n_components=2, metric="precomputed", init="classical_mds", n_init=1,
                 random_state=0).fit_transform(D)
        xy = (xy - xy.mean(0)) / np.abs(xy).max()
        iu = np.triu_indices(len(ids), 1)
        spaces.append({**{k: sp[k] for k in ("key", "label", "model", "what")}, "dims": X.shape[1],
                       "input": sp["table"], "zscored": sp["z"], "sep": separation(D, cls),
                       "rdm": [round(float(v), 3) for v in D[iu]],
                       "xy": [[round(float(x), 3), round(float(y), 3)] for x, y in xy]})

    # Clips: mono MP3 excerpts (-ss before -i seeks; -t is a duration here).
    clips = []
    for c in CLIPS:
        name = f"clip-{c['key']}.mp3"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(c["t0"]), "-i", str(a.film),
                        "-t", str(c["t1"] - c["t0"]), "-vn", "-ac", "1", "-ar", "44100",
                        "-b:a", "128k", str(out / name)], check=True)
        clips.append({**c, "file": f"media/p1/{name}"})

    payload = {"version": 1, "classes": list(CLASSES), "items": items, "spaces": spaces,
               "hand_sep": hand_sep, "clips": clips,
               "atlas": {"file": "media/p1/atlas.jpg", "cell": THUMB, "cols": COLS},
               "image_dir": "media/p1/"}
    (out / "features1.js").write_text("window.FEATURES1 = " + json.dumps(payload, separators=(",", ":")) + ";\n")

    print("hand features (4, z, Euclidean):", hand_sep)
    for sp in spaces:
        print(f"{sp['key']:10s} dims={sp['dims']:4d}", sp["sep"])
    print(f"payload {(out / 'features1.js').stat().st_size / 1e3:.0f} KB; atlas "
          f"{(out / 'atlas.jpg').stat().st_size / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
