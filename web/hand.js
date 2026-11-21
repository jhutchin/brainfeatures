/* Hand-computable image features, written to match viz2psy's llstat model
 * (viz2psy/models/llstat.py) on the same pixels.
 *
 *   brightness   mean relative luminance, BT.601: 0.299 R + 0.587 G + 0.114 B (0-1)
 *   contrast     RMS contrast: luminance SD / mean (undefined below mean 0.005)
 *   colourfulness  Hasler & Suesstrunk (2003): sqrt(sd_rg^2 + sd_yb^2) + 0.3 sqrt(mean_rg^2 + mean_yb^2)
 *   edges        fraction of pixels a Canny detector marks as edges, with
 *                scikit-image's canny() defaults as llstat calls it (sigma 1,
 *                thresholds 0.1 / 0.2, constant-zero borders with bleed-over
 *                correction, bilinear non-maximum suppression, 8-connected
 *                hysteresis)
 *
 * No DOM: the page passes RGBA bytes from a canvas; node's tests pass arrays.
 */
(function (root) {
  "use strict";

  const LUMINANCE_FLOOR = 0.005;

  function channels(rgba, w, h) {
    const n = w * h;
    const lum = new Float64Array(n), rg = new Float64Array(n), yb = new Float64Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const R = rgba[j] / 255, G = rgba[j + 1] / 255, B = rgba[j + 2] / 255;
      lum[i] = 0.299 * R + 0.587 * G + 0.114 * B;
      rg[i] = R - G;
      yb[i] = 0.5 * (R + G) - B;
    }
    return { w, h, lum, rg, yb };
  }

  function meanSd(x) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i];
    const m = s / x.length;
    let v = 0;
    for (let i = 0; i < x.length; i++) { const d = x[i] - m; v += d * d; }
    return [m, Math.sqrt(v / x.length)];
  }

  // Separable correlation along one axis with zero padding (scipy mode="constant").
  function corr1d(src, w, h, k, axis) {
    const r = (k.length - 1) / 2, out = new Float64Array(w * h);
    if (axis === 1) {
      for (let y = 0; y < h; y++) {
        const o = y * w;
        for (let x = 0; x < w; x++) {
          let s = 0;
          for (let t = -r; t <= r; t++) { const xx = x + t; if (xx >= 0 && xx < w) s += k[t + r] * src[o + xx]; }
          out[o + x] = s;
        }
      }
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let s = 0;
          for (let t = -r; t <= r; t++) { const yy = y + t; if (yy >= 0 && yy < h) s += k[t + r] * src[yy * w + x]; }
          out[y * w + x] = s;
        }
      }
    }
    return out;
  }

  function gaussKernel(sigma) {
    const r = Math.floor(4 * sigma + 0.5), k = [];   // scipy truncate=4.0
    let s = 0;
    for (let t = -r; t <= r; t++) { const v = Math.exp(-0.5 * t * t / (sigma * sigma)); k.push(v); s += v; }
    return k.map((v) => v / s);
  }

  // scipy.ndimage.sobel(axis), mode="reflect": derivative [-1, 0, 1] along axis,
  // smoothing [1, 2, 1] across it; reflect pads d c b a | a b c d.
  function sobel(src, w, h, axis) {
    const out = new Float64Array(w * h);
    const cx = (x) => (x < 0 ? -x - 1 : x >= w ? 2 * w - x - 1 : x);
    const cy = (y) => (y < 0 ? -y - 1 : y >= h ? 2 * h - y - 1 : y);
    const at = (x, y) => src[cy(y) * w + cx(x)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v;
        if (axis === 0) {
          v = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
        } else {
          v = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  function canny(lum, w, h, sigma = 1.0, low = 0.1, high = 0.2) {
    const n = w * h, k = gaussKernel(sigma);
    const sm = corr1d(corr1d(lum, w, h, k, 0), w, h, k, 1);
    const ones = new Float64Array(n).fill(1);
    const bleed = corr1d(corr1d(ones, w, h, k, 0), w, h, k, 1);
    for (let i = 0; i < n; i++) sm[i] /= bleed[i] + 2.220446049250313e-16;
    const isob = sobel(sm, w, h, 0), jsob = sobel(sm, w, h, 1);
    const mag = new Float64Array(n);
    for (let i = 0; i < n; i++) mag[i] = Math.sqrt(isob[i] * isob[i] + jsob[i] * jsob[i]);

    // Bilinear non-maximum suppression (skimage _nonmaximum_suppression_bilinear);
    // the 1-pixel border is masked out.
    const nms = new Float64Array(n);
    const M = (y, x) => mag[y * w + x];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, m = mag[i];
        if (!(m >= low)) continue;
        const gi = isob[i], gj = jsob[i];
        const down = gi <= 0, up = gi >= 0, left = gj <= 0, right = gj >= 0;
        const c1 = (up && right) || (down && left);
        const c2 = (down && right) || (up && left);
        if (!c1 && !c2) continue;
        const ai = Math.abs(gi), aj = Math.abs(gj);
        let wgt, n11, n12, n21, n22;
        if (c1) {
          if (ai > aj) { wgt = aj / ai; n11 = M(y + 1, x); n12 = M(y + 1, x + 1); n21 = M(y - 1, x); n22 = M(y - 1, x - 1); }
          else { wgt = ai / aj; n11 = M(y, x + 1); n12 = M(y + 1, x + 1); n21 = M(y, x - 1); n22 = M(y - 1, x - 1); }
        }
        if (c2) {
          if (ai < aj) { wgt = ai / aj; n11 = M(y, x + 1); n12 = M(y - 1, x + 1); n21 = M(y, x - 1); n22 = M(y + 1, x - 1); }
          else { wgt = aj / ai; n11 = M(y - 1, x); n12 = M(y - 1, x + 1); n21 = M(y + 1, x); n22 = M(y + 1, x - 1); }
        }
        if (n12 * wgt + n11 * (1 - wgt) <= m && n22 * wgt + n21 * (1 - wgt) <= m) nms[i] = m;
      }
    }

    // Hysteresis: keep 8-connected components of the low mask that hold a strong pixel.
    const out = new Uint8Array(n), seen = new Uint8Array(n), stack = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (seen[s] || !(nms[s] > 0)) continue;
      let top = 0, strong = false, cnt = 0;
      const comp = [];
      stack[top++] = s; seen[s] = 1;
      while (top) {
        const p = stack[--top]; comp.push(p); cnt++;
        if (nms[p] >= high) strong = true;
        const py = (p / w) | 0, px = p - py * w;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = py + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = px + dx; if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (!seen[q] && nms[q] > 0) { seen[q] = 1; stack[top++] = q; }
          }
        }
      }
      if (strong) for (const p of comp) out[p] = 1;
    }
    return { edges: out, magnitude: mag };
  }

  function features(rgba, w, h) {
    const c = channels(rgba, w, h);
    const [lm, ls] = meanSd(c.lum), [rgm, rgs] = meanSd(c.rg), [ybm, ybs] = meanSd(c.yb);
    const { edges } = canny(c.lum, w, h);
    let e = 0;
    for (let i = 0; i < edges.length; i++) e += edges[i];
    return {
      channels: c, edgeMap: edges,
      values: {
        lum: lm,
        contrast: lm >= LUMINANCE_FLOOR ? ls / lm : NaN,
        colour: Math.sqrt(rgs * rgs + ybs * ybs) + 0.3 * Math.sqrt(rgm * rgm + ybm * ybm),
        edges: e / edges.length,
      },
      parts: { lumSd: ls, rgMean: rgm, rgSd: rgs, ybMean: ybm, ybSd: ybs },
    };
  }

  const api = { channels, canny, features, meanSd, LUMINANCE_FLOOR };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HAND = api;
})(typeof window !== "undefined" ? window : this);
