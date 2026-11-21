"""Every model whose output a page shows must have a credit row on that page.

Page 2: reads the CREDITS table in web/film.html and the film payload in the
built site (SITE/data/tears-of-steel.js), and fails if any model in the
payload's series or 2D maps, or one of the models behind the captions,
transcript and speaker turns, has no entry.

Page 1: reads web/features.html and SITE/data/features1.js, and fails if a
model it shows has no credit row, if a picture lacks its credit or licence (or
disagrees with stimuli/manifest.tsv), or if a description space carries
anything but its similarity matrix and 2-D map (raw embeddings never ship).

Run (after fetch_assets):  python3 tests/check_credits.py _site
"""

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def credited(page):
    block = page[page.index("const CREDITS = {"):page.index("};", page.index("const CREDITS = {"))]
    return set(re.findall(r"^\s+([a-z0-9_]+): \[", block, flags=re.M))


def payload(path, marker):
    js = path.read_text()
    return json.loads(js[js.index(marker) + len(marker):js.rindex("}") + 1])


def page1(site):
    page = (ROOT / "web" / "features.html").read_text()
    have = credited(page)
    p1 = payload(Path(site) / "data" / "features1.js", "window.FEATURES1 = ")
    learned = re.search(r"const LEARNED_MODELS = \[([^\]]*)\]", page).group(1)
    used = {"llstat"} | set(re.findall(r'"([a-z0-9_]+)"', learned)) | {s["model"] for s in p1["spaces"]}
    missing = sorted(used - have)
    if missing:
        sys.exit(f"models shown on page 1 with no credit row: {', '.join(missing)}")
    with open(ROOT / "stimuli" / "manifest.tsv", newline="") as f:
        man = {m["id"]: m for m in csv.DictReader(f, delimiter="\t")}
    for it in p1["items"]:
        m = man.get(it["id"])
        if m is None or not all(it.get(k) for k in ("credit", "license", "page")):
            sys.exit(f"page 1 picture {it['id']}: credit, licence or source missing")
        if (it["credit"], it["license"]) != (m["attribution"], m["license"]):
            sys.exit(f"page 1 picture {it['id']}: credit or licence differs from stimuli/manifest.tsv")
    n = len(p1["items"])
    allowed = {"key", "label", "model", "what", "dims", "input", "zscored", "sep", "rdm", "xy"}
    for s in p1["spaces"]:
        if set(s) - allowed or len(s["rdm"]) != n * (n - 1) // 2 or any(len(p) != 2 for p in s["xy"]):
            sys.exit(f"page 1 space {s['key']}: carries more than its similarity matrix and 2-D map")
    print(f"page 1 credits ok: {len(used)} models shown, all credited; {n} pictures credited")


def main(site):
    page = (ROOT / "web" / "film.html").read_text()
    credited_ = credited(page)
    js = (Path(site) / "data" / "tears-of-steel.js").read_text()
    film = json.loads(js[js.index("= {") + 2:js.rindex("}") + 1])
    used = {s["model"] for s in film["series"]} | {p["model"] for p in film.get("proj", [])}
    used |= {"caption", "transcribe", "diarize"}
    missing = sorted(used - credited_)
    if missing:
        sys.exit(f"models shown on page 2 with no credit row: {', '.join(missing)}")
    if any(s["model"] == "egemaps" for s in film["series"]):
        sys.exit("egemaps outputs are in the payload; they must not ship (openSMILE terms)")
    print(f"page 2 credits ok: {len(used)} models shown, all credited")
    page1(site)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
