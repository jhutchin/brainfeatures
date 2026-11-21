"""Put the site's media and data assets into OUT_DIR, checking each checksum.

The film and the feature payload are too large, or too derived, to keep in git.
They are attached to a GitHub release of this repo, and build/assets.tsv lists
each one: where the site serves it (path), the release tag, the asset name and
its sha256.

Run:  python3 build/fetch_assets.py _site               # download from the release
      python3 build/fetch_assets.py _site --from DIR    # copy from DIR/<name> instead

A missing or mismatched asset is an error: the build stops rather than publish
a page whose film or data is wrong.
"""

import argparse
import csv
import hashlib
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "jhutchin/brainfeatures"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--from", dest="src", help="local directory holding the asset files")
    args = ap.parse_args()
    out = Path(args.out_dir)
    with open(ROOT / "build" / "assets.tsv", newline="") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))
    bad = 0
    for r in rows:
        dest = out / r["path"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and sha256(dest) == r["sha256"]:
            print(f"ok      {r['path']} (already present)")
            continue
        tmp = dest.with_suffix(dest.suffix + ".part")
        if args.src:
            shutil.copyfile(Path(args.src) / r["name"], tmp)
        else:
            url = f"https://github.com/{REPO}/releases/download/{r['release']}/{r['name']}"
            with urllib.request.urlopen(url) as resp, open(tmp, "wb") as f:
                shutil.copyfileobj(resp, f)
        got = sha256(tmp)
        if got != r["sha256"]:
            print(f"BAD     {r['path']}: sha256 {got}, expected {r['sha256']}", file=sys.stderr)
            tmp.unlink()
            bad += 1
            continue
        tmp.replace(dest)
        print(f"fetched {r['path']} ({dest.stat().st_size / 1e6:.1f} MB)")
    if bad:
        sys.exit(f"{bad} asset(s) failed the checksum")


if __name__ == "__main__":
    main()
