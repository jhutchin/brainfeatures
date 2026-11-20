// node tests/test_sim.js — checks that the GLM recovers the planted truth,
// stays near the nominal false-positive rate on a null feature, and shows
// the omitted-variable effect the page teaches.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../web/sim.js");

const src = fs.readFileSync(path.join(__dirname, "../web/brain.js"), "utf8");
const raw = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));

let t0 = Date.now();
const brain = S.loadBrain(raw);
const truth = S.trueMaps(brain);
console.log(`load + truth: ${Date.now() - t0} ms, V = ${brain.V}`);

function run({ corr = 0, included, nTrials = 80, noise = 0.5, seed = 1 }) {
  const design = S.makeDesign({ nTrials, corrFaceSpeech: corr, seed });
  let t = Date.now();
  const Y = S.simulate(brain, truth, design, { noise, seed });
  const tSim = Date.now() - t;
  t = Date.now();
  const fit = S.fitGLM(brain, Y, design, included);
  console.log(`  T = ${design.T}: simulate ${tSim} ms, fit ${Date.now() - t} ms`);
  return { design, Y, fit };
}

const all = S.FEATURES.map((f) => f.id).filter((id) => id !== "on");
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const idx = (pred) => [...Array(brain.V).keys()].filter((v) => brain.cortex[v] && pred(v));

// 1. full model recovers every planted map
{
  const { fit } = run({ included: all });
  const zero = (id) => idx((v) => truth[id][v] === 0);
  for (const f of S.FEATURES) {
    if (!f.seeds.length) continue;
    let mx = 0;
    for (const x of truth[f.id]) mx = Math.max(mx, x);
    const core = idx((v) => truth[f.id][v] > 0.5 * mx);
    const tin = mean(core.map((v) => fit.t[f.id][v]));
    const out = zero(f.id);
    const fp = out.filter((v) => Math.abs(fit.t[f.id][v]) > 3.1).length / out.length;
    console.log(`  ${f.id.padEnd(10)} mean t in core ${tin.toFixed(1).padStart(5)} (${core.length} vertices); |t| > 3.1 outside: ${fp.toFixed(4)}`);
    // abstract features (level 3) are weak by design: visible, not vivid
    const bar = f.level >= 3 ? 1.5 : 3.1;
    assert.ok(tin > bar, `${f.id}: the blob core should average t > ${bar}`);
    assert.ok(fp < 0.01, `${f.id}: false positives outside the blob should stay rare`);
  }
  // 2. null feature: false-positive rate near nominal
  const cx = idx(() => true);
  const thr = 3.1;
  const rate = cx.filter((v) => Math.abs(fit.t.random[v]) > thr).length / cx.length;
  console.log(`  random: rate |t| > ${thr} = ${rate.toFixed(4)} (nominal ${S.twoTailP(thr).toFixed(4)})`);
  assert.ok(rate < 0.01, "null feature false-positive rate should be near nominal");
}

// 3. omitted variable: faces take speech's credit when speech is left out
{
  const speechOnly = idx((v) => truth.speech[v] > 0.4 && truth.faces[v] < 0.01);
  const without = run({ corr: 0.8, included: ["faces"] });
  const withSpeech = run({ corr: 0.8, included: ["faces", "speech"] });
  const a = mean(speechOnly.map((v) => without.fit.t.faces[v]));
  const b = mean(speechOnly.map((v) => withSpeech.fit.t.faces[v]));
  console.log(`  r(faces, speech) = ${without.design.rFaceSpeech.toFixed(2)}; faces t in speech-only cortex: ${a.toFixed(2)} without speech, ${b.toFixed(2)} with`);
  assert.ok(a > 3, "faces should look significant in speech cortex when speech is omitted");
  assert.ok(Math.abs(b) < 1.5, "including speech should remove the spurious faces effect");
}
console.log("ok");
