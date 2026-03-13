// Basic type-ish helpers via JSDoc for editor tooling

/**
 * @typedef {{ amplitude: number; center: number; sigma: number; }} GaussianParams
 */

/**
 * @typedef {{ amplitude: number; center: number; sigma: number; knownLine: boolean; label?: string; transition?: string }} TrueLine
 */

/**
 * @typedef {{ id: number; amplitude: number; center: number; sigma: number }} PlayerGaussian
 */

/**
 * @typedef {{ id: number; name: string; xMin: number; xMax: number; noiseLevel: number; baseline: number; trueLines: TrueLine[]; maxGaussians: number; errorThresholdPercent: number }} LevelConfig
 */

/**
 * Evaluate a single Gaussian.
 * @param {number[]} x
 * @param {GaussianParams} p
 * @returns {number[]}
 */
function evaluateGaussian(x, p) {
  const { amplitude, center, sigma } = p;
  const invTwoSigma2 = 1 / (2 * sigma * sigma);
  return x.map((xi) => amplitude * Math.exp(-(xi - center) * (xi - center) * invTwoSigma2));
}

/**
 * Sum multiple Gaussians plus constant baseline.
 * @param {number[]} x
 * @param {GaussianParams[]} gaussians
 * @param {number} baseline
 * @returns {number[]}
 */
function sumGaussians(x, gaussians, baseline) {
  const y = new Array(x.length).fill(baseline);
  for (const g of gaussians) {
    const gy = evaluateGaussian(x, g);
    for (let i = 0; i < y.length; i++) {
      y[i] += gy[i];
    }
  }
  return y;
}

/**
 * Compute mean squared error between two vectors.
 * @param {number[]} yTrue
 * @param {number[]} yPred
 */
function meanSquaredError(yTrue, yPred) {
  let s = 0;
  const n = Math.min(yTrue.length, yPred.length);
  for (let i = 0; i < n; i++) {
    const d = yTrue[i] - yPred[i];
    s += d * d;
  }
  return s / n;
}

/**
 * Generate a regular grid.
 * @param {number} min
 * @param {number} max
 * @param {number} n
 * @returns {number[]}
 */
function linspace(min, max, n) {
  const arr = new Array(n);
  const step = (max - min) / (n - 1);
  for (let i = 0; i < n; i++) {
    arr[i] = min + step * i;
  }
  return arr;
}

/**
 * Generate synthetic spectrum for a level.
 * @param {LevelConfig} level
 * @returns {{ x: number[]; y: number[]; trueLines: TrueLine[] }}
 */
function generateSpectrum(level) {
  const points = 800;
  const x = linspace(level.xMin, level.xMax, points);
  const gaussians = level.trueLines.map((tl) => ({
    amplitude: tl.amplitude,
    center: tl.center,
    sigma: tl.sigma,
  }));
  let y = sumGaussians(x, gaussians, level.baseline);
  if (level.noiseLevel > 0) {
    y = y.map((v) => v + (Math.random() * 2 - 1) * level.noiseLevel);
  }
  return { x, y, trueLines: level.trueLines.slice() };
}

/**
 * Compute per-line percent error in center between true lines and player gaussians.
 * @param {TrueLine[]} trueLines
 * @param {PlayerGaussian[]} playerGs
 * @returns {{ line: TrueLine; matchedGaussian: PlayerGaussian | null; percentError: number | null }[]}
 */
function computeLineErrors(trueLines, playerGs) {
  return trueLines.map((line) => {
    if (playerGs.length === 0) {
      return { line, matchedGaussian: null, percentError: null };
    }
    let best = null;
    let bestDist = Infinity;
    for (const g of playerGs) {
      const dist = Math.abs(g.center - line.center);
      if (dist < bestDist) {
        bestDist = dist;
        best = g;
      }
    }
    if (!best || line.center === 0) {
      return { line, matchedGaussian: best, percentError: null };
    }
    const percentError = (Math.abs(line.center - best.center) / Math.abs(line.center)) * 100;
    return { line, matchedGaussian: best, percentError };
  });
}

/**
 * Determine fit quality text class from MSE value.
 * @param {number} mse
 */
function describeFitQuality(mse) {
  if (!isFinite(mse)) return { label: "No fit yet", cls: "" };
  if (mse < 0.01) return { label: "Excellent fit", cls: "good" };
  if (mse < 0.05) return { label: "Good fit", cls: "good" };
  if (mse < 0.15) return { label: "Reasonable fit", cls: "ok" };
  return { label: "Poor fit", cls: "bad" };
}

/**
 * Curated astronomical line catalog (CDMS-style rest frequencies in GHz).
 * Frequencies from the Cologne Database for Molecular Spectroscopy (CDMS):
 * https://cdms.astro.uni-koeln.de/classic/
 * @type {{ frequencyGHz: number; molecule: string; tag: string }[]}
 */
const CDMS_CATALOG = [
  { frequencyGHz: 72.837948, molecule: "H2CO", tag: "030501", transition: "1(1,0)-1(1,1)" },
  { frequencyGHz: 84.521172, molecule: "CH3OH", tag: "032504", transition: "5(1,4)-4(2,2)" },
  { frequencyGHz: 88.631847, molecule: "HCN", tag: "027501", transition: "J=1-0" },
  { frequencyGHz: 89.188523, molecule: "HCO+", tag: "029507", transition: "J=1-0" },
  { frequencyGHz: 93.173764, molecule: "N2H+", tag: "029506", transition: "J=1-0" },
  { frequencyGHz: 96.412982, molecule: "C34S", tag: "046501", transition: "J=2-1" },
  { frequencyGHz: 97.980968, molecule: "CS", tag: "044501", transition: "J=2-1" },
  { frequencyGHz: 99.299870, molecule: "SO", tag: "048501", transition: "3(2)-2(1)" },
  { frequencyGHz: 109.782173, molecule: "C18O", tag: "030502", transition: "J=1-0" },
  { frequencyGHz: 110.201354, molecule: "13CO", tag: "029501", transition: "J=1-0" },
  { frequencyGHz: 113.490982, molecule: "CN", tag: "026501", transition: "N=1-0" },
  { frequencyGHz: 115.271202, molecule: "CO", tag: "028503", transition: "J=1-0" },
  { frequencyGHz: 145.602949, molecule: "H2CO", tag: "030501", transition: "2(1,1)-2(1,2)" },
  { frequencyGHz: 218.222192, molecule: "H2CO", tag: "030501", transition: "3(0,3)-2(0,2)" },
  { frequencyGHz: 218.475632, molecule: "H2CO", tag: "030501", transition: "3(2,1)-2(2,0)" },
  { frequencyGHz: 219.560319, molecule: "C18O", tag: "030502", transition: "J=2-1" },
  { frequencyGHz: 220.398684, molecule: "13CO", tag: "029501", transition: "J=2-1" },
  { frequencyGHz: 230.538000, molecule: "CO", tag: "028503", transition: "J=2-1" },
  { frequencyGHz: 244.935557, molecule: "CS", tag: "044501", transition: "J=5-4" },
  { frequencyGHz: 265.886434, molecule: "HCN", tag: "027501", transition: "J=3-2" },
  { frequencyGHz: 267.557619, molecule: "HCO+", tag: "029507", transition: "J=3-2" },
  { frequencyGHz: 279.511701, molecule: "N2H+", tag: "029506", transition: "J=3-2" },
  { frequencyGHz: 293.912173, molecule: "H2CO", tag: "030501", transition: "4(1,3)-4(1,4)" },
  { frequencyGHz: 310.019349, molecule: "CS", tag: "044501", transition: "J=6-5" },
];

/**
 * Find the closest CDMS catalog line to a given frequency (GHz).
 * @param {number} frequencyGHz
 * @returns {{ frequencyGHz: number; molecule: string; tag: string } | null}
 */
function findClosestCDMSLine(frequencyGHz) {
  if (CDMS_CATALOG.length === 0) return null;
  let best = CDMS_CATALOG[0];
  let bestDist = Math.abs(CDMS_CATALOG[0].frequencyGHz - frequencyGHz);
  for (let i = 1; i < CDMS_CATALOG.length; i++) {
    const d = Math.abs(CDMS_CATALOG[i].frequencyGHz - frequencyGHz);
    if (d < bestDist) {
      bestDist = d;
      best = CDMS_CATALOG[i];
    }
  }
  return best;
}

/** @type {LevelConfig[]} */
const LEVELS = [
  {
    id: 1,
    name: "Level 1 – Warm-up",
    xMin: 86,
    xMax: 95,
    noiseLevel: 0.08,
    baseline: 0.3,
    errorThresholdPercent: 5,
    maxGaussians: 3,
    trueLines: [
      { amplitude: 3.2, center: 88.631847, sigma: 0.25, knownLine: true, label: "HCN", transition: "J=1-0" },
      { amplitude: 2.9, center: 89.188523, sigma: 0.28, knownLine: true, label: "HCO+", transition: "J=1-0" },
    ],
  },
  {
    id: 2,
    name: "Level 2 – Blended",
    xMin: 93,
    xMax: 102,
    noiseLevel: 0.22,
    baseline: 0.5,
    errorThresholdPercent: 5,
    maxGaussians: 4,
    trueLines: [
      { amplitude: 2.8, center: 96.412982, sigma: 0.22, knownLine: true, label: "C34S", transition: "J=2-1" },
      { amplitude: 2.1, center: 97.980968, sigma: 0.26, knownLine: false },
      { amplitude: 2.6, center: 99.299870, sigma: 0.24, knownLine: true, label: "SO", transition: "3(2)-2(1)" },
    ],
  },
  {
    id: 3,
    name: "Level 3 – Crowded",
    xMin: 217,
    xMax: 235,
    noiseLevel: 0.38,
    baseline: 0.65,
    errorThresholdPercent: 5,
    maxGaussians: 5,
    trueLines: [
      { amplitude: 2.5, center: 218.222192, sigma: 0.28, knownLine: true, label: "H2CO", transition: "3(0,3)-2(0,2)" },
      { amplitude: 2.7, center: 218.475632, sigma: 0.30, knownLine: false },
      { amplitude: 2.2, center: 219.560319, sigma: 0.24, knownLine: true, label: "C18O", transition: "J=2-1" },
      { amplitude: 2.0, center: 220.398684, sigma: 0.26, knownLine: true, label: "13CO", transition: "J=2-1" },
    ],
  },
];

/**
 * @param {{ level: LevelConfig; onCompletion: (summary: any) => void }} props
 */
function SpectrumGameView(props) {
  const { level, onCompletion } = props;
  const [spectrum] = React.useState(() => generateSpectrum(level));
  const [playerGaussians, setPlayerGaussians] = React.useState(
    () =>
      /** @type {PlayerGaussian[]} */ [
        {
          id: 1,
          amplitude: level.trueLines[0]?.amplitude ?? 3,
          center: spectrum.x[Math.floor(spectrum.x.length / 2)],
          sigma: level.trueLines[0]?.sigma ?? 0.25,
        },
      ]
  );
  const [chartRef, setChartRef] = React.useState(/** @type {HTMLCanvasElement | null} */ (null));
  const chartInstanceRef = React.useRef(/** @type {Chart | null} */ (null));
  const [mse, setMse] = React.useState(NaN);
  const [completed, setCompleted] = React.useState(false);
  const [completionSummary, setCompletionSummary] = React.useState(null);

  const modelY = React.useMemo(() => {
    const gs = playerGaussians.map((g) => ({
      amplitude: g.amplitude,
      center: g.center,
      sigma: g.sigma,
    }));
    return sumGaussians(spectrum.x, gs, level.baseline);
  }, [playerGaussians, spectrum.x, level.baseline]);

  React.useEffect(() => {
    const newMse = meanSquaredError(spectrum.y, modelY);
    setMse(newMse);
  }, [modelY, spectrum.y]);

  React.useEffect(() => {
    if (!chartRef) return;
    const ctx = chartRef.getContext("2d");
    if (!ctx) return;
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    // Individual Gaussian components (so the player can see each fitted line)
    const gaussianDatasets = playerGaussians.map((g, idx) => {
      const curve = evaluateGaussian(spectrum.x, {
        amplitude: g.amplitude,
        center: g.center,
        sigma: g.sigma,
      }).map((v) => v + level.baseline);
      const colors = [
        "rgba(248, 113, 113, 0.9)",
        "rgba(251, 191, 36, 0.9)",
        "rgba(52, 211, 153, 0.9)",
        "rgba(96, 165, 250, 0.9)",
        "rgba(244, 114, 182, 0.9)",
      ];
      return {
        label: "Gaussian " + (idx + 1),
        data: curve,
        borderColor: colors[idx % colors.length],
        pointRadius: 0,
        borderWidth: 1,
        borderDash: [4, 3],
      };
    });

    chartInstanceRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: spectrum.x,
        datasets: [
          {
            label: "Observed spectrum",
            data: spectrum.y,
            borderColor: "rgba(96, 165, 250, 1)",
            pointRadius: 0,
            borderWidth: 1.5,
          },
          {
            label: "Model fit",
            data: modelY,
            borderColor: "rgba(52, 211, 153, 1)",
            pointRadius: 0,
            borderWidth: 1.5,
          },
          // overlay each Gaussian component
          ...gaussianDatasets,
        ],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: {
            labels: { color: "#e5e5ff" },
          },
        },
        scales: {
          x: {
            ticks: { color: "#a5b4fc", maxTicksLimit: 8 },
            title: { display: true, text: "Frequency (GHz)", color: "#e5e5ff" },
          },
          y: {
            ticks: { color: "#a5b4fc" },
            title: { display: true, text: "Intensity", color: "#e5e5ff" },
          },
        },
      },
    });
  }, [chartRef, spectrum.x, spectrum.y, modelY, playerGaussians, level.baseline]);

  /** @param {number} count */
  function handleSetCount(count) {
    const max = level.maxGaussians;
    const clamped = Math.max(1, Math.min(count, max));
    setPlayerGaussians((prev) => {
      const arr = [...prev];
      if (arr.length < clamped) {
        const nextId = arr.length ? Math.max(...arr.map((g) => g.id)) + 1 : 1;
        while (arr.length < clamped) {
          const guessCenter =
            spectrum.x[Math.floor(((arr.length + 1) / (clamped + 1)) * spectrum.x.length)] ??
            spectrum.x[0];
          arr.push({
            id: arr.length ? Math.max(...arr.map((g) => g.id)) + 1 : nextId,
            amplitude: level.trueLines[0]?.amplitude ?? 2.5,
            center: guessCenter,
            sigma: level.trueLines[0]?.sigma ?? 0.25,
          });
        }
      } else if (arr.length > clamped) {
        arr.length = clamped;
      }
      return arr;
    });
  }

  /**
   * @param {number} id
   * @param {keyof PlayerGaussian} field
   * @param {number} value
   */
  function handleUpdateGaussian(id, field, value) {
    setPlayerGaussians((prev) =>
      prev.map((g) => (g.id === id ? { ...g, [field]: value } : g))
    );
  }

  function handleReset() {
    setPlayerGaussians([
      {
        id: 1,
        amplitude: level.trueLines[0]?.amplitude ?? 3,
        center: spectrum.x[Math.floor(spectrum.x.length / 2)],
        sigma: level.trueLines[0]?.sigma ?? 0.25,
      },
    ]);
    setCompleted(false);
    setCompletionSummary(null);
  }

  function handleSubmit() {
    const lineErrors = computeLineErrors(
      spectrum.trueLines,
      playerGaussians
    );
    const allWithin = lineErrors.every((le) => {
      if (le.percentError == null) return false;
      return le.percentError <= level.errorThresholdPercent;
    });
    const summary = {
      levelId: level.id,
      levelName: level.name,
      lineErrors,
      mse,
      passed: allWithin,
    };
    setCompletionSummary(summary);
    setCompleted(allWithin);
    if (allWithin) {
      onCompletion(summary);
    }
  }

  const fitQuality = describeFitQuality(mse);

  return React.createElement(
    "div",
    { className: "game-layout" },
    React.createElement(
      "div",
      { className: "panel" },
      React.createElement(
        "div",
        { className: "panel-title" },
        level.name
      ),
      React.createElement("canvas", {
        ref: setChartRef,
        className: "plot-canvas",
      }),
      React.createElement(
        "div",
        { className: "fit-quality " + fitQuality.cls },
        "Fit quality: ",
        fitQuality.label,
        " (MSE = ",
        Number.isFinite(mse) ? mse.toFixed(3) : "—",
        ")"
      ),
      completed &&
        React.createElement(
          "div",
          { className: "completion-banner" },
          "Level completed! All visible lines fitted within ",
          level.errorThresholdPercent,
          "% in center frequency."
        )
    ),
    React.createElement(
      "div",
      { className: "controls-column" },
      React.createElement(
        "div",
        { className: "panel" },
        React.createElement(
          "div",
          { className: "controls-header" },
          React.createElement(
            "span",
            { className: "panel-title" },
            "Gaussian components"
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "span",
              { style: { fontSize: "0.75rem", marginRight: 6 } },
              "Count: ",
              playerGaussians.length,
              " / ",
              level.maxGaussians
            ),
            React.createElement(
              "button",
              {
                className: "secondary-button",
                onClick: () => handleSetCount(playerGaussians.length + 1),
              },
              "+ Gaussian"
            )
          )
        ),
        playerGaussians.map((g, idx) =>
          React.createElement(
            "div",
            { key: g.id, className: "gaussian-row" },
            React.createElement(
              "div",
              { className: "gaussian-row-header" },
              React.createElement(
                "span",
                { style: { fontSize: "0.8rem" } },
                "Gaussian ",
                idx + 1
              )
            ),
            React.createElement(
              "div",
              { className: "slider-group" },
              React.createElement(
                "div",
                { className: "slider-label" },
                React.createElement("span", null, "Amplitude"),
                React.createElement(
                  "span",
                  { className: "value" },
                  g.amplitude.toFixed(2)
                )
              ),
              React.createElement("input", {
                type: "range",
                min: 0.5,
                max: 5,
                step: 0.1,
                value: g.amplitude,
                className: "slider-input",
                onChange: (e) =>
                  handleUpdateGaussian(
                    g.id,
                    "amplitude",
                    parseFloat(e.target.value)
                  ),
              })
            ),
            React.createElement(
              "div",
              { className: "slider-group" },
React.createElement(
              "div",
              { className: "slider-label" },
              React.createElement("span", null, "Center (GHz, CDMS)"),
                React.createElement(
                  "span",
                  { className: "value" },
                  g.center.toFixed(2)
                )
              ),
              React.createElement("input", {
                type: "range",
                min: level.xMin,
                max: level.xMax,
                step: (level.xMax - level.xMin) / 200,
                value: g.center,
                className: "slider-input",
                onChange: (e) =>
                  handleUpdateGaussian(
                    g.id,
                    "center",
                    parseFloat(e.target.value)
                  ),
              })
            ),
            React.createElement(
              "div",
              { className: "slider-group" },
              React.createElement(
                "div",
                { className: "slider-label" },
                React.createElement("span", null, "Width (sigma)"),
                React.createElement(
                  "span",
                  { className: "value" },
                  g.sigma.toFixed(2)
                )
              ),
              React.createElement("input", {
                type: "range",
                min: 0.05,
                max: 1.2,
                step: 0.01,
                value: g.sigma,
                className: "slider-input",
                onChange: (e) =>
                  handleUpdateGaussian(
                    g.id,
                    "sigma",
                    parseFloat(e.target.value)
                  ),
              })
            )
          )
        ),
        React.createElement(
          "div",
          { style: { display: "flex", gap: 8, marginTop: 4 } },
          React.createElement(
            "button",
            { className: "secondary-button", onClick: handleReset },
            "Reset level"
          ),
          React.createElement(
            "button",
            { className: "primary-button", onClick: handleSubmit },
            "Submit fit"
          )
        )
      ),
      React.createElement(
        "div",
        { className: "panel" },
        React.createElement(
          "div",
          { className: "panel-title" },
          "HUD"
        ),
        React.createElement(
          "div",
          { className: "hud-metrics" },
          React.createElement(
            "div",
            { className: "metric-pill" },
            "True lines: ",
            spectrum.trueLines.length
          ),
          React.createElement(
            "div",
            { className: "metric-pill" },
            "Max Gaussians: ",
            level.maxGaussians
          ),
          React.createElement(
            "div",
            { className: "metric-pill" },
            "Threshold: ",
            level.errorThresholdPercent,
            "% center error"
          )
        ),
        React.createElement(
          "div",
          { className: "hud-status" },
          "Frequencies are real astronomical lines (CDMS). Match the model (green) to the spectrum (blue), then click \"Submit fit\". Fitted frequencies are shown in GHz."
        ),
        completionSummary &&
          React.createElement(
            "div",
            { style: { marginTop: 8 } },
            React.createElement(
              "div",
              { style: { fontSize: "0.8rem", marginBottom: 4 } },
              "Line summary — frequencies in GHz (CDMS)"
            ),
            React.createElement(
              "table",
              { className: "lines-table" },
              React.createElement(
                "thead",
                null,
                React.createElement(
                  "tr",
                  null,
                  React.createElement("th", null, "Frequency (GHz)"),
                  React.createElement("th", null, "Molecule"),
                  React.createElement("th", null, "Fitted frequency (GHz)"),
                  React.createElement("th", { className: "error-cell" }, "Error %")
                )
              ),
              React.createElement(
                "tbody",
                null,
                completionSummary.lineErrors.map((le, idx) => {
                  const fittedGHz = le.matchedGaussian ? le.matchedGaussian.center : null;
                  const closest = fittedGHz != null ? findClosestCDMSLine(fittedGHz) : null;
                  return React.createElement(
                    "tr",
                    { key: idx },
                    React.createElement(
                      "td",
                      null,
                      le.line.center.toFixed(4)
                    ),
                    React.createElement(
                      "td",
                      null,
                      le.line.knownLine
                        ? (le.line.transition ? le.line.label + " " + le.line.transition : le.line.label || "Known")
                        : React.createElement(
                            "span",
                            { className: "unknown-label" },
                            "Unknown line"
                          )
                    ),
                    React.createElement(
                      "td",
                      null,
                      fittedGHz != null
                        ? React.createElement(
                            "span",
                            null,
                            fittedGHz.toFixed(4),
                            closest && Math.abs(closest.frequencyGHz - fittedGHz) < 0.5
                              ? React.createElement(
                                  "span",
                                  { style: { marginLeft: 6, opacity: 0.85, fontSize: "0.75rem" } },
                                  "→ ",
                                  closest.molecule
                                )
                              : null
                          )
                        : "—"
                    ),
                    React.createElement(
                      "td",
                      { className: "error-cell" },
                      le.percentError == null
                        ? "—"
                        : le.percentError.toFixed(2)
                    )
                  );
                })
              )
            )
          )
      )
    )
  );
}

function App() {
  const [levelIndex, setLevelIndex] = React.useState(0);
  const [passedLevels, setPassedLevels] = React.useState(() => new Set());
  const [completionModal, setCompletionModal] = React.useState(null);
  const [exited, setExited] = React.useState(false);

  /** @param {any} summary */
  function handleLevelCompleted(summary) {
    setPassedLevels((prev) => {
      const next = new Set(prev);
      next.add(summary.levelId);
      return next;
    });
    setCompletionModal({
      levelId: summary.levelId,
      levelName: summary.levelName,
      passed: summary.passed,
      mse: summary.mse,
      lineErrors: summary.lineErrors,
    });
  }

  function downloadCompletionCSV() {
    if (!completionModal || !completionModal.lineErrors) return;
    const rows = [];
    rows.push(["Level", completionModal.levelId]);
    rows.push(["Level name", completionModal.levelName]);
    rows.push(["Passed", completionModal.passed ? "yes" : "no"]);
    rows.push(["MSE", String(Number.isFinite(completionModal.mse) ? completionModal.mse.toFixed(6) : "")]);
    rows.push([]);
    rows.push([
      "True freq (GHz)",
      "Molecule",
      "Fitted freq (GHz)",
      "Error (%)",
      "Amplitude",
      "Center (GHz)",
      "Sigma",
    ]);
    completionModal.lineErrors.forEach((le) => {
      const mol = le.line.knownLine
        ? (le.line.transition ? le.line.label + " " + le.line.transition : le.line.label || "")
        : "Unknown line";
      const fitted = le.matchedGaussian;
      rows.push([
        le.line.center.toFixed(6),
        mol,
        fitted ? fitted.center.toFixed(6) : "",
        le.percentError != null ? le.percentError.toFixed(4) : "",
        fitted ? fitted.amplitude.toFixed(4) : "",
        fitted ? fitted.center.toFixed(6) : "",
        fitted ? fitted.sigma.toFixed(4) : "",
      ]);
    });
    const csv = rows.map((r) => r.map((c) => (/\s|,|"/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "spectrum_fit_level_" + completionModal.levelId + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleNextLevel() {
    setCompletionModal(null);
    setLevelIndex((prev) => {
      const nextIdx = prev + 1;
      return nextIdx < LEVELS.length ? nextIdx : prev;
    });
  }

  function handleExitGame() {
    setCompletionModal(null);
    setExited(true);
  }

  const currentLevel = LEVELS[levelIndex];

  return React.createElement(
    "div",
    { className: "app-shell" },
    React.createElement(
      "header",
      { className: "app-header" },
      React.createElement(
        "div",
        { className: "title" },
        "Spectrum Fitter"
      ),
      React.createElement(
        "div",
        { className: "level-select" },
        LEVELS.map((lvl, idx) =>
          React.createElement(
            "button",
            {
              key: lvl.id,
              className:
                "level-button " +
                (idx === levelIndex ? "active" : "") +
                (passedLevels.has(lvl.id) ? " completed" : ""),
              onClick: () => setLevelIndex(idx),
            },
            "L",
            lvl.id,
            passedLevels.has(lvl.id) ? " ✓" : ""
          )
        )
      )
    ),
    exited
      ? React.createElement(
          "main",
          null,
          React.createElement(
            "div",
            { className: "panel", style: { marginTop: 24, textAlign: "center" } },
            React.createElement(
              "div",
              { className: "panel-title" },
              "Thanks for playing!"
            ),
            React.createElement(
              "p",
              { style: { fontSize: "0.9rem", opacity: 0.85 } },
              "You can refresh the page to start again or close the tab to exit."
            )
          )
        )
      : React.createElement(
          "main",
          null,
          React.createElement(SpectrumGameView, {
            key: currentLevel.id,
            level: currentLevel,
            onCompletion: handleLevelCompleted,
          })
        ),
    completionModal &&
      React.createElement(
        "div",
        { className: "modal-backdrop" },
        React.createElement(
          "div",
          { className: "modal-content modal-content-wide" },
          React.createElement(
            "div",
            { className: "panel-title" },
            "Congratulations!"
          ),
          React.createElement(
            "p",
            { style: { fontSize: "0.9rem", marginBottom: 8 } },
            "You passed Level ",
            completionModal.levelId,
            " — ",
            completionModal.levelName || ""
          ),
          React.createElement(
            "div",
            { style: { fontSize: "0.8rem", marginBottom: 10 } },
            "MSE = ",
            Number.isFinite(completionModal.mse) ? completionModal.mse.toFixed(6) : "—",
            " — Replay the level to try for a smaller error."
          ),
          completionModal.lineErrors &&
            completionModal.lineErrors.length > 0 &&
            React.createElement(
              "div",
              { className: "modal-table-wrap" },
              React.createElement(
                "table",
                { className: "lines-table modal-lines-table" },
                React.createElement(
                  "thead",
                  null,
                  React.createElement(
                    "tr",
                    null,
                    React.createElement("th", null, "Freq (GHz)"),
                    React.createElement("th", null, "Molecule"),
                    React.createElement("th", null, "Fitted (GHz)"),
                    React.createElement("th", { className: "error-cell" }, "Error %"),
                    React.createElement("th", null, "Amplitude"),
                    React.createElement("th", null, "Center (GHz)"),
                    React.createElement("th", null, "Sigma")
                  )
                ),
                React.createElement(
                  "tbody",
                  null,
                  completionModal.lineErrors.map((le, idx) =>
                    React.createElement(
                      "tr",
                      { key: idx },
                      React.createElement("td", null, le.line.center.toFixed(4)),
                      React.createElement(
                        "td",
                        null,
                        le.line.knownLine
                          ? (le.line.transition ? le.line.label + " " + le.line.transition : le.line.label || "—")
                          : "Unknown line"
                      ),
                      React.createElement(
                        "td",
                        null,
                        le.matchedGaussian ? le.matchedGaussian.center.toFixed(4) : "—"
                      ),
                      React.createElement(
                        "td",
                        { className: "error-cell" },
                        le.percentError != null ? le.percentError.toFixed(2) : "—"
                      ),
                      React.createElement(
                        "td",
                        null,
                        le.matchedGaussian ? le.matchedGaussian.amplitude.toFixed(3) : "—"
                      ),
                      React.createElement(
                        "td",
                        null,
                        le.matchedGaussian ? le.matchedGaussian.center.toFixed(4) : "—"
                      ),
                      React.createElement(
                        "td",
                        null,
                        le.matchedGaussian ? le.matchedGaussian.sigma.toFixed(3) : "—"
                      )
                    )
                  )
                )
              )
            ),
          React.createElement(
            "div",
            { className: "modal-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "secondary-button",
                onClick: downloadCompletionCSV,
              },
              "Save as CSV"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "secondary-button",
                onClick: handleExitGame,
              },
              "Exit game"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "primary-button",
                onClick: handleNextLevel,
              },
              completionModal.levelId < LEVELS.length ? "Next level" : "Stay on last level"
            )
          )
        )
      )
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(React.createElement(App));
}

