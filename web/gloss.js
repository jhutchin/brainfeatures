// Optional explanations for terms that assume a statistics or machine-learning
// background. One shared list for all three pages, so a term reads the same on each.
//
// Markup: <button type="button" class="term" data-term="embedding">embedding</button>
// Clicking it opens a short note under the paragraph it sits in; clicking again
// closes it. Notes are written for a psychology student: what the idea means in
// an experiment, then one link for more. Works for markup added later too
// (step text is rewritten by the pages), because clicks are handled on document.
(function () {
  "use strict";

  const GLOSS = {
    feature: {
      name: "Feature",
      text: "A number that describes one property of a stimulus: how bright a picture is, how loud a sound is, whether a face is on screen. In an experiment, features play the part of independent variables. They are not set by the experimenter, though. They are measured from the stimuli, so you can ask which of them a brain response follows.",
      link: ["https://en.wikipedia.org/wiki/Feature_(machine_learning)", "Feature (machine learning), Wikipedia"],
    },
    model: {
      name: "Trained model (neural network)",
      text: "A program with millions of adjustable numbers (weights). Training shows it many labelled examples and nudges the weights until its answers match the labels; afterwards it can score stimuli it has never seen. For a psychologist, a trained model is a measuring instrument. Like a questionnaire, it gives a number for every stimulus. Like any instrument, it can be wrong, and it carries the biases of what it was trained on.",
      link: ["https://en.wikipedia.org/wiki/Neural_network_(machine_learning)", "Neural network (machine learning), Wikipedia"],
    },
    embedding: {
      name: "Embedding",
      text: "A list of hundreds of numbers that a model uses to describe one stimulus. No single number has a name like “brightness”, and reading one alone tells you little. What carries meaning is the whole list: stimuli the model treats as alike get similar lists. Think of a personality profile with 768 unnamed scales. You cannot interpret any one scale, but you can still tell which two people have similar profiles.",
      link: ["https://en.wikipedia.org/wiki/Embedding_(machine_learning)", "Embedding (machine learning), Wikipedia"],
    },
    rdm: {
      name: "Dissimilarity table (RDM)",
      text: "A table with one row and one column per stimulus. Each cell says how different two stimuli are by some measure. Here the measure is 1 minus the correlation between the two stimuli's numbers: 0 means the same pattern, 1 unrelated, 2 opposite. Researchers call it a representational dissimilarity matrix (RDM). A brain region has one too, built from its activity patterns.",
      link: ["https://doi.org/10.3389/neuro.06.004.2008", "Kriegeskorte, Mur & Bandettini (2008), the paper that introduced RSA"],
    },
    mds: {
      name: "Similarity map (multidimensional scaling)",
      text: "Multidimensional scaling places points on a flat map so that distances on the map match a dissimilarity table as closely as possible: close means similar. The two axes have no meaning of their own, and squeezing hundreds of numbers onto two dimensions distorts some distances. Trust who sits near whom more than exact positions.",
      link: ["https://en.wikipedia.org/wiki/Multidimensional_scaling", "Multidimensional scaling, Wikipedia"],
    },
    rsa: {
      name: "Representational similarity analysis (RSA)",
      text: "RSA compares two dissimilarity tables: for example, a model's and a brain region's. If the stimuli a model treats as alike also evoke alike activity patterns in the region, the two tables correlate. Because it compares tables rather than raw numbers, RSA can compare a brain with a model, or one person's brain with another's, even though their numbers are on different scales.",
      link: ["https://doi.org/10.3389/neuro.06.004.2008", "Kriegeskorte, Mur & Bandettini (2008)"],
    },
    correlation: {
      name: "Correlation (r)",
      text: "How closely two measures rise and fall together. It runs from −1 (one goes up exactly when the other goes down), through 0 (unrelated), to +1 (perfectly in step). When two features of a stimulus set are strongly correlated, a brain response that follows one also follows the other. Telling them apart then takes stimuli where they come apart.",
      link: ["https://en.wikipedia.org/wiki/Pearson_correlation_coefficient", "Pearson correlation coefficient, Wikipedia"],
    },
    confound: {
      name: "Confound",
      text: "A second variable that changes along with the one you care about, so an effect of one can look like an effect of the other. In a film, faces and speech are a classic pair: people talk when they are on screen. A brain region that responds to speech will also seem to respond to faces, unless the analysis accounts for speech.",
      link: ["https://en.wikipedia.org/wiki/Confounding", "Confounding, Wikipedia"],
    },
    glm: {
      name: "General linear model (GLM)",
      text: "The general linear model explains a measured signal as a weighted sum of predictors (here, the features) plus noise. It finds the weight for each feature that fits the data best, along with how certain that weight is. It is the same tool as multiple regression in a statistics course, run separately at every point of the brain.",
      link: ["https://en.wikipedia.org/wiki/General_linear_model", "General linear model, Wikipedia"],
    },
    parametric: {
      name: "Parametric regressor",
      text: "A predictor whose height on each trial follows the feature's value on that trial, rather than just marking that a trial happened. If a region tracks brightness, its response should be larger on brighter trials. The weight the GLM finds for this predictor is the change in response per unit of the feature.",
      link: ["https://en.wikipedia.org/wiki/General_linear_model", "General linear model, Wikipedia"],
    },
    hrf: {
      name: "Hemodynamic response",
      text: "fMRI does not measure neurons directly. It measures changes in blood oxygen, which rise a few seconds after neurons become active, peak about 5 seconds later and take around 15 seconds to settle. So before comparing a feature with the signal, the analysis smooths and delays the feature's time course by this slow response.",
      link: ["https://en.wikipedia.org/wiki/Haemodynamic_response", "Haemodynamic response, Wikipedia"],
    },
    psc: {
      name: "% signal change",
      text: "The unit of an fMRI response: how far the measured signal rises above its usual level, as a percentage of that level. Responses to stimuli are usually a few percent at most, which is one reason noise matters so much.",
      link: ["https://en.wikipedia.org/wiki/Functional_magnetic_resonance_imaging", "Functional MRI, Wikipedia"],
    },
    se: {
      name: "Standard error (± 2 SE)",
      text: "How uncertain an estimate is. Run the same experiment again with fresh noise and the estimate lands somewhere else; the standard error is the typical size of that shift. A bar of ± 2 standard errors covers roughly the range where the true value is likely to be (about a 95 % interval).",
      link: ["https://en.wikipedia.org/wiki/Standard_error", "Standard error, Wikipedia"],
    },
    t: {
      name: "t statistic",
      text: "An estimate divided by its standard error: how many units of uncertainty the estimate sits from zero. At a single place, |t| above about 2 is unlikely by chance alone. A brain map tests thousands of places at once, though, so some pass by chance (see step 4, “Chance alone”).",
      link: ["https://en.wikipedia.org/wiki/T-statistic", "t-statistic, Wikipedia"],
    },
    threshold: {
      name: "Threshold",
      text: "The cut-off for colouring a point: only points whose |t| is above it are shown. Raising it removes chance hits but also hides weak real effects. It is the same trade-off as choosing a significance level: fewer false alarms means more misses.",
      link: ["https://en.wikipedia.org/wiki/Multiple_comparisons_problem", "Multiple comparisons problem, Wikipedia"],
    },
    multiple: {
      name: "Multiple comparisons",
      text: "Testing thousands of points at once means some pass the threshold by chance. With 20,000 tests at a 5 % false-alarm rate each, about 1,000 pass even when nothing is there. Corrections raise the bar so that the map as a whole, rather than each point, has a low false-alarm rate.",
      link: ["https://en.wikipedia.org/wiki/Multiple_comparisons_problem", "Multiple comparisons problem, Wikipedia"],
    },
    omitted: {
      name: "Omitted variable",
      text: "A feature that drives the response but is left out of the model. If it is correlated with a feature that is in the model, its effect is credited to that feature. In psychology terms, it is an uncontrolled confound. The fix is to measure it and include it, or to design stimuli where the two features come apart.",
      link: ["https://en.wikipedia.org/wiki/Omitted-variable_bias", "Omitted-variable bias, Wikipedia"],
    },
    collinear: {
      name: "Collinearity",
      text: "When two features in a model rise and fall together almost perfectly, the data cannot say how much of a response belongs to each. Both estimates become very uncertain (wide error bars), even though their combined effect is still well measured. Adding more data of the same kind helps little; stimuli where the two come apart help a lot.",
      link: ["https://en.wikipedia.org/wiki/Multicollinearity", "Multicollinearity, Wikipedia"],
    },
  };

  const css = `
  .term { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: help;
    text-decoration: underline dotted var(--accent); text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
  .term:hover { color: var(--accent); }
  .term[aria-expanded="true"] { color: var(--accent); text-decoration-style: solid; }
  .term::after { content: "?"; display: inline-grid; place-items: center; width: 1.05em; height: 1.05em; margin-left: 2px;
    border-radius: 50%; font-size: 0.68em; font-weight: 700; vertical-align: 0.35em; line-height: 1;
    background: var(--accent-soft); color: var(--accent); text-decoration: none; }
  .gloss { margin: 6px 0 10px; padding: 8px 12px; border-left: 3px solid var(--accent); background: var(--accent-soft);
    border-radius: 0 6px 6px 0; font-size: 0.88rem; line-height: 1.45; color: var(--ink); max-width: 78ch; }
  .gloss b { color: var(--ink); }
  .gloss p { margin: 0 0 4px; }
  .gloss .gl-more { font-size: 0.82rem; }
  .gloss .gl-more a { color: var(--accent); }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  let n = 0;
  function host(btn) {
    // the block the note goes under: the nearest paragraph-like ancestor
    return btn.closest("p, li, .hint, .gl-host") || btn.parentElement;
  }
  function close(btn) {
    const id = btn.getAttribute("aria-controls");
    const box = id && document.getElementById(id);
    if (box) box.remove();
    btn.setAttribute("aria-expanded", "false");
  }
  function open(btn) {
    const g = GLOSS[btn.dataset.term];
    if (!g) return;
    const h = host(btn);
    // one note per block: close any other open in the same block
    for (const other of h.querySelectorAll('.term[aria-expanded="true"]')) close(other);
    const box = document.createElement("div");
    box.className = "gloss"; box.id = "gloss-" + (++n); box.setAttribute("role", "note");
    const [href, label] = g.link || [];
    box.innerHTML = `<p><b>${g.name}.</b> ${g.text}</p>` + (href ? `<div class="gl-more">More: <a href="${href}" target="_blank" rel="noopener">${label}</a></div>` : "");
    h.insertAdjacentElement("afterend", box);
    btn.setAttribute("aria-controls", box.id);
    btn.setAttribute("aria-expanded", "true");
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("button.term");
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    if (btn.getAttribute("aria-expanded") === "true") close(btn); else open(btn);
  }, true);

  function upgrade(root) {
    for (const b of (root || document).querySelectorAll("button.term")) {
      if (!b.hasAttribute("aria-expanded")) b.setAttribute("aria-expanded", "false");
      if (!b.title && GLOSS[b.dataset.term]) b.title = "What's this? " + GLOSS[b.dataset.term].name;
    }
  }
  // pages rewrite step text (and page 2 its readouts, many times a second): batch per frame
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; upgrade(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => upgrade());
  else upgrade();

  window.Gloss = { terms: GLOSS, upgrade };
})();
