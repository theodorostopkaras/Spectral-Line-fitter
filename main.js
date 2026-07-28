// Spectrum Fitter — public outreach game
// Radio rest frequencies from CDMS, solar Fraunhofer wavelengths from standard line tables.
// Lines are emission or absorption and carry an optical depth, so strong lines saturate.

/**
 * @typedef {{ amplitude: number; center: number; sigma: number; tau: number }} LineParams
 * @typedef {{ amplitude: number; center: number; sigma: number; tau: number; knownLine: boolean; graded?: boolean; role?: "science" | "telluric"; label?: string; transition?: string }} TrueLine
 * @typedef {{ id: number; amplitude: number; center: number; sigma: number; tau: number; role?: "science" | "telluric" }} PlayerComponent
 * @typedef {{ type: "flat"; c0: number } | { type: "poly"; c0: number; c1: number; c2?: number } | { type: "wideGaussian"; amplitude: number; center: number; sigma: number; floor?: number }} ContinuumSpec
 * @typedef {{ id: number; name: string; track: string; mode: "emission" | "absorption"; axis: "GHz" | "nm"; sonify: "stretch" | "ratio"; xMin: number; xMax: number; noiseLevel: number; baseline: number; continuum?: ContinuumSpec; continuumLockPercent?: number; trueLines: TrueLine[]; maxGaussians?: number; errorThresholdPercent: number; starBands?: number[]; allowLogY?: boolean; showSpectrumColors?: boolean; blurb?: string }} LevelConfig
 */

const CDMS_URL = "https://cdms.astro.uni-koeln.de/classic/";
const STORAGE_KEY = "spectrumFitter.leaderboard.v3";
const IDLE_MS = 120000;
const SPEED_OF_LIGHT_M_S = 299792458;
/** Narrow-band outreach stretch: Hz of pitch change per 1 GHz of rest-frequency separation. */
const SONIFY_HZ_PER_GHZ = 180;
const AUDIBLE_MIN_HZ = 180;
const AUDIBLE_MAX_HZ = 1800;
/** Wide-band "ratio" rule: one constant divisor puts the whole window near this pitch. */
const SONIFY_RATIO_CENTER_HZ = 632;
const SONIFY_RATIO_MIN_HZ = 150;
const SONIFY_RATIO_MAX_HZ = 4000;
/** Star bands as fractions of a level's pass threshold, so every level scales the same way. */
const STAR_BAND_FRACTIONS = [0.04, 0.1, 0.22, 0.5, 1.0];
/** Below this optical depth the profile is indistinguishable from a pure Gaussian. */
const TAU_THIN = 1e-3;
const TAU_MIN = 0.02;
const TAU_MAX = 30;
const LOG_Y_FLOOR = 0.01;
const LEADERBOARD_TOP_N = 5;
const MAX_NAME_LEN = 20;
/** Amber stroke for telluric (Earth-atmosphere) components on solar levels. */
const TELLURIC_COLOR = "rgba(251, 146, 60, 0.95)";
/** Default RMSE % of intensity range required to lock the baseline phase. */
const DEFAULT_CONTINUUM_LOCK_PERCENT = 12;

const AXES = {
  GHz: {
    key: "GHz",
    unit: "GHz",
    axisTitle: "Frequency (GHz)",
    centerLabel: "Center (GHz)",
    decimals: 4,
    toHz: (v) => v * 1e9,
  },
  nm: {
    key: "nm",
    unit: "nm",
    axisTitle: "Wavelength (nm)",
    centerLabel: "Center (nm)",
    decimals: 3,
    toHz: (v) => (v > 0 ? SPEED_OF_LIGHT_M_S / (v * 1e-9) : NaN),
  },
};

function axisOf(level) {
  return AXES[(level && level.axis) || "GHz"] || AXES.GHz;
}

function axisByKey(axisKey) {
  return AXES[axisKey || "GHz"] || AXES.GHz;
}

function formatAxisValue(value, axisKey) {
  if (value == null || !isFinite(value)) return "—";
  return value.toFixed(axisByKey(axisKey).decimals);
}

function isAbsorption(mode) {
  return mode === "absorption";
}

// ——— Math ———

function gaussianShape(xi, center, sigma) {
  const d = xi - center;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

/**
 * Line profile with optical thickness: tau(x) = tau * gaussian(x) and the emerging
 * contribution is I_max * (1 - exp(-tau(x))).
 * I_max is derived from the requested peak, so `amplitude` always means peak height (or depth)
 * and `tau` only controls the shape: thin gives a Gaussian, thick gives a flat, saturated top.
 */
function evaluateLineProfile(x, p) {
  const { amplitude, center, sigma } = p;
  const tau = p.tau;
  if (!(sigma > 0)) return x.map(() => 0);
  if (!(tau > TAU_THIN)) {
    return x.map((xi) => amplitude * gaussianShape(xi, center, sigma));
  }
  const imax = amplitude / (1 - Math.exp(-tau));
  return x.map((xi) => imax * (1 - Math.exp(-tau * gaussianShape(xi, center, sigma))));
}

/** Continuum shape for a level (shaped poly / wide Gaussian, or a flat baseline). */
function continuumSpec(level) {
  if (level && level.continuum) return level.continuum;
  return { type: "flat", c0: (level && level.baseline) || 0 };
}

/**
 * Evaluate the continuum along x. Polynomials use a normalised coordinate t in [-1, 1]
 * across the level window, so c1 and c2 stay O(1) and readable on the sliders.
 */
function evaluateContinuum(x, continuum, xMin, xMax) {
  const spec = continuum || { type: "flat", c0: 0 };
  if (spec.type === "wideGaussian") {
    const floor = spec.floor || 0;
    return x.map(
      (xi) => floor + spec.amplitude * gaussianShape(xi, spec.center, spec.sigma)
    );
  }
  if (spec.type === "poly") {
    const mid = (xMin + xMax) / 2;
    const half = (xMax - xMin) / 2 || 1;
    const c0 = spec.c0 || 0;
    const c1 = spec.c1 || 0;
    const c2 = spec.c2 || 0;
    return x.map((xi) => {
      const t = (xi - mid) / half;
      return c0 + c1 * t + c2 * t * t;
    });
  }
  const c0 = spec.c0 != null ? spec.c0 : 0;
  return x.map(() => c0);
}

function isTelluricLine(line) {
  return !!(line && line.role === "telluric");
}

function scienceLinesOf(lines) {
  return (lines || []).filter((l) => !isTelluricLine(l));
}

function telluricLinesOf(lines) {
  return (lines || []).filter(isTelluricLine);
}

/** Levels with a shaped continuum and/or tellurics use the two-step baseline flow. */
function levelNeedsBaselinePhase(level) {
  if (!level) return false;
  const c = continuumSpec(level);
  if (c.type !== "flat") return true;
  return telluricLinesOf(level.trueLines).length > 0;
}

/** Continuum plus (emission) or minus (absorption) every line contribution. */
function composeSpectrum(x, lines, continuum, mode, xMin, xMax) {
  const absorb = isAbsorption(mode);
  const xmin = xMin != null ? xMin : x[0];
  const xmax = xMax != null ? xMax : x[x.length - 1];
  const contSpec =
    typeof continuum === "number" ? { type: "flat", c0: continuum } : continuum;
  const y = evaluateContinuum(x, contSpec, xmin, xmax);
  for (const line of lines) {
    const contribution = evaluateLineProfile(x, line);
    for (let i = 0; i < y.length; i++) y[i] += absorb ? -contribution[i] : contribution[i];
  }
  if (absorb) {
    for (let i = 0; i < y.length; i++) if (y[i] < 0) y[i] = 0;
  }
  return y;
}

/** One component drawn against the continuum, so absorption components dip downwards. */
function componentCurve(x, component, continuum, mode, xMin, xMax) {
  const contSpec =
    typeof continuum === "number" ? { type: "flat", c0: continuum } : continuum;
  const cont = evaluateContinuum(x, contSpec, xMin, xMax);
  const contribution = evaluateLineProfile(x, component);
  return isAbsorption(mode)
    ? contribution.map((v, i) => Math.max(0, cont[i] - v))
    : contribution.map((v, i) => cont[i] + v);
}

/**
 * RMSE of the baseline model (continuum + tellurics) vs the data, ignoring neighbourhoods
 * around science lines so strong peaks do not block locking.
 */
function baselineResidualPercent(spectrum, continuum, telluricComponents, scienceLines, mode, xMin, xMax) {
  const model = composeSpectrum(
    spectrum.x,
    telluricComponents || [],
    continuum,
    mode,
    xMin,
    xMax
  );
  let ymin = Infinity;
  let ymax = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < spectrum.x.length; i++) {
    const xi = spectrum.x[i];
    let nearScience = false;
    for (const line of scienceLines || []) {
      if (Math.abs(xi - line.center) < line.sigma * 3.5) {
        nearScience = true;
        break;
      }
    }
    if (nearScience) continue;
    const v = spectrum.y[i];
    if (v < ymin) ymin = v;
    if (v > ymax) ymax = v;
    const d = v - model[i];
    sum += d * d;
    n++;
  }
  if (n < 8) return NaN;
  const range = ymax - ymin;
  if (!(range > 0)) return NaN;
  return (Math.sqrt(sum / n) / range) * 100;
}

function continuumDefaults(level) {
  const c = continuumSpec(level);
  if (c.type === "poly") {
    return { type: "poly", c0: c.c0 * 0.9, c1: 0, c2: 0 };
  }
  if (c.type === "wideGaussian") {
    return {
      type: "wideGaussian",
      amplitude: c.amplitude * 0.75,
      center: (level.xMin + level.xMax) / 2,
      sigma: c.sigma * 1.4,
      floor: c.floor || 0,
    };
  }
  return { type: "flat", c0: c.c0 };
}

function seedTelluricComponents(level) {
  return telluricLinesOf(level.trueLines).map((line, i) => ({
    id: 1000 + i,
    amplitude: line.amplitude * 0.7,
    center: line.center + (level.xMax - level.xMin) * 0.004 * (i % 2 === 0 ? 1 : -1),
    sigma: line.sigma * 1.2,
    tau: Math.max(TAU_MIN, line.tau * 0.6),
    role: "telluric",
  }));
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

/**
 * Fit quality as % of the data intensity range (RMSE / peak-to-peak × 100).
 * Raw MSE is often tiny even for mediocre fits because intensities are ~O(1–5).
 */
function normalizedFitPercent(yTrue, yPred) {
  const mse = meanSquaredError(yTrue, yPred);
  if (!isFinite(mse)) return NaN;
  let ymin = Infinity;
  let ymax = -Infinity;
  const n = Math.min(yTrue.length, yPred.length);
  for (let i = 0; i < n; i++) {
    const v = yTrue[i];
    if (v < ymin) ymin = v;
    if (v > ymax) ymax = v;
  }
  const range = ymax - ymin;
  if (!(range > 0)) return NaN;
  return (Math.sqrt(mse) / range) * 100;
}

function describeFitQuality(fitPct) {
  if (!isFinite(fitPct)) return { label: "No fit yet", cls: "" };
  if (fitPct < 3) return { label: "Excellent match", cls: "good" };
  if (fitPct < 8) return { label: "Good match", cls: "good" };
  if (fitPct < 15) return { label: "Reasonable match", cls: "ok" };
  return { label: "Poor match", cls: "bad" };
}

function linspace(min, max, n) {
  const arr = new Array(n);
  const step = (max - min) / (n - 1);
  for (let i = 0; i < n; i++) arr[i] = min + step * i;
  return arr;
}

/** Enough samples that the narrowest line in the level is still resolved (~6 per sigma). */
function spectrumPointCount(level) {
  const range = level.xMax - level.xMin;
  let minSigma = Infinity;
  for (const line of level.trueLines) if (line.sigma < minSigma) minSigma = line.sigma;
  if (!isFinite(minSigma) || minSigma <= 0) return 800;
  return Math.max(800, Math.min(3200, Math.ceil(range / (minSigma / 6))));
}

function generateSpectrum(level) {
  const x = linspace(level.xMin, level.xMax, spectrumPointCount(level));
  let y = composeSpectrum(
    x,
    level.trueLines,
    continuumSpec(level),
    level.mode,
    level.xMin,
    level.xMax
  );
  if (level.noiseLevel > 0) {
    const absorb = isAbsorption(level.mode);
    y = y.map((v) => {
      const noisy = v + (Math.random() * 2 - 1) * level.noiseLevel;
      return absorb ? Math.max(0, noisy) : noisy;
    });
  }
  return { x, y, trueLines: level.trueLines.slice() };
}

/** Every drawn spectral line counts toward pass / stars. */
function isGradedLine(line) {
  return line.graded !== false;
}

/**
 * Assign each true line its own player component (one-to-one, closest pairs first).
 * A single broad component must not be allowed to claim several blended lines.
 */
function computeLineErrors(trueLines, playerComponents) {
  const pairs = [];
  trueLines.forEach((line, li) => {
    playerComponents.forEach((component, ci) => {
      pairs.push({ li, ci, dist: Math.abs(component.center - line.center) });
    });
  });
  pairs.sort((a, b) => a.dist - b.dist);
  const matched = new Array(trueLines.length).fill(null);
  const takenLine = new Array(trueLines.length).fill(false);
  const takenComponent = new Array(playerComponents.length).fill(false);
  for (const pair of pairs) {
    if (takenLine[pair.li] || takenComponent[pair.ci]) continue;
    takenLine[pair.li] = true;
    takenComponent[pair.ci] = true;
    matched[pair.li] = playerComponents[pair.ci];
  }
  return trueLines.map((line, li) => {
    const best = matched[li];
    if (!best || line.center === 0) {
      return { line, matchedGaussian: best, percentError: null };
    }
    const percentError = (Math.abs(line.center - best.center) / Math.abs(line.center)) * 100;
    return { line, matchedGaussian: best, percentError };
  });
}

function lineSpeciesLabel(line) {
  if (!line || !line.knownLine) return "Unknown line";
  if (line.transition) return line.label + " " + line.transition;
  return line.label || "—";
}

/** Credit for the weak lines: fitting them is optional, so say what was caught. */
function describeBonusLines(summary) {
  if (!summary || !summary.extraLineCount) return "";
  const caught = summary.bonusErrors || [];
  if (!caught.length) {
    return (
      "This level also draws " +
      summary.extraLineCount +
      (summary.extraLineCount === 1 ? " weaker line" : " weaker lines") +
      " that are not scored. There are enough components for those too — try fitting them as well."
    );
  }
  return (
    "Bonus: you also fitted " +
    caught.length +
    " of the " +
    summary.extraLineCount +
    " unscored lines — " +
    caught.map((le) => lineSpeciesLabel(le.line)).join(", ") +
    "."
  );
}

function meanPercentError(lineErrors) {
  const vals = lineErrors.map((le) => le.percentError).filter((v) => v != null && isFinite(v));
  if (!vals.length) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Star bands scale with the level's pass threshold: a 480 GHz wide scan and a 9 GHz
 * warm-up cannot share one absolute percentage.
 */
function starBandsForLevel(level) {
  if (level && Array.isArray(level.starBands) && level.starBands.length === 5) {
    return level.starBands;
  }
  const threshold = (level && level.errorThresholdPercent) || 5;
  return STAR_BAND_FRACTIONS.map((f) => f * threshold);
}

/**
 * Stars from mean center error % (not raw MSE).
 * Pass still requires every graded line inside the level threshold.
 */
function starsFromMeanError(meanErr, bands) {
  if (!isFinite(meanErr)) return 0;
  const b = Array.isArray(bands) && bands.length === 5 ? bands : [0.05, 0.15, 0.4, 1.5, 5.0];
  if (meanErr <= b[0]) return 5;
  if (meanErr <= b[1]) return 4;
  if (meanErr <= b[2]) return 3;
  if (meanErr <= b[3]) return 2;
  if (meanErr <= b[4]) return 1;
  return 0;
}

function formatScaleFactor(factor) {
  if (!isFinite(factor) || factor <= 0) return "—";
  const exp = Math.floor(Math.log10(factor));
  const mant = factor / Math.pow(10, exp);
  return mant.toFixed(2) + "×10" + toSuperscript(exp);
}

function clampAudibleHz(hz) {
  return Math.min(AUDIBLE_MAX_HZ, Math.max(AUDIBLE_MIN_HZ, hz));
}

/** Round a divisor to the nearest power of ten — "we divided by one billion" is easy to tell. */
function roundDivisor(exact) {
  if (!isFinite(exact) || exact <= 0) return exact;
  return Math.pow(10, Math.round(Math.log10(exact)));
}

/**
 * Map the fitted line positions (GHz or nm) onto audible pitches. Two rules:
 *  - "stretch": narrow bands get an exaggerated SONIFY_HZ_PER_GHZ of pitch per GHz of
 *    separation, otherwise neighbouring lines would sound identical.
 *  - "ratio": wide bands are divided by a single constant, so the notes keep the true
 *    frequency ratios of the lines — a real octave in the spectrum stays an octave by ear.
 * @param {(number|null)[]} axisValues fitted centers, aligned with the graded line list
 * @param {LevelConfig} level
 */
function sonifyAxisValues(axisValues, level) {
  const axisKey = (level && level.axis) || "GHz";
  const axis = axisByKey(axisKey);
  const mode = (level && level.sonify) || "stretch";
  const values = axisValues || [];
  const originalHz = values.map((v) => (v == null || !isFinite(v) ? NaN : axis.toHz(v)));

  if (mode === "ratio") {
    const edgeA = axis.toHz(level.xMin);
    const edgeB = axis.toHz(level.xMax);
    const windowLow = Math.min(edgeA, edgeB);
    const windowHigh = Math.max(edgeA, edgeB);
    const exact = Math.sqrt(windowLow * windowHigh) / SONIFY_RATIO_CENTER_HZ;
    let divisor = roundDivisor(exact);
    if (
      windowLow / divisor < SONIFY_RATIO_MIN_HZ ||
      windowHigh / divisor > SONIFY_RATIO_MAX_HZ
    ) {
      divisor = exact;
    }
    return {
      mode: "ratio",
      unit: axisKey,
      audibleHz: originalHz.map((hz) => (isFinite(hz) ? hz / divisor : NaN)),
      originalHz,
      divisor,
      scaleFactor: divisor,
      windowAudibleHz: [windowLow / divisor, windowHigh / divisor],
    };
  }

  const valid = values.filter((v) => v != null && isFinite(v));
  if (!valid.length) {
    return {
      mode: "stretch",
      unit: axisKey,
      audibleHz: values.map(() => NaN),
      originalHz,
      hzPerGHz: SONIFY_HZ_PER_GHZ,
      basePitchHz: NaN,
      scaleFactor: NaN,
    };
  }
  const minValue = Math.min.apply(null, valid);
  // Mild absolute offset from the band, so higher-GHz levels sit a little higher overall.
  const basePitchHz = clampAudibleHz(220 + (minValue - 70) * 1.2);
  return {
    mode: "stretch",
    unit: axisKey,
    audibleHz: values.map((v) =>
      v == null || !isFinite(v)
        ? NaN
        : clampAudibleHz(basePitchHz + (v - minValue) * SONIFY_HZ_PER_GHZ)
    ),
    originalHz,
    hzPerGHz: SONIFY_HZ_PER_GHZ,
    basePitchHz,
    scaleFactor: axis.toHz(minValue) / basePitchHz,
  };
}

/** One sentence describing which sonification rule produced these notes. */
function describeSonifyRule(sonification) {
  if (!sonification) return "";
  if (sonification.mode === "ratio") {
    return (
      "Every frequency was divided by the same number (" +
      formatScaleFactor(sonification.divisor) +
      "), so the notes keep the true frequency ratios of the lines."
    );
  }
  return (
    "Higher frequency → higher note. The gaps are stretched so nearby lines don't sound the same (about " +
    (sonification.hzPerGHz || SONIFY_HZ_PER_GHZ) +
    " Hz of pitch for every 1 GHz of separation)."
  );
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

/** Radio rest frequencies in GHz, curated from CDMS. */
const CDMS_CATALOG = [
  { value: 72.837948, species: "H2CO", transition: "1(1,0)-1(1,1)" },
  { value: 84.521172, species: "CH3OH", transition: "5(1,4)-4(2,2)" },
  { value: 86.243442, species: "SiO", transition: "J=2-1 v=0" },
  { value: 86.754294, species: "H13CO+", transition: "J=1-0" },
  { value: 87.316898, species: "C2H", transition: "N=1-0 J=3/2-1/2 F=2-1" },
  { value: 88.631847, species: "HCN", transition: "J=1-0" },
  { value: 89.188523, species: "HCO+", transition: "J=1-0" },
  { value: 90.663568, species: "HNC", transition: "J=1-0" },
  { value: 93.173764, species: "N2H+", transition: "J=1-0" },
  { value: 96.412950, species: "C34S", transition: "J=2-1" },
  { value: 96.741375, species: "CH3OH", transition: "2(0)-1(0) A+" },
  { value: 97.980953, species: "CS", transition: "J=2-1" },
  { value: 99.299870, species: "SO", transition: "3(2)-2(1)" },
  { value: 100.076392, species: "HC3N", transition: "J=11-10" },
  { value: 109.782173, species: "C18O", transition: "J=1-0" },
  { value: 110.201354, species: "13CO", transition: "J=1-0" },
  { value: 113.490982, species: "CN", transition: "N=1-0" },
  { value: 115.271202, species: "CO", transition: "J=1-0" },
  { value: 145.602949, species: "H2CO", transition: "2(1,1)-2(1,2)" },
  { value: 218.222192, species: "H2CO", transition: "3(0,3)-2(0,2)" },
  { value: 218.475632, species: "H2CO", transition: "3(2,1)-2(2,0)" },
  { value: 219.560319, species: "C18O", transition: "J=2-1" },
  { value: 220.398684, species: "13CO", transition: "J=2-1" },
  { value: 230.538000, species: "CO", transition: "J=2-1" },
  { value: 241.616183, species: "CH3OH", transition: "5(0,5)-4(0,4)" },
  { value: 244.935557, species: "CS", transition: "J=5-4" },
  { value: 265.886434, species: "HCN", transition: "J=3-2" },
  { value: 267.557619, species: "HCO+", transition: "J=3-2" },
  { value: 271.981142, species: "HNC", transition: "J=3-2" },
  { value: 279.511701, species: "N2H+", transition: "J=3-2" },
  { value: 293.912173, species: "H2CO", transition: "4(1,3)-4(1,4)" },
  { value: 310.019349, species: "CS", transition: "J=6-5" },
  { value: 461.040768, species: "CO", transition: "J=4-3" },
  { value: 492.160651, species: "CI", transition: "3P1-3P0" },
  { value: 531.716350, species: "HCN", transition: "J=6-5" },
  { value: 535.061600, species: "HCO+", transition: "J=6-5" },
  { value: 538.688830, species: "CS", transition: "J=11-10" },
  { value: 548.831005, species: "C18O", transition: "J=5-4" },
  { value: 550.926300, species: "13CO", transition: "J=5-4" },
  { value: 556.936002, species: "H2O", transition: "1(1,0)-1(0,1)" },
  { value: 572.498068, species: "NH3", transition: "1(0)-0(0)" },
  { value: 576.267931, species: "CO", transition: "J=5-4" },
  { value: 587.616000, species: "CS", transition: "J=12-11" },
  { value: 620.304095, species: "HCN", transition: "J=7-6" },
  { value: 624.208000, species: "HCO+", transition: "J=7-6" },
  { value: 691.473076, species: "CO", transition: "J=6-5" },
  { value: 806.651806, species: "CO", transition: "J=7-6" },
  { value: 809.343500, species: "CI", transition: "3P2-3P1" },
  { value: 921.799700, species: "CO", transition: "J=8-7" },
];

/** Solar Fraunhofer lines: air wavelengths in nm with Fraunhofer's original letters. */
const FRAUNHOFER_CATALOG = [
  { value: 382.044, species: "Fe I", transition: "L" },
  { value: 393.366, species: "Ca II", transition: "K" },
  { value: 396.847, species: "Ca II", transition: "H" },
  { value: 410.175, species: "H I", transition: "h (H-delta)" },
  { value: 430.774, species: "Ca I", transition: "G" },
  { value: 430.790, species: "Fe I", transition: "G" },
  { value: 434.047, species: "H I", transition: "G' (H-gamma)" },
  { value: 438.355, species: "Fe I", transition: "e" },
  { value: 466.814, species: "Fe I", transition: "d" },
  { value: 486.134, species: "H I", transition: "F (H-beta)" },
  { value: 495.761, species: "Fe I", transition: "c" },
  { value: 516.733, species: "Mg I", transition: "b4" },
  { value: 516.891, species: "Fe I", transition: "b3" },
  { value: 517.270, species: "Mg I", transition: "b2" },
  { value: 518.362, species: "Mg I", transition: "b1" },
  { value: 527.039, species: "Fe I", transition: "E2" },
  { value: 587.562, species: "He I", transition: "D3" },
  { value: 588.995, species: "Na I", transition: "D2" },
  { value: 589.592, species: "Na I", transition: "D1" },
  { value: 627.661, species: "O2", transition: "a (telluric)" },
  { value: 656.281, species: "H I", transition: "C (H-alpha)" },
  { value: 686.719, species: "O2", transition: "B (telluric)" },
  { value: 759.370, species: "O2", transition: "A (telluric)" },
];

const MOLECULE_FACTS = {
  HCN: "Hydrogen cyanide (HCN) is common in dense molecular clouds and traces warm gas near young stars.",
  "HCO+": "The formyl ion (HCO+) is a key tracer of dense, ionized gas in star-forming regions.",
  "H13CO+": "H¹³CO⁺ is the rare-carbon version of HCO⁺; it stays optically thin where the main line is saturated.",
  HNC: "Hydrogen isocyanide (HNC) has the same atoms as HCN but a different order; the ratio of the two is a cloud thermometer.",
  "N2H+": "Diazenylium (N2H+) survives where CO freezes out, so it maps the coldest, densest cloud cores.",
  CS: "Carbon monosulfide (CS) is a dense-gas tracer found in molecular clouds and protostellar envelopes.",
  C34S: "C³⁴S is a rarer sulfur isotope of CS; comparing isotopes helps measure how opaque a cloud is.",
  SO: "Sulfur monoxide (SO) often brightens in shocked gas, for example where outflows slam into cloud material.",
  SiO: "Silicon monoxide (SiO) is locked into dust grains until a shock smashes them, so it lights up jets and outflows.",
  C2H: "The ethynyl radical (C2H) thrives in gas lit by ultraviolet starlight, at the edges of clouds.",
  HC3N: "Cyanoacetylene (HC3N) is one of the longer carbon chains found in space and marks warm, chemically rich cores.",
  CO: "Carbon monoxide (CO) is the most widely used tracer of molecular gas across the Milky Way and beyond.",
  "13CO": "¹³CO is a less abundant CO isotope; it stays optically thinner and probes denser gas than main-line CO.",
  C18O: "C¹⁸O is even rarer than ¹³CO and is used to weigh the densest parts of molecular clouds.",
  CN: "The cyano radical (CN) is seen in UV-irradiated cloud edges and helps probe chemistry near starlight.",
  H2CO: "Formaldehyde (H₂CO) appears in many environments, from cold clouds to comets and star-forming regions.",
  CH3OH: "Methanol (CH₃OH) is a complex organic molecule linked to ice chemistry on dust grains.",
  H2O: "Water vapour lines are blocked by our own atmosphere, so the 557 GHz line had to be observed from space by Herschel.",
  NH3: "Ammonia (NH₃) was among the first molecules found in space and is still a favourite gas thermometer.",
  CI: "Neutral atomic carbon marks the layer where ultraviolet light has broken CO apart.",
  "Ca II": "Singly ionized calcium produces the H and K lines, the strongest dark features in the violet part of the solar spectrum.",
  "H I": "Hydrogen's Balmer lines (H-alpha, H-beta, ...) come from the most abundant element in the Universe.",
  "Na I": "Sodium's D lines are the same yellow glow as a street lamp — and in the Sun they appear as two dark lines.",
  "Mg I": "Neutral magnesium makes the b triplet in the green; it is a favourite for measuring solar magnetic fields.",
  "Fe I": "Iron alone contributes thousands of lines to the solar spectrum, which is why the Sun's rainbow looks so ragged.",
  "Ca I": "Neutral calcium blends with iron in the G band, one of the features Fraunhofer catalogued in 1814.",
  "He I": "Helium was discovered in the Sun before it was found on Earth — hence the name, from Helios.",
  O2: "This line is not solar at all: oxygen in our own atmosphere absorbs the sunlight on its way to the telescope.",
};

function catalogForAxis(axisKey) {
  return axisKey === "nm" ? FRAUNHOFER_CATALOG : CDMS_CATALOG;
}

function findClosestCatalogLine(value, axisKey) {
  const catalog = catalogForAxis(axisKey);
  if (!catalog.length || value == null || !isFinite(value)) return null;
  let best = catalog[0];
  let bestDist = Math.abs(catalog[0].value - value);
  for (let i = 1; i < catalog.length; i++) {
    const d = Math.abs(catalog[i].value - value);
    if (d < bestDist) {
      bestDist = d;
      best = catalog[i];
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

const TRACKS = [
  { key: "radio", label: "Radio", source: "cdms" },
  { key: "solar", label: "Solar", source: "fraunhofer" },
];

/** @type {LevelConfig[]} */
const LEVELS = [
  {
    id: 1,
    name: "Level 1 – Warm-up",
    track: "radio",
    mode: "emission",
    axis: "GHz",
    sonify: "stretch",
    blurb: "Two dense-gas tracers, overlapping just enough to matter. Start here.",
    xMin: 86,
    xMax: 95,
    noiseLevel: 0.08,
    baseline: 0.3,
    errorThresholdPercent: 0.3,
    trueLines: [
      { amplitude: 3.2, center: 88.631847, sigma: 0.19, tau: 0.5, knownLine: true, label: "HCN", transition: "J=1-0" },
      { amplitude: 2.9, center: 89.188523, sigma: 0.2, tau: 0.35, knownLine: true, label: "HCO+", transition: "J=1-0" },
    ],
  },
  {
    id: 2,
    name: "Level 2 – Blended",
    track: "radio",
    mode: "emission",
    axis: "GHz",
    sonify: "stretch",
    blurb:
      "Six species in nine gigahertz. One unidentified line hides in the shoulder of C34S — find it too; every line on the plot counts.",
    xMin: 93,
    xMax: 102,
    noiseLevel: 0.2,
    baseline: 0.5,
    errorThresholdPercent: 0.5,
    trueLines: [
      { amplitude: 1.6, center: 93.173764, sigma: 0.35, tau: 0.3, knownLine: true, label: "N2H+", transition: "J=1-0" },
      { amplitude: 2.4, center: 96.412950, sigma: 0.28, tau: 0.5, knownLine: true, label: "C34S", transition: "J=2-1" },
      { amplitude: 1.2, center: 96.741375, sigma: 0.26, tau: 0.3, knownLine: false },
      { amplitude: 3.0, center: 97.980953, sigma: 0.32, tau: 1.6, knownLine: true, label: "CS", transition: "J=2-1" },
      { amplitude: 2.6, center: 99.299870, sigma: 0.24, tau: 0.8, knownLine: true, label: "SO", transition: "3(2)-2(1)" },
      { amplitude: 0.9, center: 100.076392, sigma: 0.22, tau: 0.25, knownLine: true, label: "HC3N", transition: "J=11-10" },
    ],
  },
  {
    id: 3,
    name: "Level 3 – Crowded",
    track: "radio",
    mode: "emission",
    axis: "GHz",
    sonify: "stretch",
    blurb: "A pair of formaldehyde lines less than a linewidth apart, and CO saturated flat on top.",
    xMin: 217,
    xMax: 235,
    noiseLevel: 0.32,
    baseline: 0.65,
    errorThresholdPercent: 0.25,
    trueLines: [
      { amplitude: 2.5, center: 218.222192, sigma: 0.28, tau: 0.8, knownLine: true, label: "H2CO", transition: "3(0,3)-2(0,2)" },
      { amplitude: 2.7, center: 218.475632, sigma: 0.28, tau: 0.8, knownLine: false },
      { amplitude: 2.2, center: 219.560319, sigma: 0.26, tau: 0.5, knownLine: true, label: "C18O", transition: "J=2-1" },
      { amplitude: 2.6, center: 220.398684, sigma: 0.26, tau: 1.2, knownLine: true, label: "13CO", transition: "J=2-1" },
      { amplitude: 4.0, center: 230.538000, sigma: 0.5, tau: 4.0, knownLine: true, label: "CO", transition: "J=2-1" },
    ],
  },
  {
    id: 4,
    name: "Level 4 – 3 mm band",
    track: "radio",
    mode: "emission",
    axis: "GHz",
    sonify: "stretch",
    blurb: "The classic CO isotope trio, plus a mystery line and a saturated main CO line.",
    xMin: 108,
    xMax: 117,
    noiseLevel: 0.24,
    baseline: 0.55,
    errorThresholdPercent: 0.25,
    trueLines: [
      { amplitude: 2.4, center: 109.782173, sigma: 0.13, tau: 0.4, knownLine: true, label: "C18O", transition: "J=1-0" },
      { amplitude: 3.0, center: 110.201354, sigma: 0.13, tau: 1.0, knownLine: true, label: "13CO", transition: "J=1-0" },
      { amplitude: 2.0, center: 113.490982, sigma: 0.22, tau: 0.5, knownLine: false },
      { amplitude: 4.2, center: 115.271202, sigma: 0.25, tau: 4.5, knownLine: true, label: "CO", transition: "J=1-0" },
    ],
  },
  {
    id: 5,
    name: "Level 5 – Submm blend",
    track: "radio",
    mode: "emission",
    axis: "GHz",
    sonify: "stretch",
    blurb: "One of these bumps is an unidentified U-line — real surveys are full of them.",
    xMin: 228,
    xMax: 246,
    noiseLevel: 0.36,
    baseline: 0.7,
    errorThresholdPercent: 0.3,
    trueLines: [
      { amplitude: 3.6, center: 230.538000, sigma: 0.5, tau: 3.0, knownLine: true, label: "CO", transition: "J=2-1" },
      { amplitude: 1.4, center: 241.616183, sigma: 0.4, tau: 0.3, knownLine: false },
      { amplitude: 0.9, center: 244.55, sigma: 0.38, tau: 0.2, knownLine: false },
      { amplitude: 2.4, center: 244.935557, sigma: 0.42, tau: 1.0, knownLine: true, label: "CS", transition: "J=5-4" },
    ],
  },
  {
    id: 6,
    name: "Level 6 – Dense tracers",
    track: "radio",
    mode: "emission",
    axis: "GHz",
    sonify: "stretch",
    blurb: "HCN and HCO+ at J=3-2, both optically thick, plus HNC and one unknown.",
    xMin: 263,
    xMax: 282,
    noiseLevel: 0.4,
    baseline: 0.75,
    errorThresholdPercent: 0.25,
    trueLines: [
      { amplitude: 3.2, center: 265.886434, sigma: 0.35, tau: 2.5, knownLine: true, label: "HCN", transition: "J=3-2" },
      { amplitude: 2.8, center: 267.557619, sigma: 0.32, tau: 1.5, knownLine: true, label: "HCO+", transition: "J=3-2" },
      { amplitude: 1.6, center: 271.981142, sigma: 0.32, tau: 0.5, knownLine: true, label: "HNC", transition: "J=3-2" },
      { amplitude: 2.1, center: 279.511701, sigma: 0.35, tau: 0.6, knownLine: false },
    ],
  },
  {
    id: 7,
    name: "Level 7 – Wide 3 mm scan",
    track: "radio",
    mode: "emission",
    axis: "GHz",
    sonify: "ratio",
    blurb:
      "Sixteen lines across 32 GHz, from CO twenty times brighter than the weakest feature. Every line counts — use the log button to stretch the faint forest.",
    xMin: 84,
    xMax: 116,
    noiseLevel: 0.05,
    baseline: 0.12,
    errorThresholdPercent: 0.2,
    allowLogY: true,
    trueLines: [
      { amplitude: 0.25, center: 86.243442, sigma: 0.11, tau: 0.2, knownLine: true, label: "SiO", transition: "J=2-1 v=0" },
      { amplitude: 0.18, center: 86.754294, sigma: 0.1, tau: 0.2, knownLine: true, label: "H13CO+", transition: "J=1-0" },
      { amplitude: 0.55, center: 87.316898, sigma: 0.12, tau: 0.3, knownLine: true, label: "C2H", transition: "N=1-0" },
      { amplitude: 2.6, center: 88.631847, sigma: 0.12, tau: 2.0, knownLine: true, label: "HCN", transition: "J=1-0" },
      { amplitude: 2.2, center: 89.188523, sigma: 0.11, tau: 1.5, knownLine: true, label: "HCO+", transition: "J=1-0" },
      { amplitude: 0.9, center: 90.663568, sigma: 0.11, tau: 0.5, knownLine: true, label: "HNC", transition: "J=1-0" },
      { amplitude: 1.1, center: 93.173764, sigma: 0.12, tau: 0.6, knownLine: true, label: "N2H+", transition: "J=1-0" },
      { amplitude: 0.35, center: 96.412950, sigma: 0.1, tau: 0.3, knownLine: true, label: "C34S", transition: "J=2-1" },
      { amplitude: 0.3, center: 96.741375, sigma: 0.11, tau: 0.2, knownLine: true, label: "CH3OH", transition: "2(0)-1(0) A+" },
      { amplitude: 1.5, center: 97.980953, sigma: 0.12, tau: 1.0, knownLine: true, label: "CS", transition: "J=2-1" },
      { amplitude: 0.65, center: 99.299870, sigma: 0.11, tau: 0.4, knownLine: true, label: "SO", transition: "3(2)-2(1)" },
      { amplitude: 0.22, center: 100.076392, sigma: 0.1, tau: 0.2, knownLine: true, label: "HC3N", transition: "J=11-10" },
      { amplitude: 0.8, center: 109.782173, sigma: 0.1, tau: 0.4, knownLine: true, label: "C18O", transition: "J=1-0" },
      { amplitude: 2.0, center: 110.201354, sigma: 0.11, tau: 1.2, knownLine: true, label: "13CO", transition: "J=1-0" },
      { amplitude: 0.7, center: 113.490982, sigma: 0.13, tau: 0.5, knownLine: false },
      { amplitude: 4.0, center: 115.271202, sigma: 0.13, tau: 5.0, knownLine: true, label: "CO", transition: "J=1-0" },
    ],
  },
  {
    id: 8,
    name: "Level 8 – HEXOS Band 1a",
    track: "radio",
    mode: "emission",
    axis: "GHz",
    sonify: "ratio",
    blurb:
      "A small cut of Herschel/HIFI Band 1a toward Orion KL — the HEXOS survey. Real spectra here have thousands of lines; this vignette keeps seven strong ones, and every line on the plot counts toward your score. Use the log button to stretch the weaker features.",
    xMin: 480,
    xMax: 560,
    noiseLevel: 0.05,
    baseline: 0.45,
    errorThresholdPercent: 0.25,
    allowLogY: true,
    trueLines: [
      { amplitude: 1.8, center: 492.160651, sigma: 0.55, tau: 1.2, knownLine: true, label: "CI", transition: "3P1-3P0" },
      { amplitude: 1.1, center: 531.716350, sigma: 0.45, tau: 0.8, knownLine: true, label: "HCN", transition: "J=6-5" },
      { amplitude: 1.3, center: 535.061600, sigma: 0.42, tau: 1.0, knownLine: true, label: "HCO+", transition: "J=6-5" },
      { amplitude: 0.7, center: 538.688830, sigma: 0.4, tau: 0.5, knownLine: true, label: "CS", transition: "J=11-10" },
      { amplitude: 1.0, center: 548.831005, sigma: 0.38, tau: 0.6, knownLine: true, label: "C18O", transition: "J=5-4" },
      { amplitude: 2.2, center: 550.926300, sigma: 0.4, tau: 1.5, knownLine: true, label: "13CO", transition: "J=5-4" },
      { amplitude: 3.2, center: 556.936002, sigma: 0.55, tau: 2.5, knownLine: true, label: "H2O", transition: "1(1,0)-1(0,1)" },
    ],
  },
  {
    id: 9,
    name: "Level 9 – Radio absorption",
    track: "radio",
    mode: "absorption",
    axis: "GHz",
    sonify: "stretch",
    blurb:
      "Same 86–95 GHz window as Level 1, but in absorption against a bright continuum. HCN and HCO+ return, now joined by C2H, HNC and a saturated N2H+ core, plus faint SiO and H13CO+ on the side.",
    xMin: 86,
    xMax: 95,
    noiseLevel: 0.05,
    baseline: 3.2,
    errorThresholdPercent: 0.3,
    trueLines: [
      { amplitude: 0.6, center: 86.243442, sigma: 0.2, tau: 0.4, knownLine: true, label: "SiO", transition: "J=2-1 v=0" },
      { amplitude: 0.4, center: 86.754294, sigma: 0.18, tau: 0.3, knownLine: true, label: "H13CO+", transition: "J=1-0" },
      { amplitude: 1.0, center: 87.316898, sigma: 0.2, tau: 0.6, knownLine: true, label: "C2H", transition: "N=1-0" },
      { amplitude: 2.0, center: 88.631847, sigma: 0.15, tau: 1.8, knownLine: true, label: "HCN", transition: "J=1-0" },
      { amplitude: 1.8, center: 89.188523, sigma: 0.14, tau: 1.5, knownLine: true, label: "HCO+", transition: "J=1-0" },
      { amplitude: 1.2, center: 90.663568, sigma: 0.18, tau: 1.0, knownLine: true, label: "HNC", transition: "J=1-0" },
      { amplitude: 2.9, center: 93.173764, sigma: 0.3, tau: 8.0, knownLine: true, label: "N2H+", transition: "J=1-0" },
    ],
  },
  {
    id: 10,
    name: "Level 10 – Solar spectrum",
    track: "solar",
    mode: "absorption",
    axis: "nm",
    sonify: "ratio",
    blurb:
      "Fraunhofer's own spectrum on a gently sloping continuum. First lock the continuum and the amber atmospheric O₂ lines (telluric — made by Earth's air, not the Sun), then fit the solar lines. Two blended features split apart in Levels 11 and 12.",
    xMin: 380,
    xMax: 700,
    noiseLevel: 0.012,
    baseline: 1.0,
    continuum: { type: "poly", c0: 1.02, c1: -0.12, c2: -0.06 },
    continuumLockPercent: 14,
    errorThresholdPercent: 0.25,
    showSpectrumColors: true,
    trueLines: [
      { amplitude: 0.8, center: 393.366, sigma: 0.65, tau: 8, knownLine: true, label: "Ca II", transition: "K" },
      { amplitude: 0.75, center: 396.847, sigma: 0.62, tau: 7, knownLine: true, label: "Ca II", transition: "H" },
      { amplitude: 0.45, center: 410.175, sigma: 0.7, tau: 2.5, knownLine: true, label: "H I", transition: "h (H-delta)" },
      { amplitude: 0.35, center: 430.78, sigma: 0.8, tau: 2, knownLine: true, label: "Fe I", transition: "G band (with Ca I)" },
      { amplitude: 0.48, center: 434.047, sigma: 0.75, tau: 2.5, knownLine: true, label: "H I", transition: "G' (H-gamma)" },
      { amplitude: 0.22, center: 438.355, sigma: 0.6, tau: 1, knownLine: true, label: "Fe I", transition: "e" },
      { amplitude: 0.52, center: 486.134, sigma: 0.8, tau: 3, knownLine: true, label: "H I", transition: "F (H-beta)" },
      { amplitude: 0.2, center: 495.761, sigma: 0.6, tau: 1, knownLine: true, label: "Fe I", transition: "c" },
      { amplitude: 0.55, center: 517.3, sigma: 1.1, tau: 4, knownLine: true, label: "Mg I", transition: "b triplet (blend)" },
      { amplitude: 0.26, center: 527.039, sigma: 0.7, tau: 1.2, knownLine: true, label: "Fe I", transition: "E2" },
      { amplitude: 0.05, center: 587.562, sigma: 0.45, tau: 0.4, knownLine: true, label: "He I", transition: "D3" },
      { amplitude: 0.7, center: 589.29, sigma: 0.8, tau: 6, knownLine: true, label: "Na I", transition: "D doublet (blend)" },
      { amplitude: 0.16, center: 627.661, sigma: 0.6, tau: 0.8, knownLine: true, role: "telluric", label: "O2", transition: "a (telluric)" },
      { amplitude: 0.55, center: 656.281, sigma: 0.8, tau: 3, knownLine: true, label: "H I", transition: "C (H-alpha)" },
      { amplitude: 0.28, center: 686.719, sigma: 0.7, tau: 1.5, knownLine: true, role: "telluric", label: "O2", transition: "B (telluric)" },
    ],
  },
  {
    id: 11,
    name: "Level 11 – Magnesium close-up",
    track: "solar",
    mode: "absorption",
    axis: "nm",
    sonify: "ratio",
    blurb:
      "Four nanometres of the green, where the single dark 'Mg b' feature of Level 10 turns out to be three magnesium lines with an iron line wedged against the first one.",
    xMin: 515.5,
    xMax: 519.5,
    noiseLevel: 0.008,
    baseline: 1.0,
    errorThresholdPercent: 0.015,
    showSpectrumColors: true,
    trueLines: [
      { amplitude: 0.6, center: 516.733, sigma: 0.042, tau: 3, knownLine: true, label: "Mg I", transition: "b4" },
      { amplitude: 0.24, center: 516.891, sigma: 0.038, tau: 1.5, knownLine: true, label: "Fe I", transition: "b3" },
      { amplitude: 0.55, center: 517.27, sigma: 0.045, tau: 2.5, knownLine: true, label: "Mg I", transition: "b2" },
      { amplitude: 0.62, center: 518.362, sigma: 0.048, tau: 3, knownLine: true, label: "Mg I", transition: "b1" },
    ],
  },
  {
    id: 12,
    name: "Level 12 – Sodium close-up",
    track: "solar",
    mode: "absorption",
    axis: "nm",
    sonify: "ratio",
    blurb:
      "Five nanometres of the yellow: the famous sodium D line is a doublet, and both cores are so opaque that their bottoms are flat. The faint neighbour is helium, the element found in the Sun before it was found on Earth.",
    xMin: 586.5,
    xMax: 591.5,
    noiseLevel: 0.008,
    baseline: 1.0,
    errorThresholdPercent: 0.02,
    showSpectrumColors: true,
    trueLines: [
      { amplitude: 0.09, center: 587.562, sigma: 0.05, tau: 0.5, knownLine: true, label: "He I", transition: "D3" },
      { amplitude: 0.78, center: 588.995, sigma: 0.07, tau: 6, knownLine: true, label: "Na I", transition: "D2" },
      { amplitude: 0.7, center: 589.592, sigma: 0.065, tau: 5, knownLine: true, label: "Na I", transition: "D1" },
    ],
  },
  {
    id: 13,
    name: "Level 13 – Continuum first",
    track: "radio",
    mode: "emission",
    axis: "GHz",
    sonify: "ratio",
    blurb:
      "A rising dust continuum under a handful of 3 mm lines — like a cut of a HEXOS-style scan. Lock the continuum first (Phase 1), then fit the molecular lines on what remains. The residual view helps once the baseline is locked.",
    xMin: 88,
    xMax: 116,
    noiseLevel: 0.05,
    baseline: 0.6,
    continuum: { type: "poly", c0: 0.85, c1: 0.5, c2: 0.15 },
    continuumLockPercent: 11,
    errorThresholdPercent: 0.25,
    allowLogY: true,
    trueLines: [
      { amplitude: 2.4, center: 88.631847, sigma: 0.14, tau: 1.8, knownLine: true, label: "HCN", transition: "J=1-0" },
      { amplitude: 2.0, center: 89.188523, sigma: 0.13, tau: 1.4, knownLine: true, label: "HCO+", transition: "J=1-0" },
      { amplitude: 1.1, center: 93.173764, sigma: 0.14, tau: 0.7, knownLine: true, label: "N2H+", transition: "J=1-0" },
      { amplitude: 1.4, center: 97.980953, sigma: 0.14, tau: 1.0, knownLine: true, label: "CS", transition: "J=2-1" },
      { amplitude: 0.9, center: 109.782173, sigma: 0.12, tau: 0.5, knownLine: true, label: "C18O", transition: "J=1-0" },
      { amplitude: 2.2, center: 110.201354, sigma: 0.13, tau: 1.3, knownLine: true, label: "13CO", transition: "J=1-0" },
      { amplitude: 3.6, center: 115.271202, sigma: 0.16, tau: 4.0, knownLine: true, label: "CO", transition: "J=1-0" },
    ],
  },
];

function levelById(id) {
  return LEVELS.find((lvl) => lvl.id === id) || null;
}

/**
 * Every science line that is drawn can be fitted, plus two spare components.
 * Tellurics are handled in the baseline phase and do not consume this budget.
 */
function maxComponentsForLevel(level) {
  if (level && Number.isFinite(level.maxGaussians)) return level.maxGaussians;
  const lines = scienceLinesOf(level && level.trueLines).length || 1;
  return lines + 2;
}

/** Slider ranges follow the level, so a 0.1-deep Fraunhofer line and a 4 K CO peak both work. */
function sliderRanges(level) {
  const lines = scienceLinesOf(level.trueLines);
  const amplitudes = (lines.length ? lines : level.trueLines).map((l) => l.amplitude);
  const sigmas = (lines.length ? lines : level.trueLines).map((l) => l.sigma);
  const range = level.xMax - level.xMin;
  const amplitudeMax = Math.max.apply(null, amplitudes) * 1.3;
  const sigmaMin = Math.max(0.005, Math.min.apply(null, sigmas) / 4);
  const sigmaMax = Math.max.apply(null, sigmas) * 3;
  return {
    amplitudeMin: Math.max(0.01, amplitudeMax / 200),
    amplitudeMax,
    amplitudeStep: amplitudeMax / 200,
    sigmaMin,
    sigmaMax,
    sigmaStep: (sigmaMax - sigmaMin) / 200,
    centerStep: range / 500,
    centerFineStep: range / 50000,
  };
}

/** Neutral starting values for a new component: never the answer, just a sensible guess. */
function componentDefaults(level) {
  const lines = scienceLinesOf(level.trueLines);
  const amplitudes = lines.map((l) => l.amplitude).sort((a, b) => a - b);
  const sigmas = lines.map((l) => l.sigma).sort((a, b) => a - b);
  const mid = (arr) => arr[Math.floor(arr.length / 2)];
  return {
    amplitude: mid(amplitudes) || 1,
    sigma: mid(sigmas) || 0.3,
    tau: 0.5,
  };
}

function describeTau(tau) {
  if (!(tau > TAU_THIN)) return "thin (Gaussian)";
  if (tau < 0.3) return "optically thin";
  if (tau < 1.5) return "moderate";
  if (tau < 6) return "optically thick";
  return "saturated";
}

function tauToSlider(tau) {
  const clamped = Math.min(TAU_MAX, Math.max(TAU_MIN, tau || TAU_MIN));
  return (1000 * Math.log(clamped / TAU_MIN)) / Math.log(TAU_MAX / TAU_MIN);
}

function sliderToTau(sliderValue) {
  return TAU_MIN * Math.pow(TAU_MAX / TAU_MIN, sliderValue / 1000);
}

/** Rough visible-light colour for a wavelength in nm, used for the solar plot backdrop. */
function wavelengthToRgb(nm) {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm >= 380 && nm < 440) {
    r = (440 - nm) / 60;
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / 50;
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = (510 - nm) / 20;
  } else if (nm < 580) {
    r = (nm - 510) / 70;
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = (645 - nm) / 65;
  } else if (nm <= 780) {
    r = 1;
  } else {
    r = 0.35;
  }
  if (nm < 380) {
    r = 0.25;
    b = 0.6;
  }
  const to255 = (v) => Math.round(255 * Math.min(1, Math.max(0, v)));
  return [to255(r), to255(g), to255(b)];
}

// ——— Shared UI bits ———

function CdmsLearnMore(props) {
  const solar = props && props.solar;
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
        solar
          ? "The solar wavelengths are the classic Fraunhofer lines from standard line tables; the radio levels use rest frequencies from the Cologne Database for Molecular Spectroscopy (CDMS)."
          : "Line frequencies come from the Cologne Database for Molecular Spectroscopy (CDMS)."
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
    { className: "stars", "aria-label": n + " of 5 stars" },
    [1, 2, 3, 4, 5].map((i) =>
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
      " scores per level on this device (lower mean error is better). Each level has its own",
      " precision target, so wide scans are not compared against the warm-up."
    ),
    TRACKS.map((track) =>
      React.createElement(
        "div",
        { key: track.key, className: "leaderboard-track" },
        React.createElement(
          "div",
          { className: "leaderboard-track-title" },
          track.label,
          track.key === "solar" ? " — Fraunhofer absorption lines" : " — CDMS emission and absorption"
        ),
        React.createElement(
          "div",
          { className: "leaderboard-levels" },
          LEVELS.filter((lvl) => lvl.track === track.key).map((lvl) => {
            const list = Array.isArray(board[String(lvl.id)]) ? board[String(lvl.id)] : [];
            const bands = starBandsForLevel(lvl);
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
                        React.createElement(StarsDisplay, {
                          stars:
                            entry.stars != null
                              ? entry.stars
                              : starsFromMeanError(entry.meanErr, bands),
                        }),
                        React.createElement(
                          "span",
                          { className: "lb-stats" },
                          isFinite(entry.meanErr) ? entry.meanErr.toFixed(3) : "—",
                          "% mean err",
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
      )
    )
  );
}

/** "Level 8 – HEXOS Band 1a" → "HEXOS Band 1a". */
function levelShortName(level) {
  const dash = level.name.indexOf("–");
  return dash >= 0 ? level.name.slice(dash + 1).trim() : level.name;
}

function levelBandLabel(level) {
  const axis = axisOf(level);
  return level.xMin + "–" + level.xMax + " " + axis.unit;
}

/** Every level is playable from the start — visitors pick what they like the look of. */
function LevelPicker(props) {
  const board = props.board || {};
  return React.createElement(
    "div",
    { className: "panel level-picker" },
    React.createElement("div", { className: "panel-title" }, "Choose a level"),
    React.createElement(
      "p",
      { className: "level-picker-intro" },
      "Nothing is locked — start anywhere, in any order, and switch levels at any time from the buttons in the header."
    ),
    TRACKS.map((track) =>
      React.createElement(
        "div",
        { key: track.key, className: "picker-track" },
        React.createElement(
          "div",
          { className: "picker-track-title" },
          track.label,
          track.key === "radio"
            ? " — molecular emission lines (CDMS)"
            : " — solar Fraunhofer absorption lines"
        ),
        React.createElement(
          "div",
          { className: "picker-grid" },
          LEVELS.filter((lvl) => lvl.track === track.key).map((lvl) => {
            const idx = LEVELS.indexOf(lvl);
            const best = (board[String(lvl.id)] || [])[0];
            const scored = lvl.trueLines.filter(isGradedLine).length;
            return React.createElement(
              "button",
              {
                key: lvl.id,
                type: "button",
                className: "level-card" + (best ? " level-card-played" : ""),
                onClick: () => props.onPlay(idx),
              },
              React.createElement(
                "span",
                { className: "level-card-head" },
                React.createElement("span", { className: "level-card-id" }, "L" + lvl.id),
                React.createElement("span", { className: "level-card-name" }, levelShortName(lvl)),
                React.createElement(
                  "span",
                  { className: "mode-pill " + (lvl.mode === "absorption" ? "absorption" : "emission") },
                  lvl.mode === "absorption" ? "Absorption" : "Emission"
                )
              ),
              React.createElement(
                "span",
                { className: "level-card-meta" },
                levelBandLabel(lvl),
                " · ",
                scored,
                scored === 1 ? " line to fit" : " lines to fit"
              ),
              best
                ? React.createElement(
                    "span",
                    { className: "level-card-best" },
                    React.createElement(StarsDisplay, {
                      stars:
                        best.stars != null
                          ? best.stars
                          : starsFromMeanError(best.meanErr, starBandsForLevel(lvl)),
                    }),
                    " best: ",
                    best.name,
                    isFinite(best.meanErr) ? " (" + best.meanErr.toFixed(3) + "%)" : ""
                  )
                : React.createElement(
                    "span",
                    { className: "level-card-best level-card-unplayed" },
                    "Not played yet"
                  )
            );
          })
        )
      )
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
        React.createElement("li", null, "Add one component for each spectral line you can see."),
        React.createElement(
          "li",
          null,
          "On continuum levels: first fit and lock the baseline (and amber atmospheric lines on the solar spectrum), then fit the science lines."
        ),
        React.createElement(
          "li",
          null,
          "Tune peak, position, width and optical depth until the green model matches the blue data."
        ),
        React.createElement(
          "li",
          null,
          "Radio levels show bright emission lines; the solar levels show dark Fraunhofer absorption lines."
        ),
        React.createElement("li", null, "Submit your fit — pass when every line on the plot is close enough."),
        React.createElement("li", null, "Then hear your fitted lines as audible tones.")
      ),
      React.createElement(
        "div",
        { className: "attract-actions" },
        React.createElement(
          "button",
          { type: "button", className: "primary-button large-button", onClick: props.onStart },
          "Start with Level 1"
        ),
        React.createElement(
          "span",
          { className: "attract-actions-hint" },
          "…or pick any level below."
        )
      )
    ),
    React.createElement(LevelPicker, { board: props.board, onPlay: props.onPlayLevel }),
    React.createElement(LeaderboardPanel, { board: props.board, onReset: props.onResetLeaderboard }),
    React.createElement(CdmsLearnMore, { solar: true })
  );
}

// ——— Game view ———

/** Faint rainbow behind the solar plots, so visitors see where in the spectrum a line sits. */
const spectrumBackdropPlugin = {
  id: "spectrumBackdrop",
  beforeDatasetsDraw(chart) {
    const area = chart.chartArea;
    const xScale = chart.scales.x;
    if (!area || !xScale) return;
    const ctx = chart.ctx;
    const gradient = ctx.createLinearGradient(area.left, 0, area.right, 0);
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const rgb = wavelengthToRgb(xScale.min + t * (xScale.max - xScale.min));
      gradient.addColorStop(t, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.16)");
    }
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
    ctx.restore();
  },
};

const COMPONENT_COLORS = [
  "rgba(248, 113, 113, 0.9)",
  "rgba(251, 191, 36, 0.9)",
  "rgba(129, 230, 217, 0.9)",
  "rgba(196, 181, 253, 0.9)",
  "rgba(244, 114, 182, 0.9)",
  "rgba(147, 197, 253, 0.9)",
  "rgba(253, 186, 116, 0.9)",
  "rgba(167, 243, 208, 0.9)",
  "rgba(216, 180, 254, 0.9)",
  "rgba(252, 165, 165, 0.9)",
  "rgba(134, 239, 172, 0.9)",
  "rgba(253, 224, 71, 0.9)",
  "rgba(125, 211, 252, 0.9)",
  "rgba(240, 171, 252, 0.9)",
  "rgba(254, 215, 170, 0.9)",
  "rgba(153, 246, 228, 0.9)",
  "rgba(191, 219, 254, 0.9)",
  "rgba(254, 205, 211, 0.9)",
  "rgba(221, 214, 254, 0.9)",
  "rgba(187, 247, 208, 0.9)",
];

function SpectrumGameView(props) {
  const { level, onCompletion } = props;
  const axis = axisOf(level);
  const absorb = isAbsorption(level.mode);
  const needsBaseline = levelNeedsBaselinePhase(level);
  const trueContinuum = continuumSpec(level);
  const scienceTruth = React.useMemo(
    () => scienceLinesOf(level.trueLines),
    [level.trueLines]
  );
  const telluricTruth = React.useMemo(
    () => telluricLinesOf(level.trueLines),
    [level.trueLines]
  );
  const ranges = React.useMemo(() => sliderRanges(level), [level]);
  const defaults = React.useMemo(() => componentDefaults(level), [level]);
  const [spectrum] = React.useState(() => generateSpectrum(level));
  const [continuumFit, setContinuumFit] = React.useState(() => continuumDefaults(level));
  const [telluricComponents, setTelluricComponents] = React.useState(() =>
    seedTelluricComponents(level)
  );
  const [components, setComponents] = React.useState(() =>
    needsBaseline
      ? []
      : [
          {
            id: 1,
            amplitude: defaults.amplitude,
            center: spectrum.x[Math.floor(spectrum.x.length / 2)],
            sigma: defaults.sigma,
            tau: defaults.tau,
            role: "science",
          },
        ]
  );
  const [selectedId, setSelectedId] = React.useState(needsBaseline ? null : 1);
  const [selectedTelluricId, setSelectedTelluricId] = React.useState(
    () => (telluricComponents[0] && telluricComponents[0].id) || null
  );
  const [phase, setPhase] = React.useState(needsBaseline ? "baseline" : "lines");
  const [baselineLocked, setBaselineLocked] = React.useState(!needsBaseline);
  const [showResidual, setShowResidual] = React.useState(false);
  const [logY, setLogY] = React.useState(false);
  const [chartCanvas, setChartCanvas] = React.useState(null);
  const chartRef = React.useRef(null);
  const chartSignatureRef = React.useRef("");
  const clickHandlerRef = React.useRef(() => {});
  const [mse, setMse] = React.useState(NaN);
  const [fitPct, setFitPct] = React.useState(NaN);
  const [completed, setCompleted] = React.useState(false);
  const [completionSummary, setCompletionSummary] = React.useState(null);

  const gradedScience = React.useMemo(
    () => scienceTruth.filter(isGradedLine),
    [scienceTruth]
  );
  const gradedTellurics = React.useMemo(
    () => telluricTruth.filter(isGradedLine),
    [telluricTruth]
  );
  const coarseX = React.useMemo(() => linspace(level.xMin, level.xMax, 500), [level]);
  const maxComponents = maxComponentsForLevel(level);
  const lockThreshold =
    level.continuumLockPercent != null
      ? level.continuumLockPercent
      : DEFAULT_CONTINUUM_LOCK_PERCENT;

  const lockedOrLiveContinuum = continuumFit;

  const baselineModelY = React.useMemo(
    () =>
      composeSpectrum(
        spectrum.x,
        telluricComponents,
        lockedOrLiveContinuum,
        level.mode,
        level.xMin,
        level.xMax
      ),
    [spectrum.x, telluricComponents, lockedOrLiveContinuum, level.mode, level.xMin, level.xMax]
  );

  const modelY = React.useMemo(() => {
    if (needsBaseline && phase === "baseline" && !baselineLocked) {
      return baselineModelY;
    }
    return composeSpectrum(
      spectrum.x,
      telluricComponents.concat(components),
      lockedOrLiveContinuum,
      level.mode,
      level.xMin,
      level.xMax
    );
  }, [
    needsBaseline,
    phase,
    baselineLocked,
    baselineModelY,
    spectrum.x,
    telluricComponents,
    components,
    lockedOrLiveContinuum,
    level.mode,
    level.xMin,
    level.xMax,
  ]);

  const baselineFitPct = React.useMemo(
    () =>
      baselineResidualPercent(
        spectrum,
        lockedOrLiveContinuum,
        telluricComponents,
        scienceTruth,
        level.mode,
        level.xMin,
        level.xMax
      ),
    [
      spectrum,
      lockedOrLiveContinuum,
      telluricComponents,
      scienceTruth,
      level.mode,
      level.xMin,
      level.xMax,
    ]
  );

  const canLockBaseline =
    needsBaseline &&
    !baselineLocked &&
    isFinite(baselineFitPct) &&
    baselineFitPct <= lockThreshold;

  React.useEffect(() => {
    setMse(meanSquaredError(spectrum.y, modelY));
    setFitPct(normalizedFitPercent(spectrum.y, modelY));
  }, [modelY, spectrum.y]);

  function buildDatasets() {
    const clip = (v) => (logY ? Math.max(LOG_Y_FLOOR, v) : v);
    const toPoints = (xs, ys) => xs.map((xi, i) => ({ x: xi, y: clip(ys[i]) }));
    const nearAtmosphere = (xi) => {
      for (const line of telluricTruth) {
        if (Math.abs(xi - line.center) <= line.sigma * 4) return true;
      }
      return false;
    };
    const contOnly = evaluateContinuum(
      spectrum.x,
      lockedOrLiveContinuum,
      level.xMin,
      level.xMax
    );
    let observedY = spectrum.y;
    let observedLabel = absorb ? "Observed spectrum (absorption)" : "Observed spectrum";
    if (showResidual && baselineLocked) {
      observedY = spectrum.y.map((v, i) => {
        const r = absorb ? contOnly[i] - v : v - contOnly[i];
        return Math.max(0, r);
      });
      observedLabel = "Residual (continuum subtracted)";
    }
    // Split the observed trace so telluric (Earth-atmosphere) dips read amber in the
    // main spectrum, not only as separate fit components.
    const hasTellurics = telluricTruth.length > 0;
    const scienceObs = hasTellurics
      ? spectrum.x.map((xi, i) => ({
          x: xi,
          y: nearAtmosphere(xi) ? NaN : clip(observedY[i]),
        }))
      : toPoints(spectrum.x, observedY);
    const datasets = [
      {
        label: hasTellurics ? observedLabel + " (solar)" : observedLabel,
        data: scienceObs,
        borderColor: "rgba(96, 165, 250, 1)",
        borderWidth: 1.5,
        pointRadius: 0,
        spanGaps: false,
      },
    ];
    if (hasTellurics) {
      datasets.push({
        label: "Atmosphere in data (telluric)",
        data: spectrum.x.map((xi, i) => ({
          x: xi,
          y: nearAtmosphere(xi) ? clip(observedY[i]) : NaN,
        })),
        borderColor: TELLURIC_COLOR,
        borderWidth: 2.4,
        pointRadius: 0,
        spanGaps: false,
      });
    }
    datasets.push({
      label:
        phase === "baseline" && !baselineLocked ? "Baseline model" : "Model fit",
      data: toPoints(
        spectrum.x,
        showResidual && baselineLocked
          ? modelY.map((v, i) => {
              const r = absorb ? contOnly[i] - v : v - contOnly[i];
              return Math.max(0, r);
            })
          : modelY
      ),
      borderColor: "rgba(52, 211, 153, 1)",
      borderWidth: 1.8,
      pointRadius: 0,
    });
    if (needsBaseline && !(showResidual && baselineLocked)) {
      datasets.push({
        label: "Continuum",
        data: toPoints(coarseX, evaluateContinuum(coarseX, lockedOrLiveContinuum, level.xMin, level.xMax)),
        borderColor: "rgba(148, 163, 184, 0.85)",
        borderWidth: 1.2,
        borderDash: [2, 4],
        pointRadius: 0,
      });
    }
    telluricComponents.forEach((component, idx) => {
      datasets.push({
        label: "Atmosphere fit " + (idx + 1),
        data: toPoints(
          coarseX,
          componentCurve(coarseX, component, lockedOrLiveContinuum, level.mode, level.xMin, level.xMax)
        ),
        borderColor: TELLURIC_COLOR,
        borderWidth: component.id === selectedTelluricId ? 2.2 : 1.4,
        borderDash: [6, 3],
        pointRadius: 0,
      });
    });
    if (phase === "lines" || baselineLocked || !needsBaseline) {
      components.forEach((component, idx) => {
        datasets.push({
          label: "Component " + (idx + 1),
          data: toPoints(
            coarseX,
            componentCurve(
              coarseX,
              component,
              lockedOrLiveContinuum,
              level.mode,
              level.xMin,
              level.xMax
            )
          ),
          borderColor: COMPONENT_COLORS[idx % COMPONENT_COLORS.length],
          borderWidth: component.id === selectedId ? 2 : 1,
          borderDash: [4, 3],
          pointRadius: 0,
        });
      });
    }
    return datasets;
  }

  React.useEffect(() => {
    clickHandlerRef.current = (evt) => {
      const chart = chartRef.current;
      if (!chart || !chart.scales || !chart.scales.x) return;
      const value = chart.scales.x.getValueForPixel(evt.x);
      if (value == null || !isFinite(value)) return;
      const clamped = Math.min(level.xMax, Math.max(level.xMin, value));
      if (phase === "baseline" && !baselineLocked && selectedTelluricId != null) {
        setTelluricComponents((prev) =>
          prev.map((c) => (c.id === selectedTelluricId ? { ...c, center: clamped } : c))
        );
        return;
      }
      if ((phase === "lines" || !needsBaseline) && selectedId != null) {
        handleUpdateComponent(selectedId, "center", clamped);
      }
    };
  });

  React.useEffect(() => {
    if (!chartCanvas || typeof Chart !== "function") return;
    const signature =
      level.id +
      "|" +
      (logY ? "log" : "lin") +
      "|" +
      (showResidual ? "res" : "raw") +
      "|" +
      phase;
    if (chartRef.current && chartSignatureRef.current !== signature) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    if (!chartRef.current) {
      const ctx = chartCanvas.getContext("2d");
      if (!ctx) return;
      chartRef.current = new Chart(ctx, {
        type: "line",
        data: { datasets: buildDatasets() },
        plugins: level.showSpectrumColors ? [spectrumBackdropPlugin] : [],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          normalized: true,
          parsing: false,
          onClick: (evt) => clickHandlerRef.current(evt),
          plugins: {
            legend: { labels: { color: "#e5e5ff", boxWidth: 12, font: { size: 10 } } },
            tooltip: { enabled: false },
          },
          scales: {
            x: {
              type: "linear",
              min: level.xMin,
              max: level.xMax,
              ticks: { color: "#a5b4fc", maxTicksLimit: 8 },
              title: { display: true, text: axis.axisTitle, color: "#e5e5ff" },
            },
            y: {
              type: logY ? "logarithmic" : "linear",
              beginAtZero: !logY,
              ticks: { color: "#a5b4fc" },
              title: {
                display: true,
                text: showResidual && baselineLocked
                  ? "Residual intensity"
                  : absorb
                    ? "Intensity (against continuum)"
                    : "Intensity",
                color: "#e5e5ff",
              },
            },
          },
        },
      });
      chartSignatureRef.current = signature;
      chartCanvas.style.cursor = "crosshair";
    } else {
      chartRef.current.data.datasets = buildDatasets();
      chartRef.current.update("none");
    }
  }, [
    chartCanvas,
    level,
    logY,
    spectrum,
    modelY,
    components,
    telluricComponents,
    selectedId,
    selectedTelluricId,
    continuumFit,
    phase,
    baselineLocked,
    showResidual,
  ]);

  React.useEffect(
    () => () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    },
    []
  );

  /**
   * The strongest feature the current model does not explain yet, so each new component
   * lands on the next real line instead of on empty sky or on top of the previous one.
   */
  function unexplainedFeature(current) {
    const model = composeSpectrum(
      spectrum.x,
      telluricComponents.concat(current),
      lockedOrLiveContinuum,
      level.mode,
      level.xMin,
      level.xMax
    );
    let bestIdx = -1;
    let bestGap = 0;
    for (let i = 0; i < spectrum.x.length; i++) {
      const gap = absorb ? model[i] - spectrum.y[i] : spectrum.y[i] - model[i];
      if (gap > bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestGap < level.noiseLevel * 2) return null;
    return {
      center: spectrum.x[bestIdx],
      amplitude: Math.min(ranges.amplitudeMax, Math.max(ranges.amplitudeMin, bestGap)),
    };
  }

  function handleAddComponent() {
    if (needsBaseline && !baselineLocked) return;
    setComponents((prev) => {
      if (prev.length >= maxComponents) return prev;
      const nextId = prev.length ? Math.max.apply(null, prev.map((c) => c.id)) + 1 : 1;
      const feature = unexplainedFeature(prev);
      const fraction = (prev.length + 1) / (prev.length + 2);
      const next = {
        id: nextId,
        amplitude: feature ? feature.amplitude : defaults.amplitude,
        center: feature
          ? feature.center
          : level.xMin + fraction * (level.xMax - level.xMin),
        sigma: defaults.sigma,
        tau: defaults.tau,
        role: "science",
      };
      setSelectedId(nextId);
      return prev.concat([next]);
    });
  }

  function handleRemoveComponent(id) {
    setComponents((prev) => {
      if (prev.length <= 1 && !needsBaseline) return prev;
      const next = prev.filter((c) => c.id !== id);
      if (id === selectedId && next.length) setSelectedId(next[0].id);
      else if (!next.length) setSelectedId(null);
      return next;
    });
  }

  function handleUpdateComponent(id, field, value) {
    setComponents((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }

  function handleUpdateTelluric(id, field, value) {
    if (baselineLocked) return;
    setTelluricComponents((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  }

  function handleNudgeCenter(id, delta) {
    setComponents((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, center: Math.min(level.xMax, Math.max(level.xMin, c.center + delta)) }
          : c
      )
    );
  }

  function handleNudgeTelluric(id, delta) {
    if (baselineLocked) return;
    setTelluricComponents((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, center: Math.min(level.xMax, Math.max(level.xMin, c.center + delta)) }
          : c
      )
    );
  }

  function handleLockBaseline() {
    if (!canLockBaseline) return;
    setBaselineLocked(true);
    setPhase("lines");
    setShowResidual(true);
    if (!components.length) {
      const mid = spectrum.x[Math.floor(spectrum.x.length / 2)];
      setComponents([
        {
          id: 1,
          amplitude: defaults.amplitude,
          center: mid,
          sigma: defaults.sigma,
          tau: defaults.tau,
          role: "science",
        },
      ]);
      setSelectedId(1);
    }
  }

  function handleUnlockBaseline() {
    setBaselineLocked(false);
    setPhase("baseline");
    setShowResidual(false);
    setCompleted(false);
    setCompletionSummary(null);
  }

  function handleReset() {
    setContinuumFit(continuumDefaults(level));
    setTelluricComponents(seedTelluricComponents(level));
    setBaselineLocked(!needsBaseline);
    setPhase(needsBaseline ? "baseline" : "lines");
    setShowResidual(false);
    setComponents(
      needsBaseline
        ? []
        : [
            {
              id: 1,
              amplitude: defaults.amplitude,
              center: spectrum.x[Math.floor(spectrum.x.length / 2)],
              sigma: defaults.sigma,
              tau: defaults.tau,
              role: "science",
            },
          ]
    );
    setSelectedId(needsBaseline ? null : 1);
    setSelectedTelluricId(
      (seedTelluricComponents(level)[0] && seedTelluricComponents(level)[0].id) || null
    );
    setCompleted(false);
    setCompletionSummary(null);
  }

  function handleSubmit() {
    if (needsBaseline && !baselineLocked) return;
    const lineErrors = computeLineErrors(gradedScience, components);
    const allScienceWithin = lineErrors.every(
      (le) => le.percentError != null && le.percentError <= level.errorThresholdPercent
    );
    const telluricErrors = computeLineErrors(gradedTellurics, telluricComponents);
    const allTelluricWithin =
      !gradedTellurics.length ||
      telluricErrors.every(
        (le) => le.percentError != null && le.percentError <= level.errorThresholdPercent
      );
    const claimed = new Set(lineErrors.map((le) => le.matchedGaussian && le.matchedGaussian.id));
    const spare = components.filter((c) => !claimed.has(c.id));
    const extraLines = scienceTruth.filter((line) => !isGradedLine(line));
    const bonusErrors = computeLineErrors(extraLines, spare).filter(
      (le) => le.percentError != null && le.percentError <= level.errorThresholdPercent
    );
    const meanErr = meanPercentError(lineErrors.concat(telluricErrors));
    const stars = starsFromMeanError(meanErr, starBandsForLevel(level));
    const fittedCenters = lineErrors.map((le) =>
      le.matchedGaussian ? le.matchedGaussian.center : null
    );
    const sonification = sonifyAxisValues(fittedCenters, level);
    const passed = allScienceWithin && allTelluricWithin && (!needsBaseline || baselineLocked);
    const summary = {
      levelId: level.id,
      levelName: level.name,
      axis: level.axis || "GHz",
      mode: level.mode || "emission",
      track: level.track,
      lineErrors: lineErrors.concat(telluricErrors),
      bonusErrors,
      extraLineCount: extraLines.length,
      mse,
      fitPct,
      meanErr,
      stars,
      sonification,
      passed,
      baselineLocked: !needsBaseline || baselineLocked,
    };
    setCompletionSummary(summary);
    setCompleted(passed);
    if (passed) onCompletion(summary);
  }

  const fitQuality = describeFitQuality(fitPct);
  const amplitudeLabel = absorb ? "Peak depth" : "Peak height";

  return React.createElement(
    "div",
    { className: "game-layout" },
    React.createElement(
      "div",
      { className: "panel" },
      React.createElement(
        "div",
        { className: "plot-header" },
        React.createElement("div", { className: "panel-title" }, level.name),
        React.createElement(
          "div",
          { className: "plot-header-right" },
          React.createElement(
            "span",
            { className: "mode-pill " + (absorb ? "absorption" : "emission") },
            absorb ? "Absorption" : "Emission"
          ),
          needsBaseline &&
            React.createElement(
              "span",
              {
                className:
                  "mode-pill " + (baselineLocked ? "emission" : "absorption"),
              },
              baselineLocked ? "Phase 2 · Lines" : "Phase 1 · Baseline"
            ),
          baselineLocked &&
            React.createElement(
              "button",
              {
                type: "button",
                className: "secondary-button tiny-button",
                onClick: () => setShowResidual((v) => !v),
                "aria-pressed": showResidual,
              },
              showResidual ? "Show raw spectrum" : "Show residual"
            ),
          level.allowLogY &&
            React.createElement(
              "button",
              {
                type: "button",
                className: "secondary-button tiny-button",
                onClick: () => setLogY((v) => !v),
                "aria-pressed": logY,
              },
              logY ? "Linear scale" : "Stretch weak lines (log)"
            )
        )
      ),
      level.blurb && React.createElement("p", { className: "level-blurb" }, level.blurb),
      React.createElement(
        "div",
        { className: "plot-wrap" },
        React.createElement("canvas", { ref: setChartCanvas, className: "plot-canvas" })
      ),
      React.createElement(
        "div",
        { className: "fit-quality " + fitQuality.cls },
        "Fit quality: ",
        fitQuality.label,
        " (spectrum mismatch ≈ ",
        Number.isFinite(fitPct) ? fitPct.toFixed(1) : "—",
        "% of intensity range)",
        needsBaseline && !baselineLocked
          ? " · Baseline residual ≈ " +
            (Number.isFinite(baselineFitPct) ? baselineFitPct.toFixed(1) : "—") +
            "% (lock at ≤ " +
            lockThreshold +
            "%)"
          : ""
      ),
      React.createElement(
        "div",
        { className: "plot-hint" },
        needsBaseline && !baselineLocked
          ? "Phase 1: fit the continuum and the amber atmospheric dips in the spectrum" +
            (telluricComponents.length ? " (Earth's air, not the Sun)" : "") +
            ", then Lock baseline. Science lines stay locked until then."
          : telluricTruth.length
            ? "Amber stretches in the spectrum are telluric (atmosphere). Fit those in Phase 1; blue stretches are solar. Click the plot to place the selected component."
            : "Click the plot to move the selected component there. Every drawn science line can be fitted — weak ones may not decide the pass."
      ),
      completed &&
        React.createElement(
          "div",
          { className: "completion-banner" },
          "Level completed! Every line fitted within ",
          level.errorThresholdPercent,
          "% in ",
          axis.key === "nm" ? "wavelength" : "center frequency",
          "."
        )
    ),
    React.createElement(
      "div",
      { className: "controls-column" },
      React.createElement(
        "div",
        { className: "panel fit-panel" + (needsBaseline ? " fit-panel-phased" : "") },
        needsBaseline &&
          React.createElement(
            "div",
            { className: "fit-tabs", role: "tablist", "aria-label": "Fitting steps" },
            React.createElement(
              "button",
              {
                type: "button",
                role: "tab",
                className: "fit-tab" + (phase === "baseline" ? " active" : ""),
                "aria-selected": phase === "baseline",
                onClick: () => setPhase("baseline"),
              },
              "1 · Baseline",
              baselineLocked ? " ✓" : ""
            ),
            React.createElement(
              "button",
              {
                type: "button",
                role: "tab",
                className: "fit-tab" + (phase === "lines" ? " active" : ""),
                "aria-selected": phase === "lines",
                disabled: !baselineLocked,
                title: baselineLocked
                  ? "Fit the science lines"
                  : "Lock the baseline first",
                onClick: () => {
                  if (baselineLocked) setPhase("lines");
                },
              },
              "2 · Science lines"
            )
          ),
        needsBaseline &&
          phase === "baseline" &&
          React.createElement(
            "div",
            { className: "fit-subpage", role: "tabpanel" },
          React.createElement(
            "div",
            { className: "controls-header" },
            React.createElement(
              "span",
              { className: "panel-title" },
              baselineLocked ? "Baseline (locked)" : "Fit continuum & atmosphere"
            ),
            React.createElement(
              "div",
              { className: "controls-header-right" },
              !baselineLocked &&
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "primary-button",
                    onClick: handleLockBaseline,
                    disabled: !canLockBaseline,
                    title: !canLockBaseline
                      ? "Baseline residual still above " + lockThreshold + "%"
                      : "Lock continuum and atmosphere",
                  },
                  "Lock baseline"
                ),
              baselineLocked &&
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "secondary-button tiny-button",
                    onClick: handleUnlockBaseline,
                  },
                  "Unlock"
                )
            )
          ),
          continuumFit.type === "poly" &&
            React.createElement(
              "div",
              { className: "continuum-controls" },
              React.createElement(
                "div",
                { className: "slider-group" },
                React.createElement(
                  "div",
                  { className: "slider-label" },
                  React.createElement("span", null, "Continuum level c₀"),
                  React.createElement(
                    "span",
                    { className: "value" },
                    continuumFit.c0.toFixed(3)
                  )
                ),
                React.createElement("input", {
                  type: "range",
                  min: 0,
                  max: Math.max(2.5, trueContinuum.c0 * 1.8),
                  step: 0.01,
                  value: continuumFit.c0,
                  className: "slider-input",
                  disabled: baselineLocked,
                  onChange: (e) =>
                    setContinuumFit((prev) => ({
                      ...prev,
                      c0: parseFloat(e.target.value),
                    })),
                })
              ),
              React.createElement(
                "div",
                { className: "slider-group" },
                React.createElement(
                  "div",
                  { className: "slider-label" },
                  React.createElement("span", null, "Slope c₁"),
                  React.createElement(
                    "span",
                    { className: "value" },
                    continuumFit.c1.toFixed(3)
                  )
                ),
                React.createElement("input", {
                  type: "range",
                  min: -1.5,
                  max: 1.5,
                  step: 0.01,
                  value: continuumFit.c1,
                  className: "slider-input",
                  disabled: baselineLocked,
                  onChange: (e) =>
                    setContinuumFit((prev) => ({
                      ...prev,
                      c1: parseFloat(e.target.value),
                    })),
                })
              ),
              React.createElement(
                "div",
                { className: "slider-group" },
                React.createElement(
                  "div",
                  { className: "slider-label" },
                  React.createElement("span", null, "Curvature c₂"),
                  React.createElement(
                    "span",
                    { className: "value" },
                    (continuumFit.c2 || 0).toFixed(3)
                  )
                ),
                React.createElement("input", {
                  type: "range",
                  min: -1,
                  max: 1,
                  step: 0.01,
                  value: continuumFit.c2 || 0,
                  className: "slider-input",
                  disabled: baselineLocked,
                  onChange: (e) =>
                    setContinuumFit((prev) => ({
                      ...prev,
                      c2: parseFloat(e.target.value),
                    })),
                })
              )
            ),
          continuumFit.type === "wideGaussian" &&
            React.createElement(
              "div",
              { className: "continuum-controls" },
              React.createElement(
                "div",
                { className: "slider-group" },
                React.createElement(
                  "div",
                  { className: "slider-label" },
                  React.createElement("span", null, "Wide continuum amplitude"),
                  React.createElement(
                    "span",
                    { className: "value" },
                    continuumFit.amplitude.toFixed(2)
                  )
                ),
                React.createElement("input", {
                  type: "range",
                  min: 0,
                  max: Math.max(4, continuumFit.amplitude * 2),
                  step: 0.02,
                  value: continuumFit.amplitude,
                  className: "slider-input",
                  disabled: baselineLocked,
                  onChange: (e) =>
                    setContinuumFit((prev) => ({
                      ...prev,
                      amplitude: parseFloat(e.target.value),
                    })),
                })
              ),
              React.createElement(
                "div",
                { className: "slider-group" },
                React.createElement(
                  "div",
                  { className: "slider-label" },
                  React.createElement("span", null, "Wide continuum center"),
                  React.createElement(
                    "span",
                    { className: "value" },
                    formatAxisValue(continuumFit.center, axis.key)
                  )
                ),
                React.createElement("input", {
                  type: "range",
                  min: level.xMin,
                  max: level.xMax,
                  step: ranges.centerStep,
                  value: continuumFit.center,
                  className: "slider-input",
                  disabled: baselineLocked,
                  onChange: (e) =>
                    setContinuumFit((prev) => ({
                      ...prev,
                      center: parseFloat(e.target.value),
                    })),
                })
              ),
              React.createElement(
                "div",
                { className: "slider-group" },
                React.createElement(
                  "div",
                  { className: "slider-label" },
                  React.createElement("span", null, "Wide continuum sigma"),
                  React.createElement(
                    "span",
                    { className: "value" },
                    continuumFit.sigma.toFixed(2)
                  )
                ),
                React.createElement("input", {
                  type: "range",
                  min: (level.xMax - level.xMin) / 20,
                  max: (level.xMax - level.xMin) * 2,
                  step: (level.xMax - level.xMin) / 200,
                  value: continuumFit.sigma,
                  className: "slider-input",
                  disabled: baselineLocked,
                  onChange: (e) =>
                    setContinuumFit((prev) => ({
                      ...prev,
                      sigma: parseFloat(e.target.value),
                    })),
                })
              )
            ),
          continuumFit.type === "flat" &&
            React.createElement(
              "div",
              { className: "continuum-controls" },
              React.createElement(
                "div",
                { className: "slider-group" },
                React.createElement(
                  "div",
                  { className: "slider-label" },
                  React.createElement("span", null, "Continuum level"),
                  React.createElement(
                    "span",
                    { className: "value" },
                    continuumFit.c0.toFixed(3)
                  )
                ),
                React.createElement("input", {
                  type: "range",
                  min: 0,
                  max: Math.max(2.5, continuumFit.c0 * 2),
                  step: 0.01,
                  value: continuumFit.c0,
                  className: "slider-input",
                  disabled: baselineLocked,
                  onChange: (e) =>
                    setContinuumFit((prev) => ({
                      ...prev,
                      c0: parseFloat(e.target.value),
                    })),
                })
              )
            ),
          telluricComponents.length > 0 &&
            React.createElement(
              "div",
              { className: "telluric-block" },
              React.createElement(
                "div",
                { className: "telluric-legend" },
                React.createElement("span", {
                  className: "component-swatch",
                  style: { background: TELLURIC_COLOR },
                }),
                "Atmosphere (telluric) — amber in the spectrum; subtract before the solar lines"
              ),
              telluricComponents.map((component, idx) =>
                React.createElement(
                  "div",
                  {
                    key: component.id,
                    className:
                      "gaussian-row telluric-row" +
                      (component.id === selectedTelluricId ? " gaussian-row-selected" : ""),
                    onClick: () => {
                      if (!baselineLocked) setSelectedTelluricId(component.id);
                    },
                  },
                  React.createElement(
                    "div",
                    { className: "gaussian-row-header" },
                    React.createElement(
                      "span",
                      null,
                      React.createElement("span", {
                        className: "component-swatch",
                        style: { background: TELLURIC_COLOR },
                      }),
                      "Atmosphere ",
                      idx + 1,
                      telluricTruth[idx]
                        ? " · " + lineSpeciesLabel(telluricTruth[idx])
                        : ""
                    )
                  ),
                  React.createElement(
                    "div",
                    { className: "slider-group" },
                    React.createElement(
                      "div",
                      { className: "slider-label" },
                      React.createElement("span", null, "Depth"),
                      React.createElement(
                        "span",
                        { className: "value" },
                        component.amplitude.toFixed(2)
                      )
                    ),
                    React.createElement("input", {
                      type: "range",
                      min: ranges.amplitudeMin,
                      max: ranges.amplitudeMax,
                      step: ranges.amplitudeStep,
                      value: component.amplitude,
                      className: "slider-input",
                      disabled: baselineLocked,
                      onChange: (e) =>
                        handleUpdateTelluric(
                          component.id,
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
                      React.createElement("span", null, axis.centerLabel),
                      React.createElement(
                        "span",
                        { className: "value" },
                        formatAxisValue(component.center, axis.key)
                      )
                    ),
                    React.createElement("input", {
                      type: "range",
                      min: level.xMin,
                      max: level.xMax,
                      step: ranges.centerStep,
                      value: component.center,
                      className: "slider-input",
                      disabled: baselineLocked,
                      onChange: (e) =>
                        handleUpdateTelluric(
                          component.id,
                          "center",
                          parseFloat(e.target.value)
                        ),
                    }),
                    React.createElement(
                      "div",
                      { className: "fine-row" },
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "secondary-button tiny-button",
                          disabled: baselineLocked,
                          onClick: () =>
                            handleNudgeTelluric(component.id, -ranges.centerFineStep),
                        },
                        "−"
                      ),
                      React.createElement("input", {
                        type: "number",
                        className: "fine-input",
                        min: level.xMin,
                        max: level.xMax,
                        step: ranges.centerFineStep,
                        value: component.center,
                        disabled: baselineLocked,
                        onChange: (e) => {
                          const v = parseFloat(e.target.value);
                          if (isFinite(v)) handleUpdateTelluric(component.id, "center", v);
                        },
                      }),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "secondary-button tiny-button",
                          disabled: baselineLocked,
                          onClick: () =>
                            handleNudgeTelluric(component.id, ranges.centerFineStep),
                        },
                        "+"
                      ),
                      React.createElement("span", { className: "fine-unit" }, axis.unit)
                    )
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
                        component.sigma.toFixed(3)
                      )
                    ),
                    React.createElement("input", {
                      type: "range",
                      min: ranges.sigmaMin,
                      max: ranges.sigmaMax,
                      step: ranges.sigmaStep,
                      value: component.sigma,
                      className: "slider-input",
                      disabled: baselineLocked,
                      onChange: (e) =>
                        handleUpdateTelluric(
                          component.id,
                          "sigma",
                          parseFloat(e.target.value)
                        ),
                    })
                  )
                )
              )
            )
        ),
        (!needsBaseline || phase === "lines") &&
          React.createElement(
            "div",
            {
              className: needsBaseline ? "fit-subpage" : "fit-subpage fit-subpage-solo",
              role: needsBaseline ? "tabpanel" : undefined,
            },
            React.createElement(
              "div",
              { className: "controls-header" },
              React.createElement(
                "span",
                { className: "panel-title" },
                needsBaseline ? "Fit science lines" : "Line components"
              ),
              React.createElement(
                "div",
                { className: "controls-header-right" },
                React.createElement(
                  "span",
                  { className: "count-label" },
                  "Count: ",
                  components.length,
                  " / ",
                  maxComponents
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "secondary-button",
                    onClick: handleAddComponent,
                    disabled:
                      components.length >= maxComponents ||
                      (needsBaseline && !baselineLocked),
                  },
                  "+ Component"
                )
              )
            ),
            needsBaseline &&
              !baselineLocked &&
              React.createElement(
                "p",
                { className: "phase-lock-hint" },
                "Science-line controls unlock after you lock the baseline."
              ),
            React.createElement(
              "div",
              { className: "component-list" },
              components.map((component, idx) =>
                React.createElement(
                  "div",
                  {
                    key: component.id,
                    className:
                      "gaussian-row" +
                      (component.id === selectedId ? " gaussian-row-selected" : ""),
                    onClick: () => {
                      if (!needsBaseline || baselineLocked) setSelectedId(component.id);
                    },
                  },
                  React.createElement(
                    "div",
                    { className: "gaussian-row-header" },
                    React.createElement(
                      "span",
                      null,
                      React.createElement("span", {
                        className: "component-swatch",
                        style: {
                          background: COMPONENT_COLORS[idx % COMPONENT_COLORS.length],
                        },
                      }),
                      "Component ",
                      idx + 1,
                      component.id === selectedId
                        ? React.createElement("span", { className: "selected-tag" }, "selected")
                        : null
                    ),
                    components.length > 1 &&
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "secondary-button tiny-button",
                          onClick: (e) => {
                            e.stopPropagation();
                            handleRemoveComponent(component.id);
                          },
                        },
                        "Remove"
                      )
                  ),
                  React.createElement(
                    "div",
                    { className: "slider-group" },
                    React.createElement(
                      "div",
                      { className: "slider-label" },
                      React.createElement("span", null, amplitudeLabel),
                      React.createElement(
                        "span",
                        { className: "value" },
                        component.amplitude.toFixed(2)
                      )
                    ),
                    React.createElement("input", {
                      type: "range",
                      min: ranges.amplitudeMin,
                      max: ranges.amplitudeMax,
                      step: ranges.amplitudeStep,
                      value: component.amplitude,
                      className: "slider-input",
                      onChange: (e) =>
                        handleUpdateComponent(
                          component.id,
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
                      React.createElement("span", null, axis.centerLabel),
                      React.createElement(
                        "span",
                        { className: "value" },
                        formatAxisValue(component.center, axis.key)
                      )
                    ),
                    React.createElement("input", {
                      type: "range",
                      min: level.xMin,
                      max: level.xMax,
                      step: ranges.centerStep,
                      value: component.center,
                      className: "slider-input",
                      onChange: (e) =>
                        handleUpdateComponent(
                          component.id,
                          "center",
                          parseFloat(e.target.value)
                        ),
                    }),
                    React.createElement(
                      "div",
                      { className: "fine-row" },
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "secondary-button tiny-button",
                          onClick: () =>
                            handleNudgeCenter(component.id, -ranges.centerFineStep),
                          "aria-label": "Nudge center down",
                        },
                        "−"
                      ),
                      React.createElement("input", {
                        type: "number",
                        className: "fine-input",
                        min: level.xMin,
                        max: level.xMax,
                        step: ranges.centerFineStep,
                        value: component.center,
                        onChange: (e) => {
                          const v = parseFloat(e.target.value);
                          if (isFinite(v)) handleUpdateComponent(component.id, "center", v);
                        },
                      }),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "secondary-button tiny-button",
                          onClick: () =>
                            handleNudgeCenter(component.id, ranges.centerFineStep),
                          "aria-label": "Nudge center up",
                        },
                        "+"
                      ),
                      React.createElement("span", { className: "fine-unit" }, axis.unit)
                    )
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
                        component.sigma.toFixed(axis.key === "nm" ? 3 : 2)
                      )
                    ),
                    React.createElement("input", {
                      type: "range",
                      min: ranges.sigmaMin,
                      max: ranges.sigmaMax,
                      step: ranges.sigmaStep,
                      value: component.sigma,
                      className: "slider-input",
                      onChange: (e) =>
                        handleUpdateComponent(
                          component.id,
                          "sigma",
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
                      React.createElement("span", null, "Optical depth τ"),
                      React.createElement(
                        "span",
                        { className: "value" },
                        component.tau.toFixed(2),
                        " — ",
                        describeTau(component.tau)
                      )
                    ),
                    React.createElement("input", {
                      type: "range",
                      min: 0,
                      max: 1000,
                      step: 1,
                      value: tauToSlider(component.tau),
                      className: "slider-input",
                      onChange: (e) =>
                        handleUpdateComponent(
                          component.id,
                          "tau",
                          sliderToTau(parseFloat(e.target.value))
                        ),
                    })
                  )
                )
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
            {
              type: "button",
              className: "primary-button",
              onClick: handleSubmit,
              disabled: needsBaseline && !baselineLocked,
            },
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
          React.createElement(
            "div",
            { className: "metric-pill" },
            "Lines: ",
            gradedScience.length + gradedTellurics.length,
          ),
          needsBaseline &&
            React.createElement(
              "div",
              { className: "metric-pill" },
              baselineLocked ? "Baseline locked" : "Baseline unlocked"
            ),
          React.createElement("div", { className: "metric-pill" }, "Max components: ", maxComponents),
          React.createElement(
            "div",
            { className: "metric-pill" },
            "Threshold: ",
            level.errorThresholdPercent,
            "% in ",
            axis.unit
          )
        ),
        React.createElement(
          "div",
          { className: "hud-status" },
          axis.key === "nm"
            ? "Wavelengths are real solar Fraunhofer lines. On two-step levels, lock continuum and amber telluric O₂ first, then fit the solar lines."
            : "Frequencies are real astronomical lines (CDMS). On continuum levels, lock the baseline first, then fit the lines."
        ),
        React.createElement(
          "div",
          { className: "hud-status" },
          "Optical depth τ shapes each line: small τ gives a Gaussian, large τ saturates it into a flat ",
          absorb ? "dark core" : "top",
          "."
        ),
        completionSummary &&
          React.createElement(
            "div",
            { style: { marginTop: 8 } },
            React.createElement(
              "div",
              { style: { fontSize: "0.8rem", marginBottom: 4 } },
              axis.key === "nm"
                ? "Line summary — wavelengths in nm (Fraunhofer)"
                : "Line summary — frequencies in GHz (CDMS)"
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
                  React.createElement("th", null, "True (" + axis.unit + ")"),
                  React.createElement("th", null, axis.key === "nm" ? "Element" : "Molecule"),
                  React.createElement("th", null, "Fitted (" + axis.unit + ")"),
                  React.createElement("th", { className: "error-cell" }, "Error %")
                )
              ),
              React.createElement(
                "tbody",
                null,
                completionSummary.lineErrors.map((le, idx) => {
                  const fitted = le.matchedGaussian ? le.matchedGaussian.center : null;
                  const closest = findClosestCatalogLine(fitted, axis.key);
                  const tolerance = (level.xMax - level.xMin) * 0.02;
                  return React.createElement(
                    "tr",
                    { key: idx },
                    React.createElement("td", null, formatAxisValue(le.line.center, axis.key)),
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
                      fitted != null
                        ? React.createElement(
                            "span",
                            null,
                            formatAxisValue(fitted, axis.key),
                            closest && Math.abs(closest.value - fitted) < tolerance
                              ? React.createElement(
                                  "span",
                                  { style: { marginLeft: 6, opacity: 0.85, fontSize: "0.75rem" } },
                                  "→ ",
                                  closest.species
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
            ),
            completionSummary.extraLineCount > 0 &&
              React.createElement(
                "div",
                { className: "hud-status hud-bonus" },
                describeBonusLines(completionSummary)
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

  async function handleStart(startIndex) {
    const idx = Number.isInteger(startIndex) && LEVELS[startIndex] ? startIndex : 0;
    await ensureAudioReady();
    setScreen("play");
    setLevelIndex(idx);
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
    const axisKey = completionModal.axis || "GHz";
    const unit = axisByKey(axisKey).unit;
    const rows = [];
    rows.push(["Level", completionModal.levelId]);
    rows.push(["Level name", completionModal.levelName]);
    rows.push(["Line mode", completionModal.mode || "emission"]);
    rows.push(["Spectral unit", unit]);
    rows.push(["Passed", completionModal.passed ? "yes" : "no"]);
    rows.push(["MSE", String(Number.isFinite(completionModal.mse) ? completionModal.mse.toFixed(6) : "")]);
    rows.push([
      "Mean error %",
      String(Number.isFinite(completionModal.meanErr) ? completionModal.meanErr.toFixed(4) : ""),
    ]);
    rows.push(["Stars", String(completionModal.stars || 0)]);
    if (completionModal.sonification) {
      rows.push(["Audio rule", completionModal.sonification.mode]);
      rows.push(["Audio scale factor", String(completionModal.sonification.scaleFactor)]);
    }
    rows.push([]);
    rows.push([
      "True " + unit,
      "Species",
      "Scored",
      "Fitted " + unit,
      "Error (%)",
      "Peak",
      "Sigma (" + unit + ")",
      "Optical depth",
      "Audible Hz",
    ]);
    const audible = (completionModal.sonification && completionModal.sonification.audibleHz) || [];
    const lineRow = (le, audibleHz, scored) => {
      const fitted = le.matchedGaussian;
      return [
        le.line.center.toFixed(6),
        lineSpeciesLabel(le.line),
        scored ? "yes" : "bonus",
        fitted ? fitted.center.toFixed(6) : "",
        le.percentError != null ? le.percentError.toFixed(4) : "",
        fitted ? fitted.amplitude.toFixed(4) : "",
        fitted ? fitted.sigma.toFixed(4) : "",
        fitted ? fitted.tau.toFixed(3) : "",
        audibleHz != null ? audibleHz.toFixed(2) : "",
      ];
    };
    completionModal.lineErrors.forEach((le, idx) => {
      rows.push(lineRow(le, audible[idx], true));
    });
    (completionModal.bonusErrors || []).forEach((le) => {
      rows.push(lineRow(le, null, false));
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
  const modalLevel = completionModal ? levelById(completionModal.levelId) : null;
  const modalAxis = axisByKey(completionModal ? completionModal.axis : "GHz");
  const modalBands = modalLevel ? starBandsForLevel(modalLevel) : null;
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
            TRACKS.map((track) =>
              React.createElement(
                "div",
                { key: track.key, className: "level-group" },
                React.createElement("span", { className: "level-group-label" }, track.label),
                LEVELS.filter((lvl) => lvl.track === track.key).map((lvl) => {
                  const idx = LEVELS.indexOf(lvl);
                  return React.createElement(
                    "button",
                    {
                      key: lvl.id,
                      type: "button",
                      title: lvl.name,
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
                  );
                })
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
        onStart: () => handleStart(0),
        onPlayLevel: (idx) => handleStart(idx),
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
              "Mean center error ",
              Number.isFinite(completionModal.meanErr)
                ? completionModal.meanErr.toFixed(2)
                : "—",
              "% · Spectrum mismatch ",
              Number.isFinite(completionModal.fitPct)
                ? completionModal.fitPct.toFixed(1)
                : "—",
              "%"
            )
          ),
          React.createElement(
            "p",
            { className: "modal-hint" },
            "Stars use the mean center error (not raw MSE), scaled to this level: 5★ needs ≤",
            modalBands ? modalBands[0].toPrecision(2) : "0.05",
            "% — keep refining for the leaderboard!"
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
                  React.createElement("th", null, "True (" + modalAxis.unit + ")"),
                  React.createElement("th", null, modalAxis.key === "nm" ? "Element" : "Molecule"),
                  React.createElement("th", null, "Fitted (" + modalAxis.unit + ")"),
                  React.createElement("th", null, "Audible Hz"),
                  React.createElement("th", { className: "error-cell" }, "Error %"),
                  React.createElement("th", null, "Peak"),
                  React.createElement("th", null, "Sigma"),
                  React.createElement("th", null, "τ"),
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
                      React.createElement(
                        "td",
                        null,
                        formatAxisValue(le.line.center, modalAxis.key)
                      ),
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
                        le.matchedGaussian
                          ? formatAxisValue(le.matchedGaussian.center, modalAxis.key)
                          : "—"
                      ),
                      React.createElement(
                        "td",
                        null,
                        audible != null && isFinite(audible) ? audible.toFixed(1) : "—"
                      ),
                      React.createElement(
                        "td",
                        { className: "error-cell" },
                        le.percentError != null ? le.percentError.toFixed(3) : "—"
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
                        le.matchedGaussian ? le.matchedGaussian.tau.toFixed(2) : "—"
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
          completionModal.extraLineCount > 0 &&
            React.createElement(
              "p",
              { className: "modal-bonus" },
              describeBonusLines(completionModal)
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
                describeSonifyRule(completionModal.sonification)
              ),
              completionModal.sonification.mode === "ratio" &&
                React.createElement(
                  "p",
                  { className: "sonify-scale" },
                  "This window is wide enough that no exaggeration is needed: the whole spectrum lands between ",
                  Math.round(completionModal.sonification.windowAudibleHz[0]),
                  " and ",
                  Math.round(completionModal.sonification.windowAudibleHz[1]),
                  " Hz, and the intervals you hear are the real ones."
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
                showWhyScale
                  ? "Hide: How do we turn these lines into sound?"
                  : "How do we turn these lines into sound?"
              ),
              showWhyScale &&
                React.createElement(
                  "div",
                  { className: "why-scale-box" },
                  React.createElement(
                    "p",
                    null,
                    "Spectral lines vibrate far too fast for human ears: radio lines sit at tens or hundreds of gigahertz, and visible light at hundreds of terahertz. We only hear roughly 20 Hz to 20,000 Hz."
                  ),
                  React.createElement(
                    "p",
                    null,
                    "When a spectrum covers a wide range — like HEXOS Band 1a from 480 to 560 GHz, or the whole rainbow from red to violet — we can simply divide every frequency by one big number. The notes then sit in the true ratios of the real lines, so a factor of two in frequency really is an octave."
                  ),
                  React.createElement(
                    "p",
                    null,
                    "In a narrow window that trick fails: 88.6 GHz and 89.2 GHz divided by the same number would land about 1 Hz apart and sound identical. For those levels we stretch the gaps instead, roughly ",
                    SONIFY_HZ_PER_GHZ,
                    " Hz of pitch for every 1 GHz of separation, so you can still tell the lines apart."
                  ),
                  React.createElement(
                    "p",
                    null,
                    "Either way this is a sonification for outreach, not a recording of the wave itself — so visitors can experience that different species sit at different frequencies."
                  )
                )
            ),
          (knownFacts.length > 0 || hasUnknownLines) &&
            React.createElement(
              "div",
              { className: "fact-cards" },
              React.createElement(
                "div",
                { className: "panel-title" },
                modalAxis.key === "nm" ? "Element facts" : "Molecule facts"
              ),
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
          React.createElement(CdmsLearnMore, { solar: modalAxis.key === "nm" }),
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
