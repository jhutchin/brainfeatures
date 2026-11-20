/* Simulation engine for the Synthetic Cortex pages.
 *
 * Everything here is invented on purpose. Each stimulus feature has a
 * ground-truth map (Gaussian blobs placed on named atlas regions), an
 * experiment is a random event-related design, and the "brain" is
 * truth x regressors + drift + spatially smooth noise. The GLM then fits that
 * data the way a real first-level analysis would, so the learner can compare
 * what the analysis recovers with what generated it.
 *
 * No DOM access: the same file runs in the page and under node (tests/).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BrainSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------- features

  // level: where the feature sits on the sensory -> association axis
  // (0 = control, 1 = sensory, 2 = category, 3 = abstract). Module 2 uses it.
  // seeds: amp in % signal change at the blob centre, width in degrees of arc
  // on the spherical surface (fsaverage sphere, 1 degree ~ 1-2 mm of cortex).
  const FEATURES = [
    {
      id: "on", name: "Any stimulus", kind: "binary", level: 1, always: true,
      blurb: "1 during every trial. Every model needs it; the features below are measured relative to it.",
      seeds: [
        { label: "S_calcarine", hemi: "both", amp: 1.4, width: 16 },
        { label: "G_occipital_middle", hemi: "both", amp: 0.7, width: 10 },
        { label: "G_temp_sup-G_T_transv", hemi: "both", amp: 1.1, width: 9 },
      ],
    },
    {
      id: "brightness", name: "Brightness", kind: "continuous", level: 1,
      blurb: "How bright the image is.",
      seeds: [
        { label: "S_calcarine", hemi: "both", amp: 0.8, width: 10 },
        { label: "Pole_occipital", hemi: "both", amp: 0.6, width: 7 },
      ],
    },
    {
      id: "motion", name: "Visual motion", kind: "continuous", level: 1,
      blurb: "How much the image moves.",
      seeds: [{ label: "S_occipital_ant", hemi: "both", amp: 0.9, width: 6 }],
    },
    {
      id: "loudness", name: "Loudness", kind: "continuous", level: 1,
      blurb: "How loud the sound is.",
      seeds: [{ label: "G_temp_sup-G_T_transv", hemi: "both", amp: 0.9, width: 6 }],
    },
    {
      id: "faces", name: "Faces", kind: "binary", level: 2,
      blurb: "Whether a face is on screen.",
      seeds: [
        { label: "G_oc-temp_lat-fusifor", hemi: "R", amp: 0.8, width: 6 },
        { label: "G_oc-temp_lat-fusifor", hemi: "L", amp: 0.45, width: 6 },
      ],
    },
    {
      id: "places", name: "Places", kind: "binary", level: 2,
      blurb: "Whether the image shows a scene or place.",
      seeds: [
        { label: "S_oc-temp_med_and_Lingual", hemi: "both", amp: 0.7, width: 6 },
        { label: "S_parieto_occipital", hemi: "both", amp: 0.4, width: 6 },
      ],
    },
    {
      id: "speech", name: "Speech", kind: "binary", level: 2,
      blurb: "Whether someone is talking.",
      seeds: [
        { label: "S_temporal_sup", hemi: "L", amp: 0.8, width: 9 },
        { label: "S_temporal_sup", hemi: "R", amp: 0.45, width: 9 },
      ],
    },
    {
      id: "social", name: "Social interaction", kind: "continuous", level: 3,
      blurb: "How much the people shown are interacting.",
      seeds: [
        { label: "G_pariet_inf-Angular", hemi: "R", amp: 0.4, width: 11 },
        { label: "G_pariet_inf-Angular", hemi: "L", amp: 0.3, width: 11 },
        { label: "G_precuneus", hemi: "both", amp: 0.25, width: 12 },
        { label: "G_and_S_cingul-Ant", hemi: "both", amp: 0.2, width: 12 },
      ],
    },
    {
      id: "valence", name: "Pleasantness", kind: "continuous", level: 3,
      blurb: "How pleasant the clip feels.",
      seeds: [
        { label: "G_rectus", hemi: "both", amp: 0.35, width: 10 },
        { label: "G_subcallosal", hemi: "both", amp: 0.25, width: 9 },
      ],
    },
    {
      id: "random", name: "Random (no real effect)", kind: "continuous", level: 0,
      blurb: "A made-up number per trial. Nothing in this brain responds to it.",
      seeds: [],
    },
  ];
  const FEATURE = Object.fromEntries(FEATURES.map((f) => [f.id, f]));

  // ------------------------------------------------------------------ random

  function rng(seed) {
    // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussFill(out, rand) {
    for (let i = 0; i < out.length; i += 2) {
      const u = rand() || 1e-12;
      const r = Math.sqrt(-2 * Math.log(u));
      const th = 2 * Math.PI * rand();
      out[i] = r * Math.cos(th);
      if (i + 1 < out.length) out[i + 1] = r * Math.sin(th);
    }
    return out;
  }

  // ------------------------------------------------------------------- brain

  function decode(b64, Type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Type(bytes.buffer);
  }

  function loadBrain(raw) {
    const labels = raw.labels;
    const hemis = {};
    let offset = 0;
    for (const h of ["L", "R"]) {
      const r = raw.hemis[h];
      const sulc8 = decode(r.sulc, Int8Array);
      hemis[h] = {
        n: r.n,
        offset,
        infl: decode(r.infl, Float32Array),
        pial: decode(r.pial, Float32Array),
        sphere: decode(r.sphere, Float32Array),
        faces: decode(r.faces, Uint16Array),
        sulc: Float32Array.from(sulc8, (s) => s / 127),
        label: decode(r.label, Uint8Array),
      };
      offset += r.n;
    }
    const V = offset;

    // unit sphere direction per vertex, global index
    const dir = new Float32Array(V * 3);
    const hemiOf = new Uint8Array(V); // 0 = L, 1 = R
    const label = new Uint8Array(V);
    for (const h of ["L", "R"]) {
      const H = hemis[h];
      for (let i = 0; i < H.n; i++) {
        const x = H.sphere[3 * i], y = H.sphere[3 * i + 1], z = H.sphere[3 * i + 2];
        const len = Math.hypot(x, y, z) || 1;
        const g = H.offset + i;
        dir[3 * g] = x / len; dir[3 * g + 1] = y / len; dir[3 * g + 2] = z / len;
        hemiOf[g] = h === "L" ? 0 : 1;
        label[g] = H.label[i];
      }
    }

    // mesh neighbours (global index), for spatially smooth noise
    const nbSets = Array.from({ length: V }, () => new Set());
    for (const h of ["L", "R"]) {
      const H = hemis[h];
      const f = H.faces;
      for (let k = 0; k < f.length; k += 3) {
        const a = H.offset + f[k], b = H.offset + f[k + 1], c = H.offset + f[k + 2];
        nbSets[a].add(b); nbSets[a].add(c);
        nbSets[b].add(a); nbSets[b].add(c);
        nbSets[c].add(a); nbSets[c].add(b);
      }
    }
    const nbStart = new Int32Array(V + 1);
    for (let v = 0; v < V; v++) nbStart[v + 1] = nbStart[v] + nbSets[v].size;
    const nbList = new Int32Array(nbStart[V]);
    for (let v = 0; v < V; v++) {
      let k = nbStart[v];
      for (const n of nbSets[v]) nbList[k++] = n;
    }

    // cortex mask: the medial wall and unlabeled vertices are not cortex
    const noCortex = new Set(["Unknown", "Medial_wall"].map((n) => labels.indexOf(n)));
    const cortex = new Uint8Array(V);
    for (let v = 0; v < V; v++) cortex[v] = noCortex.has(label[v]) ? 0 : 1;

    // landmark = mean sphere direction of a label's vertices, per hemisphere
    const landmarks = {};
    for (let li = 0; li < labels.length; li++) {
      for (const hi of [0, 1]) {
        let x = 0, y = 0, z = 0, n = 0;
        for (let v = 0; v < V; v++) {
          if (label[v] !== li || hemiOf[v] !== hi) continue;
          x += dir[3 * v]; y += dir[3 * v + 1]; z += dir[3 * v + 2]; n++;
        }
        if (!n) continue;
        const len = Math.hypot(x, y, z);
        landmarks[labels[li] + "|" + (hi ? "R" : "L")] = [x / len, y / len, z / len];
      }
    }

    return { labels, hemis, V, dir, hemiOf, label, nbStart, nbList, cortex, landmarks };
  }

  // ------------------------------------------------------------ ground truth

  function trueMaps(brain, features = FEATURES) {
    const { V, dir, hemiOf, cortex } = brain;
    const maps = {};
    for (const f of features) {
      const m = new Float32Array(V);
      for (const s of f.seeds) {
        const hs = s.hemi === "both" ? ["L", "R"] : [s.hemi];
        for (const h of hs) {
          const c = brain.landmarks[s.label + "|" + h];
          if (!c) throw new Error(`landmark ${s.label} (${h}) is not in the atlas`);
          const hi = h === "L" ? 0 : 1;
          const w = s.width * Math.PI / 180;
          const cut = Math.cos(3 * w);
          for (let v = 0; v < V; v++) {
            if (hemiOf[v] !== hi || !cortex[v]) continue;
            const d = dir[3 * v] * c[0] + dir[3 * v + 1] * c[1] + dir[3 * v + 2] * c[2];
            if (d < cut) continue;
            const th = Math.acos(Math.min(1, d));
            m[v] += s.amp * Math.exp(-(th * th) / (2 * w * w));
          }
        }
      }
      maps[f.id] = m;
    }
    return maps;
  }

  // ------------------------------------------------------------------ design

  function gammaPdf(t, shape) {
    if (t <= 0) return 0;
    let g = 1;
    for (let k = 2; k < shape; k++) g *= k; // (shape-1)! for integer shape
    return Math.pow(t, shape - 1) * Math.exp(-t) / g;
  }

  // SPM-style double-gamma HRF, convolved with a boxcar of `dur` seconds and
  // scaled so the response to a 1-unit boxcar peaks at 1.
  function boxResponse(dur, dt) {
    const n = Math.round(32 / dt);
    const h = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      h[i] = gammaPdf(t, 6) - gammaPdf(t, 16) / 6;
    }
    const nb = Math.max(1, Math.round(dur / dt));
    const k = new Float64Array(n + nb);
    for (let i = 0; i < n; i++) for (let j = 0; j < nb; j++) k[i + j] += h[i];
    let peak = 0;
    for (const x of k) peak = Math.max(peak, x);
    for (let i = 0; i < k.length; i++) k[i] /= peak;
    return k;
  }

  function corr(a, b) {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - ma, db = b[i] - mb;
      sab += da * db; saa += da * da; sbb += db * db;
    }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }

  // One run of an event-related experiment: 2 s clips, 2-6 s gaps.
  // corrFaceSpeech: chance that a trial's speech value copies its faces value,
  // which sets their correlation across trials to about that number.
  function makeDesign({ nTrials = 80, corrFaceSpeech = 0, seed = 1, TR = 2, dur = 2 } = {}) {
    const rand = rng(seed * 7919 + 17);
    const onsets = new Float64Array(nTrials);
    let t = 8;
    for (let i = 0; i < nTrials; i++) {
      onsets[i] = t;
      t += dur + 2 + 4 * rand();
    }
    const total = t + 16;
    const T = Math.ceil(total / TR);

    const values = {};
    for (const f of FEATURES) values[f.id] = new Float64Array(nTrials);
    for (let i = 0; i < nTrials; i++) {
      values.on[i] = 1;
      values.brightness[i] = rand();
      values.motion[i] = rand();
      values.loudness[i] = rand();
      values.faces[i] = rand() < 0.5 ? 1 : 0;
      values.places[i] = rand() < 0.4 ? 1 : 0;
      values.speech[i] = rand() < corrFaceSpeech ? values.faces[i] : rand() < 0.5 ? 1 : 0;
      values.social[i] = rand();
      values.valence[i] = rand();
      values.random[i] = rand();
    }

    const dt = 0.1;
    const k = boxResponse(dur, dt);
    const nHi = Math.ceil(total / dt) + k.length;
    const cols = {};
    for (const f of FEATURES) {
      const v = values[f.id];
      let mean = 0;
      for (const x of v) mean += x;
      mean /= nTrials;
      const hi = new Float64Array(nHi);
      for (let i = 0; i < nTrials; i++) {
        // features are parametric modulators: value minus the run's mean
        const amp = f.id === "on" ? 1 : v[i] - mean;
        if (!amp) continue;
        const i0 = Math.round(onsets[i] / dt);
        for (let j = 0; j < k.length; j++) hi[i0 + j] += amp * k[j];
      }
      const col = new Float64Array(T);
      for (let s = 0; s < T; s++) col[s] = hi[Math.round((s * TR) / dt)];
      cols[f.id] = col;
    }

    return {
      TR, T, dur, nTrials, onsets, values, cols,
      rFaceSpeech: corr(values.faces, values.speech),
    };
  }

  // ---------------------------------------------------------------- simulate

  // Y is vertex-major: Y[v * T + t], in % signal change around baseline.
  function simulate(brain, truth, design, { noise = 1, seed = 1, smoothIter = 2 } = {}) {
    const { V, nbStart, nbList } = brain;
    const { T } = design;
    const rand = rng(seed * 104729 + 3);

    let N = gaussFill(new Float32Array(V * T), rand);
    for (let it = 0; it < smoothIter; it++) {
      const M = new Float32Array(V * T);
      for (let v = 0; v < V; v++) {
        const a = nbStart[v], b = nbStart[v + 1];
        const w = 1 / (1 + b - a);
        const o = v * T;
        for (let t = 0; t < T; t++) M[o + t] = N[o + t];
        for (let k = a; k < b; k++) {
          const on = nbList[k] * T;
          for (let t = 0; t < T; t++) M[o + t] += N[on + t];
        }
        for (let t = 0; t < T; t++) M[o + t] *= w;
      }
      N = M;
    }
    let ss = 0;
    for (let i = 0; i < N.length; i++) ss += N[i] * N[i];
    const scale = noise / Math.sqrt(ss / N.length);

    const Y = N;
    for (let i = 0; i < Y.length; i++) Y[i] *= scale;

    // slow scanner drift: three low cosines per vertex, removed by the GLM's
    // high-pass filter
    const drift = [1, 2, 3].map((k) => Float64Array.from({ length: T }, (_, t) => Math.cos((Math.PI * k * (t + 0.5)) / T)));
    const g = new Float32Array(3);
    for (let v = 0; v < V; v++) {
      gaussFill(g, rand);
      const o = v * T;
      for (let t = 0; t < T; t++) {
        Y[o + t] += 0.6 * noise * (g[0] * drift[0][t] + g[1] * drift[1][t] + g[2] * drift[2][t]);
      }
    }

    for (const f of FEATURES) {
      const m = truth[f.id];
      const col = design.cols[f.id];
      if (!m) continue;
      for (let v = 0; v < V; v++) {
        const b = m[v];
        if (Math.abs(b) < 1e-4) continue;
        const o = v * T;
        for (let t = 0; t < T; t++) Y[o + t] += b * col[t];
      }
    }
    return Y;
  }

  // --------------------------------------------------------------------- GLM

  function invert(A, P) {
    const M = new Float64Array(P * 2 * P);
    for (let i = 0; i < P; i++) {
      for (let j = 0; j < P; j++) M[i * 2 * P + j] = A[i * P + j];
      M[i * 2 * P + P + i] = 1;
    }
    for (let c = 0; c < P; c++) {
      let piv = c;
      for (let r = c + 1; r < P; r++) if (Math.abs(M[r * 2 * P + c]) > Math.abs(M[piv * 2 * P + c])) piv = r;
      if (Math.abs(M[piv * 2 * P + c]) < 1e-12) throw new Error("design matrix is singular");
      if (piv !== c) for (let j = 0; j < 2 * P; j++) { const tmp = M[c * 2 * P + j]; M[c * 2 * P + j] = M[piv * 2 * P + j]; M[piv * 2 * P + j] = tmp; }
      const d = M[c * 2 * P + c];
      for (let j = 0; j < 2 * P; j++) M[c * 2 * P + j] /= d;
      for (let r = 0; r < P; r++) {
        if (r === c) continue;
        const f = M[r * 2 * P + c];
        if (!f) continue;
        for (let j = 0; j < 2 * P; j++) M[r * 2 * P + j] -= f * M[c * 2 * P + j];
      }
    }
    const inv = new Float64Array(P * P);
    for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) inv[i * P + j] = M[i * 2 * P + P + j];
    return inv;
  }

  // Ordinary least squares at every vertex. `included` lists the feature ids
  // in the model besides "on"; an intercept and a discrete-cosine high-pass
  // (128 s cutoff) are always added.
  function fitGLM(brain, Y, design, included) {
    const { V } = brain;
    const { T, TR } = design;
    const ids = ["on", ...FEATURES.filter((f) => f.id !== "on" && included.includes(f.id)).map((f) => f.id)];
    const nK = Math.max(0, Math.floor((2 * T * TR) / 128));
    const names = [...ids, "constant", ...Array.from({ length: nK }, (_, k) => "drift " + (k + 1))];
    const P = names.length;
    const X = new Float64Array(T * P);
    for (let t = 0; t < T; t++) {
      ids.forEach((id, p) => { X[t * P + p] = design.cols[id][t]; });
      X[t * P + ids.length] = 1;
      for (let k = 1; k <= nK; k++) X[t * P + ids.length + k] = Math.cos((Math.PI * k * (t + 0.5)) / T);
    }
    const XtX = new Float64Array(P * P);
    for (let t = 0; t < T; t++) for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) XtX[i * P + j] += X[t * P + i] * X[t * P + j];
    const inv = invert(XtX, P);

    const df = T - P;
    const beta = new Float32Array(V * P);
    const sigma2 = new Float32Array(V);
    const xty = new Float64Array(P);
    for (let v = 0; v < V; v++) {
      xty.fill(0);
      let yty = 0;
      const o = v * T;
      for (let t = 0; t < T; t++) {
        const y = Y[o + t];
        yty += y * y;
        const r = t * P;
        for (let p = 0; p < P; p++) xty[p] += X[r + p] * y;
      }
      let fit = 0;
      for (let i = 0; i < P; i++) {
        let b = 0;
        for (let j = 0; j < P; j++) b += inv[i * P + j] * xty[j];
        beta[v * P + i] = b;
        fit += b * xty[i];
      }
      sigma2[v] = Math.max(0, yty - fit) / df;
    }

    const t = {}, se = {}, est = {};
    ids.forEach((id, p) => {
      const tm = new Float32Array(V), sm = new Float32Array(V), bm = new Float32Array(V);
      const c = inv[p * P + p];
      for (let v = 0; v < V; v++) {
        const s = Math.sqrt(sigma2[v] * c);
        bm[v] = beta[v * P + p];
        sm[v] = s;
        tm[v] = s > 0 ? bm[v] / s : 0;
      }
      t[id] = tm; se[id] = sm; est[id] = bm;
    });

    function fitted(v) {
      const out = new Float64Array(T);
      for (let tt = 0; tt < T; tt++) {
        let s = 0;
        for (let p = 0; p < P; p++) s += X[tt * P + p] * beta[v * P + p];
        out[tt] = s;
      }
      return out;
    }

    return { ids, names, P, X, df, t, se, est, fitted };
  }

  // --------------------------------------------------------------- utilities

  // two-tailed normal tail probability, for the chance estimate at |t| > thr
  function twoTailP(z) {
    const x = Math.abs(z) / Math.SQRT2;
    // Abramowitz-Stegun 7.1.26
    const t = 1 / (1 + 0.3275911 * x);
    const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    return y * Math.exp(-x * x);
  }

  return { FEATURES, FEATURE, loadBrain, trueMaps, makeDesign, simulate, fitGLM, corr, twoTailP };
});
