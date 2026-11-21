"""Every model whose output page 2 shows must have a credit row on the page.

Reads the CREDITS table in web/film.html and the film payload in the built
site (SITE/data/tears-of-steel.js), and fails if any model in the payload's
series or 2D maps, or one of the models behind the captions, transcript and
speaker turns, has no entry.

Run (after fetch_assets):  python3 tests/check_credits.py _site
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main(site):
    page = (ROOT / "web" / "film.html").read_text()
    block = page[page.index("const CREDITS = {"):page.index("};", page.index("const CREDITS = {"))]
    credited = set(re.findall(r"^\s+([a-z0-9_]+): \[", block, flags=re.M))
    js = (Path(site) / "data" / "tears-of-steel.js").read_text()
    film = json.loads(js[js.index("= {") + 2:js.rindex("}") + 1])
    used = {s["model"] for s in film["series"]} | {p["model"] for p in film.get("proj", [])}
    used |= {"caption", "transcribe", "diarize"}
    missing = sorted(used - credited)
    if missing:
        sys.exit(f"models shown on page 2 with no credit row: {', '.join(missing)}")
    if any(s["model"] == "egemaps" for s in film["series"]):
        sys.exit("egemaps outputs are in the payload; they must not ship (openSMILE terms)")
    print(f"credits ok: {len(used)} models shown, all credited")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
