"""Assemble the static site for GitHub Pages (or a local copy) in OUT_DIR.

Each page in web/ (index.html, film.html, features.html) is written as an artifact body: its
<title>, <meta>, <link> and <style> come first, then the page markup, with no
<!doctype> or <head>. This script moves that leading block into a real <head>,
wraps the rest in <body>, and copies the scripts and the FreeSurfer license
beside it. The film, page 1's pictures and clips, and the feature payloads are added afterwards by
build/fetch_assets.py.

Run:  python3 build/make_site.py _site
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BODY_START = '<div class="wrap">'
PAGES = ("index.html", "film.html", "features.html")


def wrap(page):
    cut = page.index(BODY_START)
    head, body = page[:cut], page[cut:]
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        f"{head.strip()}\n</head>\n<body>\n{body.strip()}\n</body>\n</html>\n"
    )


def main(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name in PAGES:
        (out / name).write_text(wrap((ROOT / "web" / name).read_text()))
    for name in ("brain.js", "sim.js", "hand.js", "gloss.js"):
        shutil.copy2(ROOT / "web" / name, out / name)
    shutil.copy2(ROOT / "licenses" / "FreeSurfer.txt", out / "FreeSurfer-license.txt")
    (out / ".nojekyll").write_text("")
    print(f"site written to {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
