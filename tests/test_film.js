// node tests/test_film.js _site — page 3's film mode, on the real film design.
// Needs SITE/data/film-design.js (build/film_design.py, after fetch_assets).
// Checks, at the page's default noise (0.5) and first seed, that:
//   1. the planted maps come back and the null feature stays near nominal;
//   2. the omitted-variable lesson holds on the film: with Speech and Social
//      interaction left out, faces look active in speech-only cortex, and
//      adding Speech removes it (step "A real film: faces and speech");
//   3. Speech and Social interaction (voices talking) are near-duplicates: with
//      both in the model speech fades; drop either and the other carries the
//      map (step "Two names for one thing").
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../web/sim.js");

const site = process.argv[2] || "_site";
const src = fs.readFileSync(path.join(__dirname, "../web/brain.js"), "utf8");
const raw = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
const fjs = fs.readFileSync(path.join(site, "data", "film-design.js"), "utf8");
const FILM = JSON.parse(fjs.slice(fjs.indexOf("= ") + 2, fjs.lastIndexOf(";")));

const brain = S.loadBrain(raw);
const truth = S.trueMaps(brain);
const all = S.FEATURES.map((f) => f.id).filter((id) => id !== "on");
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const idx = (pred) => [...Array(brain.V).keys()].filter((v) => brain.cortex[v] && pred(v));
const core = (id) => { let mx = 0; for (const x of truth[id]) mx = Math.max(mx, x); return idx((v) => truth[id][v] > 0.5 * mx); };
const meanT = (fit, id, vs) => mean(vs.map((v) => fit.t[id][v]));

const design = S.makeFilmDesign(FILM, { seed: 1 });
const Y = S.simulate(brain, truth, design, { noise: 0.5, seed: 1 });
const r = (a, b) => S.corr(design.cols[a], design.cols[b]);
console.log(`film design: T = ${design.T}; r(faces, speech) = ${r("faces", "speech").toFixed(2)}, r(speech, social) = ${r("speech", "social").toFixed(2)}`);

// 1. recovery and null
const full = S.fitGLM(brain, Y, design, all);
const noSocial = all.filter((x) => x !== "social");
const fNoSocial = S.fitGLM(brain, Y, design, noSocial);
for (const id of ["brightness", "motion", "loudness", "faces", "places", "valence"]) {
  const t = meanT(full, id, core(id));
  console.log(`  ${id.padEnd(10)} mean t in core ${t.toFixed(1)}`);
  assert.ok(t > 2.5, `${id}: its planted map should come back on the film design`);
}
const cx = idx(() => true);
const rate = cx.filter((v) => Math.abs(full.t.random[v]) > 3.1).length / cx.length;
console.log(`  random: rate |t| > 3.1 = ${rate.toFixed(4)}`);
assert.ok(rate < 0.01, "null feature false-positive rate should be near nominal");

// 2. faces take speech's credit when speech (and its near-copy) are left out
const speechOnly = idx((v) => truth.speech[v] > 0.4 && truth.faces[v] < 0.01);
const without = S.fitGLM(brain, Y, design, all.filter((x) => x !== "speech" && x !== "social"));
const withSpeech = S.fitGLM(brain, Y, design, noSocial);
const a = meanT(without, "faces", speechOnly), b = meanT(withSpeech, "faces", speechOnly);
console.log(`  faces t in speech-only cortex: ${a.toFixed(2)} without speech, ${b.toFixed(2)} with`);
assert.ok(a > 2.5, "faces should look active in speech cortex when speech is omitted");
assert.ok(Math.abs(b) < 1.0, "adding speech should remove the spurious faces effect");

// 3. speech and voices talking: both in, speech fades; either alone carries it
const sFull = meanT(full, "speech", core("speech")), sAlone = meanT(fNoSocial, "speech", core("speech"));
const noSpeech = S.fitGLM(brain, Y, design, all.filter((x) => x !== "speech"));
const social = meanT(noSpeech, "social", core("speech"));
console.log(`  speech core t: ${sFull.toFixed(1)} with social in the model, ${sAlone.toFixed(1)} without; social t there with speech out: ${social.toFixed(1)}`);
assert.ok(r("speech", "social") > 0.9, "speech and voices talking should be near-duplicates in this film");
assert.ok(sAlone > 2 * sFull, "dropping social should restore speech's map");
assert.ok(social > 5, "with speech out, social should take over speech's map");
console.log("ok");
