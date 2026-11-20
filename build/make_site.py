"""Assemble the static site for GitHub Pages (or a local copy) in OUT_DIR.

web/index.html is written as an artifact body: its <title>, <meta>, <link>
and <style> come first, then the page markup, with no <!doctype> or <head>.
This script moves that leading block into a real <head>, wraps the rest in
<body>, and copies the scripts and the FreeSurfer license beside it.

Run:  python3 build/make_site.py _site
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BODY_START = '<div class="wrap">'


def main(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    page = (ROOT / "web" / "index.html").read_text()
    cut = page.index(BODY_START)
    head, body = page[:cut], page[cut:]
    html = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        f"{head.strip()}\n</head>\n<body>\n{body.strip()}\n</body>\n</html>\n"
    )
    (out / "index.html").write_text(html)
    for name in ("brain.js", "sim.js"):
        shutil.copy2(ROOT / "web" / name, out / name)
    shutil.copy2(ROOT / "licenses" / "FreeSurfer.txt", out / "FreeSurfer-license.txt")
    (out / ".nojekyll").write_text("")
    print(f"site written to {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
