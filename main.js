// Spectrum Fitter — public outreach game (CDMS lines + sonification)

/**
 * @typedef {{ amplitude: number; center: number; sigma: number; }} GaussianParams
 * @typedef {{ amplitude: number; center: number; sigma: number; knownLine: boolean; label?: string; transition?: string }} TrueLine
 * @typedef {{ id: number; amplitude: number; center: number; sigma: number }} PlayerGaussian
 * @typedef {{ id: number; name: string; xMin: number; xMax: number; noiseLevel: number; baseline: number; trueLines: TrueLine[]; maxGaussians: number; errorThresholdPercent: number }} LevelConfig
 */

const CDMS_URL = "https://cdms.astro.uni-koeln.de/classic/";
const STORAGE_KEY = "spectrumFitter.leaderboard.v2";
const IDLE_MS = 120000;
const AUDIBLE_BASE_HZ = 220;
const AUDIBLE_MAX_HZ = 4000;
const LEADERBOARD_TOP_N = 5;
const MAX_NAME_LEN = 20;

// ——— Math ———

function evaluateGaussian(x, p) {
  const { amplitude, center, sigma } = p;
  const invTwoSigma2 = 1 / (2 * sigma * sigma);
  return x.map((xi) => amplitude * Math.exp(-(xi - center) * (xi - center) * invTwoSigma2));
}

function sumGaussians(x, gaussians, baseline) {
  const y = new Array(x.length).fill(baseline);
  for (const g of gaussians) {
    const gy = evaluateGaussian(x, g);
    for (let i = 0; i < y.length; i++) y[i] += gy[i];
  }
  return y;
}

function meanSquaredError(yTrue, yPred) {
  let s = 0;
  const n = Math.min(yTrue.length, yPred.length);
  for (let i = 0; i < n; i++) {
    const d = yTrue[i] - yPred[i];
    s += d * d;
  }
  return s / n;
}

function linspace(min, max, n) {
  const arr = new Array(n);
  const step = (max - min) / (n - 1);
  for (let i = 0; i < n; i++) arr[i] = min + step * i;
  return arr;
}

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

function describeFitQuality(mse) {
  if (!isFinite(mse)) return { label: "No fit yet", cls: "" };
  if (mse < 0.01) return { label: "Excellent fit", cls: "good" };
  if (mse < 0.05) return { label: "Good fit", cls: "good" };
  if (mse < 0.15) return { label: "Reasonable fit", cls: "ok" };
  return { label: "Poor fit", cls: "bad" };
}

function meanPercentError(lineErrors) {
  const vals = lineErrors.map((le) => le.percentError).filter((v) => v != null && isFinite(v));
  if (!vals.length) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Stars from mean % error: ≤1% → 3, ≤3% → 2, ≤5% → 1 */
function starsFromMeanError(meanErr) {
  if (!isFinite(meanErr)) return 0;
  if (meanErr <= 1) return 3;
  if (meanErr <= 3) return 2;
  if (meanErr <= 5) return 1;
  return 0;
}

function formatScaleFactor(factor) {
  if (!isFinite(factor) || factor <= 0) return "—";
  const exp = Math.floor(Math.log10(factor));
  const mant = factor / Math.pow(10, exp);
  return mant.toFixed(2) + "×10" + toSuperscript(exp);
}

function toSuperscript(n) {
  const map = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
    "-": "⁻",
  };
  return String(n)
    .split("")
    .map((c) => map[c] || c)
    .join("");
}

// ——— Audio / sonification ———

let audioCtx = null;
let masterGainNode = null;
let activeNodes = [];
let globalMuted = false;
let globalVolume = 0.85;

function getAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    audioCtx = new AC();
    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.value = globalMuted ? 0 : globalVolume;
    masterGainNode.connect(audioCtx.destination);
  }
  return audioCtx;
}

/** Ensure AudioContext is running (browsers require a user gesture + await resume). */
async function ensureAudioReady() {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (e) {
      return null;
    }
  }
  if (masterGainNode) {
    masterGainNode.gain.value = globalMuted ? 0 : globalVolume;
  }
  return ctx.state === "running" ? ctx : null;
}

function setMasterVolume(vol01) {
  globalVolume = Math.max(0, Math.min(1, vol01));
  if (masterGainNode) {
    masterGainNode.gain.value = globalMuted ? 0 : globalVolume;
  }
}

function setMasterMuted(muted) {
  globalMuted = muted;
  if (masterGainNode) {
    masterGainNode.gain.value = muted ? 0 : globalVolume;
  }
  if (muted) stopAllAudio();
}

/**
 * Scale GHz radio frequencies into an audible band, preserving ratios.
 * @param {number[]} freqGHzList
 */
function scaleFrequenciesToAudible(freqGHzList) {
  const originalHz = freqGHzList.map((g) => g * 1e9);
  const minHz = Math.min.apply(null, originalHz);
  if (!isFinite(minHz) || minHz <= 0) {
    return { audibleHz: [], scaleFactor: NaN, originalHz: [] };
  }
  const scaleFactor = minHz / AUDIBLE_BASE_HZ;
  let audibleHz = originalHz.map((hz) => hz / scaleFactor);
  const maxAud = Math.max.apply(null, audibleHz);
  if (maxAud > AUDIBLE_MAX_HZ) {
    const compress = AUDIBLE_MAX_HZ / maxAud;
    audibleHz = audibleHz.map((hz) => hz * compress);
  }
  return { audibleHz, scaleFactor, originalHz };
}

function stopAllAudio() {
  activeNodes.forEach((n) => {
    try {
      n.stop();
    } catch (e) {}
    try {
      n.disconnect();
    } catch (e) {}
  });
  activeNodes = [];
}

/**
 * @returns {Promise<boolean>} true if sound started
 */
async function playTone(hz, durationSec, muted) {
  if (muted || globalMuted) return false;
  const ctx = await ensureAudioReady();
  if (!ctx || !masterGainNode || !isFinite(hz) || hz <= 0) return false;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = hz;
  const now = ctx.currentTime;
  const dur = durationSec || 1.2;
  const peak = 0.52;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.04);
  gain.gain.linearRampToValueAtTime(peak * 0.85, now + dur * 0.7);
  gain.gain.linearRampToValueAtTime(0, now + dur);
  osc.connect(gain);
  gain.connect(masterGainNode);
  osc.start(now);
  osc.stop(now + dur + 0.05);
  activeNodes.push(osc);
  osc.onended = () => {
    activeNodes = activeNodes.filter((n) => n !== osc);
  };
  return true;
}

/**
 * @returns {Promise<boolean>} true if chord started
 */
async function playChord(hzList, durationSec, muted) {
  if (muted || globalMuted) return false;
  stopAllAudio();
  const ctx = await ensureAudioReady();
  if (!ctx || !masterGainNode) return false;
  const now = ctx.currentTime;
  const dur = durationSec || 1.6;
  const amp = Math.min(0.4, 0.7 / Math.max(1, hzList.length));
  let started = false;
  hzList.forEach((hz) => {
    if (!isFinite(hz) || hz <= 0) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.05);
    gain.gain.linearRampToValueAtTime(amp * 0.85, now + dur * 0.7);
    gain.gain.linearRampToValueAtTime(0, now + dur);
    osc.connect(gain);
    gain.connect(masterGainNode);
    osc.start(now);
    osc.stop(now + dur + 0.05);
    activeNodes.push(osc);
    started = true;
  });
  return started;
}

// ——— CDMS catalog & facts ———

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
  { frequencyGHz: 241.616183, molecule: "CH3OH", tag: "032504", transition: "5(0,5)-4(0,4)" },
  { frequencyGHz: 244.935557, molecule: "CS", tag: "044501", transition: "J=5-4" },
  { frequencyGHz: 265.886434, molecule: "HCN", tag: "027501", transition: "J=3-2" },
  { frequencyGHz: 267.557619, molecule: "HCO+", tag: "029507", transition: "J=3-2" },
  { frequencyGHz: 279.511701, molecule: "N2H+", tag: "029506", transition: "J=3-2" },
  { frequencyGHz: 293.912173, molecule: "H2CO", tag: "030501", transition: "4(1,3)-4(1,4)" },
  { frequencyGHz: 310.019349, molecule: "CS", tag: "044501", transition: "J=6-5" },
];

const MOLECULE_FACTS = {
  HCN: "Hydrogen cyanide (HCN) is common in dense molecular clouds and traces warm gas near young stars.",
  "HCO+": "The formyl ion (HCO+) is a key tracer of dense, ionized gas in star-forming regions.",
  "N2H+": "Diazenylium (N2H+) survives where CO freezes out, so it maps the coldest, densest cloud cores.",
  CS: "Carbon monosulfide (CS) is a dense-gas tracer found in molecular clouds and protostellar envelopes.",
  C34S: "C³⁴S is a rarer sulfur isotope of CS; comparing isotopes helps measure how opaque a cloud is.",
  SO: "Sulfur monoxide (SO) often brightens in shocked gas, for example where outflows slam into cloud material.",
  CO: "Carbon monoxide (CO) is the most widely used tracer of molecular gas across the Milky Way and beyond.",
  "13CO": "¹³CO is a less abundant CO isotope; it stays optically thinner and probes denser gas than main-line CO.",
  C18O: "C¹⁸O is even rarer than ¹³CO and is used to weigh the densest parts of molecular clouds.",
  CN: "The cyano radical (CN) is seen in UV-irradiated cloud edges and helps probe chemistry near starlight.",
  H2CO: "Formaldehyde (H₂CO) appears in many environments, from cold clouds to comets and star-forming regions.",
  CH3OH: "Methanol (CH₃OH) is a complex organic molecule linked to ice chemistry on dust grains.",
};

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

function loadLeaderboard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch (e) {
    return {};
  }
}

/** Clear all named leaderboard scores for this device. */
function clearLeaderboard() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
  return {};
}

function sanitizePlayerName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_NAME_LEN);
}

/**
 * Insert a named score for a level (top N by meanErr, then mse).
 * @returns {{ board: object; accepted: boolean; rank: number | null }}
 */
function saveLeaderboardEntry(levelId, name, mse, meanErr, stars) {
  const cleanName = sanitizePlayerName(name);
  if (!cleanName) {
    return { board: loadLeaderboard(), accepted: false, rank: null };
  }
  const board = loadLeaderboard();
  const key = String(levelId);
  const list = Array.isArray(board[key]) ? board[key].slice() : [];
  const entry = {
    name: cleanName,
    meanErr: meanErr,
    mse: mse,
    stars: stars || 0,
    at: Date.now(),
  };
  list.push(entry);
  list.sort((a, b) => {
    const ae = isFinite(a.meanErr) ? a.meanErr : Infinity;
    const be = isFinite(b.meanErr) ? b.meanErr : Infinity;
    if (ae !== be) return ae - be;
    const am = isFinite(a.mse) ? a.mse : Infinity;
    const bm = isFinite(b.mse) ? b.mse : Infinity;
    return am - bm;
  });
  const trimmed = list.slice(0, LEADERBOARD_TOP_N);
  const accepted = trimmed.some(
    (e) => e.name === entry.name && e.at === entry.at && e.meanErr === entry.meanErr
  );
  const rank = accepted
    ? trimmed.findIndex((e) => e.name === entry.name && e.at === entry.at) + 1
    : null;
  board[key] = trimmed;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch (e) {}
  return { board, accepted, rank };
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
  {
    id: 4,
    name: "Level 4 – 3 mm band",
    xMin: 108,
    xMax: 117,
    noiseLevel: 0.28,
    baseline: 0.55,
    errorThresholdPercent: 5,
    maxGaussians: 5,
    trueLines: [
      { amplitude: 2.4, center: 109.782173, sigma: 0.22, knownLine: true, label: "C18O", transition: "J=1-0" },
      { amplitude: 2.6, center: 110.201354, sigma: 0.24, knownLine: true, label: "13CO", transition: "J=1-0" },
      { amplitude: 2.0, center: 113.490982, sigma: 0.26, knownLine: false },
      { amplitude: 3.0, center: 115.271202, sigma: 0.23, knownLine: true, label: "CO", transition: "J=1-0" },
    ],
  },
  {
    id: 5,
    name: "Level 5 – Submm blend",
    xMin: 228,
    xMax: 246,
    noiseLevel: 0.42,
    baseline: 0.7,
    errorThresholdPercent: 5,
    maxGaussians: 5,
    trueLines: [
      { amplitude: 3.1, center: 230.538000, sigma: 0.26, knownLine: true, label: "CO", transition: "J=2-1" },
      { amplitude: 2.0, center: 241.616183, sigma: 0.28, knownLine: false },
      { amplitude: 2.4, center: 244.935557, sigma: 0.24, knownLine: true, label: "CS", transition: "J=5-4" },
    ],
  },
  {
    id: 6,
    name: "Level 6 – Dense tracers",
    xMin: 263,
    xMax: 282,
    noiseLevel: 0.48,
    baseline: 0.75,
    errorThresholdPercent: 5,
    maxGaussians: 5,
    trueLines: [
      { amplitude: 2.6, center: 265.886434, sigma: 0.24, knownLine: true, label: "HCN", transition: "J=3-2" },
      { amplitude: 2.8, center: 267.557619, sigma: 0.26, knownLine: true, label: "HCO+", transition: "J=3-2" },
      { amplitude: 2.1, center: 279.511701, sigma: 0.28, knownLine: false },
    ],
  },
];

// ——— Shared UI bits ———

function CdmsLearnMore() {
  return React.createElement(
    "div",
    { className: "cdms-block" },
    React.createElement(
      "div",
      { className: "cdms-text" },
      React.createElement("div", { className: "panel-title" }, "Learn more"),
      React.createElement(
        "p",
        { className: "cdms-copy" },
        "Line frequencies come from the Cologne Database for Molecular Spectroscopy (CDMS)."
      ),
      React.createElement(
        "a",
        { href: CDMS_URL, target: "_blank", rel: "noopener noreferrer", className: "cdms-link" },
        CDMS_URL
      )
    ),
    React.createElement("img", {
      src: "./cdms-qr.png",
      alt: "QR code linking to CDMS",
      className: "cdms-qr",
      width: 120,
      height: 120,
    })
  );
}

function StarsDisplay(props) {
  const n = props.stars || 0;
  return React.createElement(
    "span",
    { className: "stars", "aria-label": n + " stars" },
    [1, 2, 3].map((i) =>
      React.createElement("span", { key: i, className: i <= n ? "star on" : "star" }, "★")
    )
  );
}

function LeaderboardPanel(props) {
  const board = props.board || {};
  const onReset = props.onReset;
  return React.createElement(
    "div",
    { className: "panel leaderboard-panel" },
    React.createElement(
      "div",
      { className: "leaderboard-header" },
      React.createElement("div", { className: "panel-title" }, "Leaderboard"),
      onReset &&
        React.createElement(
          "button",
          {
            type: "button",
            className: "secondary-button tiny-button",
            onClick: onReset,
          },
          "Reset leaderboard"
        )
    ),
    React.createElement(
      "p",
      { className: "leaderboard-intro" },
      "Top ",
      LEADERBOARD_TOP_N,
      " scores per level on this device (lower mean error is better)."
    ),
    React.createElement(
      "div",
      { className: "leaderboard-levels" },
      LEVELS.map((lvl) => {
        const list = Array.isArray(board[String(lvl.id)]) ? board[String(lvl.id)] : [];
        return React.createElement(
          "div",
          { key: lvl.id, className: "leaderboard-level-block" },
          React.createElement(
            "div",
            { className: "leaderboard-level-title" },
            "L",
            lvl.id,
            " — ",
            lvl.name.replace(/^Level \d+ – /, "")
          ),
          list.length === 0
            ? React.createElement(
                "p",
                { className: "leaderboard-empty" },
                "No scores yet — be the first!"
              )
            : React.createElement(
                "ol",
                { className: "leaderboard-list" },
                list.map((entry, i) =>
                  React.createElement(
                    "li",
                    { key: entry.at + "-" + entry.name + "-" + i },
                    React.createElement("span", { className: "lb-rank" }, i + 1, "."),
                    React.createElement("span", { className: "lb-name" }, entry.name),
                    React.createElement(StarsDisplay, { stars: entry.stars }),
                    React.createElement(
                      "span",
                      { className: "lb-stats" },
                      isFinite(entry.meanErr) ? entry.meanErr.toFixed(2) : "—",
                      "%",
                      React.createElement(
                        "span",
                        { className: "lb-mse" },
                        " · MSE ",
                        isFinite(entry.mse) ? entry.mse.toFixed(4) : "—"
                      )
                    )
                  )
                )
              )
        );
      })
    )
  );
}

function AttractScreen(props) {
  return React.createElement(
    "div",
    { className: "attract-screen" },
    React.createElement(
      "div",
      { className: "attract-hero panel" },
      React.createElement("h1", { className: "attract-title" }, "Spectrum Fitter"),
      React.createElement(
        "p",
        { className: "attract-tagline" },
        "Fit the spectrum — hear the molecule"
      ),
      React.createElement(
        "ul",
        { className: "attract-howto" },
        React.createElement("li", null, "Add Gaussian components for each spectral line you see."),
        React.createElement(
          "li",
          null,
          "Tune amplitude, center (GHz), and width until the green model matches the blue data."
        ),
        React.createElement("li", null, "Submit your fit — pass when every line center is within 5%."),
        React.createElement("li", null, "Then hear your fitted frequencies as scaled audio tones.")
      ),
      React.createElement(
        "div",
        { className: "attract-actions" },
        React.createElement(
          "button",
          { type: "button", className: "primary-button large-button", onClick: props.onStart },
          "Start playing"
        )
      )
    ),
    React.createElement(LeaderboardPanel, { board: props.board, onReset: props.onResetLeaderboard }),
    React.createElement(CdmsLearnMore)
  );
}

// ——— Game view ———

function SpectrumGameView(props) {
  const { level, onCompletion } = props;
  const [spectrum] = React.useState(() => generateSpectrum(level));
  const [playerGaussians, setPlayerGaussians] = React.useState(() => [
    {
      id: 1,
      amplitude: level.trueLines[0]?.amplitude ?? 3,
      center: spectrum.x[Math.floor(spectrum.x.length / 2)],
      sigma: level.trueLines[0]?.sigma ?? 0.25,
    },
  ]);
  const [chartRef, setChartRef] = React.useState(null);
  const chartInstanceRef = React.useRef(null);
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
    setMse(meanSquaredError(spectrum.y, modelY));
  }, [modelY, spectrum.y]);

  React.useEffect(() => {
    if (!chartRef) return;
    const ctx = chartRef.getContext("2d");
    if (!ctx) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const colors = [
      "rgba(248, 113, 113, 0.9)",
      "rgba(251, 191, 36, 0.9)",
      "rgba(52, 211, 153, 0.9)",
      "rgba(96, 165, 250, 0.9)",
      "rgba(244, 114, 182, 0.9)",
    ];
    const gaussianDatasets = playerGaussians.map((g, idx) => ({
      label: "Gaussian " + (idx + 1),
      data: evaluateGaussian(spectrum.x, {
        amplitude: g.amplitude,
        center: g.center,
        sigma: g.sigma,
      }).map((v) => v + level.baseline),
      borderColor: colors[idx % colors.length],
      pointRadius: 0,
      borderWidth: 1,
      borderDash: [4, 3],
    }));

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
          ...gaussianDatasets,
        ],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: { legend: { labels: { color: "#e5e5ff" } } },
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

  function handleSetCount(count) {
    const clamped = Math.max(1, Math.min(count, level.maxGaussians));
    setPlayerGaussians((prev) => {
      const arr = [...prev];
      if (arr.length < clamped) {
        while (arr.length < clamped) {
          const guessCenter =
            spectrum.x[Math.floor(((arr.length + 1) / (clamped + 1)) * spectrum.x.length)] ??
            spectrum.x[0];
          arr.push({
            id: arr.length ? Math.max(...arr.map((g) => g.id)) + 1 : 1,
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

  function handleUpdateGaussian(id, field, value) {
    setPlayerGaussians((prev) => prev.map((g) => (g.id === id ? { ...g, [field]: value } : g)));
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
    const lineErrors = computeLineErrors(spectrum.trueLines, playerGaussians);
    const allWithin = lineErrors.every(
      (le) => le.percentError != null && le.percentError <= level.errorThresholdPercent
    );
    const meanErr = meanPercentError(lineErrors);
    const stars = starsFromMeanError(meanErr);
    const fittedGHz = lineErrors
      .map((le) => (le.matchedGaussian ? le.matchedGaussian.center : null))
      .filter((v) => v != null);
    const sonification = scaleFrequenciesToAudible(fittedGHz);
    const summary = {
      levelId: level.id,
      levelName: level.name,
      lineErrors,
      mse,
      meanErr,
      stars,
      sonification,
      passed: allWithin,
    };
    setCompletionSummary(summary);
    setCompleted(allWithin);
    if (allWithin) onCompletion(summary);
  }

  const fitQuality = describeFitQuality(mse);

  return React.createElement(
    "div",
    { className: "game-layout" },
    React.createElement(
      "div",
      { className: "panel" },
      React.createElement("div", { className: "panel-title" }, level.name),
      React.createElement("canvas", { ref: setChartRef, className: "plot-canvas" }),
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
          React.createElement("span", { className: "panel-title" }, "Gaussian components"),
          React.createElement(
            "div",
            { className: "controls-header-right" },
            React.createElement(
              "span",
              { className: "count-label" },
              "Count: ",
              playerGaussians.length,
              " / ",
              level.maxGaussians
            ),
            React.createElement(
              "button",
              {
                type: "button",
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
              React.createElement("span", null, "Gaussian ", idx + 1)
            ),
            React.createElement(
              "div",
              { className: "slider-group" },
              React.createElement(
                "div",
                { className: "slider-label" },
                React.createElement("span", null, "Amplitude"),
                React.createElement("span", { className: "value" }, g.amplitude.toFixed(2))
              ),
              React.createElement("input", {
                type: "range",
                min: 0.5,
                max: 5,
                step: 0.1,
                value: g.amplitude,
                className: "slider-input",
                onChange: (e) => handleUpdateGaussian(g.id, "amplitude", parseFloat(e.target.value)),
              })
            ),
            React.createElement(
              "div",
              { className: "slider-group" },
              React.createElement(
                "div",
                { className: "slider-label" },
                React.createElement("span", null, "Center (GHz, CDMS)"),
                React.createElement("span", { className: "value" }, g.center.toFixed(2))
              ),
              React.createElement("input", {
                type: "range",
                min: level.xMin,
                max: level.xMax,
                step: (level.xMax - level.xMin) / 200,
                value: g.center,
                className: "slider-input",
                onChange: (e) => handleUpdateGaussian(g.id, "center", parseFloat(e.target.value)),
              })
            ),
            React.createElement(
              "div",
              { className: "slider-group" },
              React.createElement(
                "div",
                { className: "slider-label" },
                React.createElement("span", null, "Width (sigma)"),
                React.createElement("span", { className: "value" }, g.sigma.toFixed(2))
              ),
              React.createElement("input", {
                type: "range",
                min: 0.05,
                max: 1.2,
                step: 0.01,
                value: g.sigma,
                className: "slider-input",
                onChange: (e) => handleUpdateGaussian(g.id, "sigma", parseFloat(e.target.value)),
              })
            )
          )
        ),
        React.createElement(
          "div",
          { className: "button-row" },
          React.createElement(
            "button",
            { type: "button", className: "secondary-button", onClick: handleReset },
            "Reset level"
          ),
          React.createElement(
            "button",
            { type: "button", className: "primary-button", onClick: handleSubmit },
            "Submit fit"
          )
        )
      ),
      React.createElement(
        "div",
        { className: "panel" },
        React.createElement("div", { className: "panel-title" }, "HUD"),
        React.createElement(
          "div",
          { className: "hud-metrics" },
          React.createElement("div", { className: "metric-pill" }, "True lines: ", spectrum.trueLines.length),
          React.createElement("div", { className: "metric-pill" }, "Max Gaussians: ", level.maxGaussians),
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
          'Frequencies are real astronomical lines (CDMS). Match the model (green) to the spectrum (blue), then click "Submit fit".'
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
                    React.createElement("td", null, le.line.center.toFixed(4)),
                    React.createElement(
                      "td",
                      null,
                      le.line.knownLine
                        ? le.line.transition
                          ? le.line.label + " " + le.line.transition
                          : le.line.label || "Known"
                        : React.createElement("span", { className: "unknown-label" }, "Unknown line")
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
                      le.percentError == null ? "—" : le.percentError.toFixed(2)
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

// ——— App ———

function App() {
  const [screen, setScreen] = React.useState("attract");
  const [levelIndex, setLevelIndex] = React.useState(0);
  const [passedLevels, setPassedLevels] = React.useState(() => new Set());
  const [completionModal, setCompletionModal] = React.useState(null);
  const [muted, setMuted] = React.useState(false);
  const [volume, setVolume] = React.useState(0.85);
  const [leaderboard, setLeaderboard] = React.useState(() => loadLeaderboard());
  const [showWhyScale, setShowWhyScale] = React.useState(false);
  const [playerName, setPlayerName] = React.useState("");
  const [leaderboardMsg, setLeaderboardMsg] = React.useState("");
  const [audioStatus, setAudioStatus] = React.useState("");
  const idleTimerRef = React.useRef(null);

  React.useEffect(() => {
    setMasterMuted(muted);
  }, [muted]);

  React.useEffect(() => {
    setMasterVolume(volume);
  }, [volume]);

  const resetIdle = React.useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      stopAllAudio();
      setCompletionModal(null);
      setPlayerName("");
      setLeaderboardMsg("");
      setAudioStatus("");
      setLevelIndex(0);
      setScreen("attract");
    }, IDLE_MS);
  }, []);

  React.useEffect(() => {
    const bump = () => resetIdle();
    const events = ["pointerdown", "keydown", "touchstart", "mousemove"];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    resetIdle();
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdle]);

  function handleResetLeaderboard() {
    const ok = window.confirm(
      "Reset the leaderboard on this device? All named scores for every level will be deleted."
    );
    if (!ok) return;
    setLeaderboard(clearLeaderboard());
  }

  async function handleStart() {
    await ensureAudioReady();
    setScreen("play");
    setLevelIndex(0);
    setCompletionModal(null);
    setPlayerName("");
    setLeaderboardMsg("");
    setAudioStatus("");
    resetIdle();
  }

  function handleLevelCompleted(summary) {
    setPassedLevels((prev) => {
      const next = new Set(prev);
      next.add(summary.levelId);
      return next;
    });
    setPlayerName("");
    setLeaderboardMsg("");
    setAudioStatus("");
    setCompletionModal(summary);
    resetIdle();
  }

  function handleSaveToLeaderboard() {
    if (!completionModal) return;
    const result = saveLeaderboardEntry(
      completionModal.levelId,
      playerName,
      completionModal.mse,
      completionModal.meanErr,
      completionModal.stars
    );
    setLeaderboard(result.board);
    if (!sanitizePlayerName(playerName)) {
      setLeaderboardMsg("Enter a name (max " + MAX_NAME_LEN + " characters) to save.");
      return;
    }
    if (result.accepted) {
      setLeaderboardMsg("Saved! Rank #" + result.rank + " on Level " + completionModal.levelId + ".");
    } else {
      setLeaderboardMsg("Nice try — not quite in the top " + LEADERBOARD_TOP_N + " for this level yet.");
    }
  }

  function downloadCompletionCSV() {
    if (!completionModal || !completionModal.lineErrors) return;
    const rows = [];
    rows.push(["Level", completionModal.levelId]);
    rows.push(["Level name", completionModal.levelName]);
    rows.push(["Passed", completionModal.passed ? "yes" : "no"]);
    rows.push(["MSE", String(Number.isFinite(completionModal.mse) ? completionModal.mse.toFixed(6) : "")]);
    rows.push([
      "Mean error %",
      String(Number.isFinite(completionModal.meanErr) ? completionModal.meanErr.toFixed(4) : ""),
    ]);
    rows.push(["Stars", String(completionModal.stars || 0)]);
    if (completionModal.sonification) {
      rows.push(["Audio scale factor", String(completionModal.sonification.scaleFactor)]);
    }
    rows.push([]);
    rows.push([
      "True freq (GHz)",
      "Molecule",
      "Fitted freq (GHz)",
      "Error (%)",
      "Amplitude",
      "Center (GHz)",
      "Sigma",
      "Audible Hz",
    ]);
    const audible = (completionModal.sonification && completionModal.sonification.audibleHz) || [];
    completionModal.lineErrors.forEach((le, idx) => {
      const mol = le.line.knownLine
        ? le.line.transition
          ? le.line.label + " " + le.line.transition
          : le.line.label || ""
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
        audible[idx] != null ? audible[idx].toFixed(2) : "",
      ]);
    });
    const csv = rows
      .map((r) =>
        r
          .map((c) => (/\s|,|"/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c))
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "spectrum_fit_level_" + completionModal.levelId + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleNextLevel() {
    stopAllAudio();
    setCompletionModal(null);
    setShowWhyScale(false);
    setPlayerName("");
    setLeaderboardMsg("");
    setAudioStatus("");
    setLevelIndex((prev) => {
      const nextIdx = prev + 1;
      return nextIdx < LEVELS.length ? nextIdx : prev;
    });
  }

  function handleExitGame() {
    stopAllAudio();
    setCompletionModal(null);
    setShowWhyScale(false);
    setPlayerName("");
    setLeaderboardMsg("");
    setAudioStatus("");
    setScreen("exit");
  }

  async function playLineAtIndex(idx) {
    if (!completionModal || !completionModal.sonification) return;
    const hz = completionModal.sonification.audibleHz[idx];
    stopAllAudio();
    const ok = await playTone(hz, 1.2, muted);
    setAudioStatus(
      ok
        ? "Playing tone…"
        : "Click Play again if you hear nothing — browsers block audio until a click."
    );
  }

  async function playAllLines() {
    if (!completionModal || !completionModal.sonification) return;
    const ok = await playChord(completionModal.sonification.audibleHz, 1.8, muted);
    setAudioStatus(
      ok
        ? "Playing all lines…"
        : "Click Play again if you hear nothing — browsers block audio until a click."
    );
  }

  const currentLevel = LEVELS[levelIndex];
  const knownFacts =
    completionModal && completionModal.lineErrors
      ? completionModal.lineErrors
          .filter((le) => le.line.knownLine && le.line.label && MOLECULE_FACTS[le.line.label])
          .map((le) => ({ label: le.line.label, fact: MOLECULE_FACTS[le.line.label] }))
          .filter((item, i, arr) => arr.findIndex((x) => x.label === item.label) === i)
      : [];
  const hasUnknownLines =
    completionModal &&
    completionModal.lineErrors &&
    completionModal.lineErrors.some((le) => !le.line.knownLine);

  return React.createElement(
    "div",
    { className: "app-shell kiosk" },
    React.createElement(
      "header",
      { className: "app-header" },
      React.createElement("div", { className: "title" }, "Spectrum Fitter"),
      React.createElement(
        "div",
        { className: "header-right" },
        screen === "play" &&
          React.createElement(
            "div",
            { className: "level-select" },
            LEVELS.map((lvl, idx) =>
              React.createElement(
                "button",
                {
                  key: lvl.id,
                  type: "button",
                  className:
                    "level-button " +
                    (idx === levelIndex ? "active" : "") +
                    (passedLevels.has(lvl.id) ? " completed" : ""),
                  onClick: () => {
                    stopAllAudio();
                    setCompletionModal(null);
                    setLevelIndex(idx);
                  },
                },
                "L",
                lvl.id,
                passedLevels.has(lvl.id) ? " ✓" : ""
              )
            )
          ),
        React.createElement(
          "label",
          { className: "volume-control" },
          React.createElement("span", null, "Vol"),
          React.createElement("input", {
            type: "range",
            min: 0,
            max: 100,
            value: Math.round(volume * 100),
            className: "volume-slider",
            disabled: muted,
            onChange: (e) => setVolume(parseInt(e.target.value, 10) / 100),
            "aria-label": "Volume",
          })
        ),
        React.createElement(
          "button",
          {
            type: "button",
            className: "secondary-button mute-button",
            onClick: () => setMuted((m) => !m),
            "aria-pressed": muted,
          },
          muted ? "Unmute" : "Mute"
        ),
        screen === "play" &&
          React.createElement(
            "button",
            {
              type: "button",
              className: "secondary-button",
              onClick: () => {
                stopAllAudio();
                setCompletionModal(null);
                setScreen("attract");
              },
            },
            "Home"
          )
      )
    ),
    screen === "attract" &&
      React.createElement(AttractScreen, {
        onStart: handleStart,
        board: leaderboard,
        onResetLeaderboard: handleResetLeaderboard,
      }),
    screen === "exit" &&
      React.createElement(
        "main",
        null,
        React.createElement(
          "div",
          { className: "panel exit-panel" },
          React.createElement("div", { className: "panel-title" }, "Thanks for playing!"),
          React.createElement(
            "p",
            { className: "exit-copy" },
            "Come back anytime — or press Home / Start to play again."
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "primary-button large-button",
              onClick: () => setScreen("attract"),
            },
            "Back to start"
          )
        )
      ),
    screen === "play" &&
      React.createElement(
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
          React.createElement("div", { className: "panel-title" }, "Congratulations!"),
          React.createElement(
            "p",
            { className: "modal-lead" },
            "You passed Level ",
            completionModal.levelId,
            " — ",
            completionModal.levelName || ""
          ),
          React.createElement(
            "div",
            { className: "modal-score-row" },
            React.createElement(StarsDisplay, { stars: completionModal.stars }),
            React.createElement(
              "span",
              null,
              "Mean error ",
              Number.isFinite(completionModal.meanErr) ? completionModal.meanErr.toFixed(2) : "—",
              "% · MSE ",
              Number.isFinite(completionModal.mse) ? completionModal.mse.toFixed(6) : "—"
            )
          ),
          React.createElement(
            "p",
            { className: "modal-hint" },
            "Replay the level to try for a smaller error and more stars."
          ),
          React.createElement(
            "div",
            { className: "name-save-row" },
            React.createElement(
              "label",
              { className: "name-label" },
              "Your name",
              React.createElement("input", {
                type: "text",
                className: "name-input",
                maxLength: MAX_NAME_LEN,
                placeholder: "Your name",
                value: playerName,
                onChange: (e) => setPlayerName(e.target.value),
              })
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "primary-button",
                onClick: handleSaveToLeaderboard,
              },
              "Save to leaderboard"
            )
          ),
          leaderboardMsg &&
            React.createElement("p", { className: "leaderboard-msg" }, leaderboardMsg),
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
                    React.createElement("th", null, "Audible Hz"),
                    React.createElement("th", { className: "error-cell" }, "Error %"),
                    React.createElement("th", null, "Amplitude"),
                    React.createElement("th", null, "Sigma"),
                    React.createElement("th", null, "Hear")
                  )
                ),
                React.createElement(
                  "tbody",
                  null,
                  completionModal.lineErrors.map((le, idx) => {
                    const audible =
                      completionModal.sonification &&
                      completionModal.sonification.audibleHz &&
                      completionModal.sonification.audibleHz[idx];
                    return React.createElement(
                      "tr",
                      { key: idx },
                      React.createElement("td", null, le.line.center.toFixed(4)),
                      React.createElement(
                        "td",
                        null,
                        le.line.knownLine
                          ? le.line.transition
                            ? le.line.label + " " + le.line.transition
                            : le.line.label || "—"
                          : "Unknown line"
                      ),
                      React.createElement(
                        "td",
                        null,
                        le.matchedGaussian ? le.matchedGaussian.center.toFixed(4) : "—"
                      ),
                      React.createElement(
                        "td",
                        null,
                        audible != null && isFinite(audible) ? audible.toFixed(1) : "—"
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
                        le.matchedGaussian ? le.matchedGaussian.sigma.toFixed(3) : "—"
                      ),
                      React.createElement(
                        "td",
                        null,
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "secondary-button tiny-button",
                            onClick: () => playLineAtIndex(idx),
                            disabled: muted,
                          },
                          "Play"
                        )
                      )
                    );
                  })
                )
              )
            ),
          completionModal.sonification &&
            React.createElement(
              "div",
              { className: "sonify-panel" },
              React.createElement(
                "div",
                { className: "sonify-header" },
                React.createElement("strong", null, "Hear your fit"),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "primary-button",
                    onClick: playAllLines,
                    disabled: muted,
                  },
                  "Play all lines"
                )
              ),
              React.createElement(
                "p",
                { className: "sonify-scale" },
                "Scaled down by ",
                formatScaleFactor(completionModal.sonification.scaleFactor),
                " so radio frequencies become audible tones (lowest line ≈ ",
                AUDIBLE_BASE_HZ,
                " Hz)."
              ),
              audioStatus &&
                React.createElement("p", { className: "audio-status" }, audioStatus),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "linkish-button",
                  onClick: () => setShowWhyScale((v) => !v),
                },
                showWhyScale ? "Hide: Why can’t I hear GHz?" : "Why can’t I hear GHz?"
              ),
              showWhyScale &&
                React.createElement(
                  "div",
                  { className: "why-scale-box" },
                  React.createElement(
                    "p",
                    null,
                    "These spectral lines are radio waves at tens to hundreds of gigahertz — vibrating far too fast for human ears (we hear roughly 20 Hz to 20 kHz)."
                  ),
                  React.createElement(
                    "p",
                    null,
                    "We multiply every fitted frequency by the same huge scale factor so the tones fall into the hearing range while keeping the relative spacing between lines. That way a chord of several lines still reflects how close those molecules’ frequencies are in the real spectrum."
                  )
                )
            ),
          (knownFacts.length > 0 || hasUnknownLines) &&
            React.createElement(
              "div",
              { className: "fact-cards" },
              React.createElement("div", { className: "panel-title" }, "Molecule facts"),
              knownFacts.map((f) =>
                React.createElement(
                  "div",
                  { key: f.label, className: "fact-card" },
                  React.createElement("strong", null, f.label),
                  React.createElement("p", null, f.fact)
                )
              ),
              hasUnknownLines &&
                React.createElement(
                  "div",
                  { className: "fact-card fact-card-unknown" },
                  React.createElement("strong", null, "Unknown line"),
                  React.createElement(
                    "p",
                    null,
                    "One or more lines in this spectrum are unmarked — keep exploring CDMS and astronomy catalogs to identify them."
                  )
                )
            ),
          React.createElement(CdmsLearnMore),
          React.createElement(
            "div",
            { className: "modal-actions" },
            React.createElement(
              "button",
              { type: "button", className: "secondary-button", onClick: downloadCompletionCSV },
              "Save as CSV"
            ),
            React.createElement(
              "button",
              { type: "button", className: "secondary-button", onClick: handleExitGame },
              "Exit game"
            ),
            React.createElement(
              "button",
              { type: "button", className: "primary-button", onClick: handleNextLevel },
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
