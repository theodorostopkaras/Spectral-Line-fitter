// Spectrum Fitter — kids' edition (ages 8–10), English / Deutsch.
// Ten short windows cut from the solar spectrum and a radio dust continuum; the computer fits
// the continuum and Earth's atmosphere, the kids find the lines.
// Radio rest frequencies from CDMS, solar Fraunhofer wavelengths from standard line tables.
// Lines are emission or absorption and carry an optical depth, so strong lines saturate.
// Every fitted parameter carries a physical unit: brightness temperature in K, line depth as
// a fraction of the local continuum, widths in nm/GHz (with the velocity equivalent shown),
// and the continuum itself is a normalised Planck curve (solar) or dust power law (radio).

/**
 * @typedef {{ amplitude: number; center: number; sigma: number; tau: number }} LineParams
 * @typedef {{ amplitude: number; center: number; sigma: number; tau: number; knownLine: boolean; graded?: boolean; role?: "science" | "telluric"; label?: string; transition?: string }} TrueLine
 * @typedef {{ id: number; amplitude: number; center: number; sigma: number; tau: number; role?: "science" | "telluric" }} PlayerComponent
 * @typedef {{ type: "flat"; c0: number } | { type: "solar"; temperatureK: number; airmass: number } | { type: "powerLaw"; refBrightnessK: number; index: number }} ContinuumSpec
 * @typedef {{ id: number; name: string; track: string; mode: "emission" | "absorption"; axis: "GHz" | "nm"; sonify: "stretch" | "ratio"; xMin: number; xMax: number; noiseLevel: number; baseline: number; continuum?: ContinuumSpec; continuumLockPercent?: number; trueLines: TrueLine[]; maxGaussians?: number; errorThresholdPercent: number; starBands?: number[]; allowLogY?: boolean; showSpectrumColors?: boolean; blurb?: string }} LevelConfig
 */

const CDMS_URL = "https://cdms.astro.uni-koeln.de/classic/";
const STORAGE_KEY = "spectrumFitter.kids.v1";
const LANG_KEY = "spectrumFitter.lang";
const STICKER_KEY = "spectrumFitter.kids.stickers";
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
const STAR_BAND_FRACTIONS = [0.15, 0.3, 0.5, 0.75, 1.0];
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
/** hc/k in nm·K, so Planck's exponent is simply HC_OVER_K_NM_K / (lambda_nm * T). */
const HC_OVER_K_NM_K = 1.43877736e7;
/** Rayleigh optical depth of the whole atmosphere at 550 nm, one airmass, at sea level. */
const RAYLEIGH_TAU_550 = 0.0973;
const RAYLEIGH_REF_NM = 550;
/** Effective temperature of the solar photosphere — the answer to the Level 10 continuum. */
const SUN_TEFF_K = 5772;
/** sigma -> FWHM for a Gaussian. */
const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * Math.LN2);

/** Kids' sonification: the window is spread over two octaves starting at middle C. */
const WINDOW_LOW_HZ = 261.63;

// ——— Language (English / Deutsch) ———

const STRINGS = {
  en: {
    appTitle: "Spectrum Detective",
    tagline: "Find the hidden lines in starlight!",
    howto1: "Light from the Sun and from space clouds has a smooth glow with a few special lines in it.",
    howto2: "First, let the computer find the smooth glow — and remove it.",
    howto3: "Then YOU find the lines: click where each dip or bump is, and make your line as deep and wide as the real one.",
    howto4: "Press “Check my answer!” and listen to the lines as music.",
    start: "Start with Level 1",
    orPick: "…or pick any level below.",
    chooseLevel: "Choose a level",
    trackSolar: "Sunlight",
    trackSolarDesc: "dark lines in the Sun's rainbow",
    trackDust: "Radio clouds",
    trackDustDesc: "bright lines from cold space clouds",
    linesToFind: "{n} lines to find",
    lineToFind: "1 line to find",
    notPlayed: "Not played yet",
    best: "best: {name}",
    leaderboard: "Hall of fame",
    leaderboardIntro: "The best detectives on this computer.",
    resetLeaderboard: "Clear hall of fame",
    resetConfirm: "Clear the hall of fame and the sticker book on this computer? All names and stickers will be deleted.",
    noScores: "No names yet — be the first!",
    learnMore: "Want to know more?",
    learnMoreText: "The Sun's dark lines were first mapped by Joseph von Fraunhofer in 1814. The radio lines come from the Cologne Database for Molecular Spectroscopy (CDMS).",
    qrAlt: "QR code linking to CDMS",
    home: "Home",
    vol: "Vol",
    volume: "Volume",
    mute: "Mute",
    unmute: "Sound on",
    language: "Language",
    level: "Level {n}",
    absorption: "Dark lines",
    emission: "Bright lines",
    step1: "Step 1 · The background",
    step2: "Step 2 · Find the lines",
    bgExplainSolar: "The smooth curve is the Sun's glow. Its shape tells us how hot the Sun is.",
    bgExplainDust: "The rising background is cold dust in space, glowing in radio light.",
    bgExplainAtmos: "The orange dips are made by oxygen in Earth's air — not by the Sun!",
    fitBg: "🤖 Computer, fit the background!",
    fitting: "The computer is thinking…",
    bgFitted: "Done! The grey dashed curve follows the background now.",
    removeBg: "✨ Remove it!",
    removed: "Background removed — now only the lines are left.",
    before: "Show before",
    after: "Show after",
    locked: "Do step 1 first.",
    addLine: "+ Add line",
    lineN: "Line {n}",
    selected: "selected",
    removeLine: "✕ Remove",
    linesCount: "Lines: {n} / {max}",
    where: "Where is it?",
    howDeep: "How deep?",
    howBright: "How bright?",
    howWide: "How wide?",
    howFull: "How full? (optical depth τ)",
    tauThin: "thin and pointy",
    tauMid: "in between",
    tauThick: "thick and rounded",
    tauFull: "totally full, flat {edge}",
    edgeBottom: "bottom",
    edgeTop: "top",
    clickHint: "Tip: click on the picture to move your selected line there!",
    foundCount: "Lines in the right place: {n} / {total}",
    readyToCheck: " — ready to check!",
    keepGoing: " — keep going!",
    check: "Check my answer!",
    reset: "Start over",
    fitQuality: "How well does your green curve match? {label}",
    fitNone: "No lines yet",
    fitExcellent: "Excellent! 🌟",
    fitGood: "Good",
    fitOk: "Getting there",
    fitPoor: "Not yet",
    observed: "Measured light",
    observedRemoved: "Measured light (background removed)",
    atmosphereData: "Earth's air (in the data)",
    atmosphereFit: "Computer's air fit",
    background: "Background",
    yourModel: "Your lines (green)",
    axisNm: "Wavelength (nm) — colour of the light",
    axisGHz: "Frequency (GHz) — radio light",
    yRaw: "Brightness",
    yRemoved: "Brightness without background",
    unknownLine: "Unknown line",
    greatJob: "Great job, detective! 🎉",
    almost: "Almost there!",
    passedLead: "You solved Level {n}: {name}",
    failedLead: "{n} of {total} lines are in the right place. Move the others a little and try again!",
    theLine: "Line",
    realPlace: "Real place",
    yourPlace: "Your place",
    ok: "OK?",
    hear: "Listen",
    play: "▶ Play",
    hearYourFit: "🎵 Listen to your lines",
    playAll: "Play all together",
    playing: "Playing…",
    audioBlocked: "Press Play again if you hear nothing.",
    sonifyWindow: "Light waves wiggle far too fast to hear, so we squeezed this part of the spectrum into two octaves of a piano: higher frequency → higher note.",
    yourName: "Your name",
    saveName: "Add me to the hall of fame",
    enterName: "Type your name first (up to {max} letters).",
    saved: "Saved! You are number {rank} on Level {level}.",
    notTop: "Great try — not in the top {n} yet. Play again for more stars!",
    facts: "Did you know?",
    tryAgain: "Try again",
    nextLevel: "Next level ➜",
    lastLevel: "Back to start",
    exit: "Finish",
    thanks: "Thanks for playing!",
    thanksText: "You are a real spectrum detective now.",
    backToStart: "Back to start",
    stars: "{n} of 5 stars",
    nudgeDown: "Smaller",
    nudgeUp: "Bigger",
    mascotName: "Specky",
    mascotHello: "Hi, I'm Specky! First, ask the computer to find the smooth background.",
    mascotFitting: "Beep boop… the computer is trying lots of curves!",
    mascotFitted: "Nice fit! Now make the background disappear.",
    mascotStartAbs: "Your turn! Click on a dark dip in the picture.",
    mascotStartEm: "Your turn! Click on a bright bump in the picture.",
    mascotSome: "{n} found! Keep hunting, detective!",
    mascotReady: "You found them all! Press “Check my answer!”",
    mascotStars5: "WOW! Perfect detective work!",
    mascotStars3: "Super! You have sharp eyes.",
    mascotStars1: "You did it! Play again for more stars.",
    mascotFailed: "Don't give up! Move the ❌ lines a little.",
    hot: "🔥 Hot!",
    warm: "♨️ Warm",
    cool: "🌤️ Cool",
    cold: "❄️ Cold",
    stickerBook: "Sticker book",
    stickerCount: "{n} of {total} collected",
    stickerIntro: "Solve levels to collect every atom and molecule!",
    newSticker: "🎁 New sticker!",
    journey: "Your space journey",
    chapterSun: "The Sun",
    chapterSunDesc: "dark lines in the Sun's rainbow",
    chapterAir: "Earth's air",
    chapterAirDesc: "our own air sneaks into the sunlight",
    chapterCloud: "Space clouds",
    chapterCloudDesc: "bright radio lines from cold clouds",
    nextStop: "Next stop!",
    quizStart: "🎵 Guess the molecule by its song",
    quizTitle: "Guess the molecule by its song",
    quizIntro: "Every line sings its own note. Listen to the mystery note, then tap the one that sings it!",
    quizHintSolar: "In sunlight, the high notes are on the violet (left) side.",
    quizHintRadio: "In radio light, the high notes are on the right side.",
    quizPlay: "▶ Play the mystery note",
    quizRight: "Yes! That was {name}!",
    quizWrong: "Not that one — it sounds like this. Listen again!",
    quizNext: "Next song ➜",
    quizScore: "Right on the first try: {n} of {total}",
    quizMuted: "Turn the sound on to play this game!",
    quizAxisSound: "Note you hear (Hz)",
  },
  de: {
    appTitle: "Spektrum-Detektiv",
    tagline: "Finde die versteckten Linien im Sternenlicht!",
    howto1: "Licht von der Sonne und von Wolken im Weltall hat ein glattes Leuchten mit ein paar besonderen Linien darin.",
    howto2: "Zuerst findet der Computer das glatte Leuchten – und entfernt es.",
    howto3: "Dann findest DU die Linien: Klicke dorthin, wo ein Tal oder ein Berg ist, und mach deine Linie so tief und breit wie die echte.",
    howto4: "Drücke „Prüfe meine Antwort!“ und hör dir die Linien als Musik an.",
    start: "Mit Level 1 starten",
    orPick: "…oder such dir unten ein Level aus.",
    chooseLevel: "Wähle ein Level",
    trackSolar: "Sonnenlicht",
    trackSolarDesc: "dunkle Linien im Regenbogen der Sonne",
    trackDust: "Radiowolken",
    trackDustDesc: "helle Linien aus kalten Wolken im Weltall",
    linesToFind: "{n} Linien zu finden",
    lineToFind: "1 Linie zu finden",
    notPlayed: "Noch nicht gespielt",
    best: "Beste: {name}",
    leaderboard: "Ruhmeshalle",
    leaderboardIntro: "Die besten Detektive auf diesem Computer.",
    resetLeaderboard: "Ruhmeshalle leeren",
    resetConfirm: "Ruhmeshalle und Stickeralbum auf diesem Computer leeren? Alle Namen und Sticker werden gelöscht.",
    noScores: "Noch keine Namen – sei die oder der Erste!",
    learnMore: "Willst du mehr wissen?",
    learnMoreText: "Die dunklen Linien der Sonne hat Joseph von Fraunhofer 1814 zum ersten Mal genau vermessen. Die Radiolinien stammen aus der Kölner Datenbank für Molekülspektroskopie (CDMS).",
    qrAlt: "QR-Code zur CDMS-Webseite",
    home: "Start",
    vol: "Lautst.",
    volume: "Lautstärke",
    mute: "Ton aus",
    unmute: "Ton an",
    language: "Sprache",
    level: "Level {n}",
    absorption: "Dunkle Linien",
    emission: "Helle Linien",
    step1: "Schritt 1 · Der Hintergrund",
    step2: "Schritt 2 · Finde die Linien",
    bgExplainSolar: "Die glatte Kurve ist das Leuchten der Sonne. Ihre Form verrät, wie heiß die Sonne ist.",
    bgExplainDust: "Der ansteigende Hintergrund ist kalter Staub im Weltall, der im Radiolicht leuchtet.",
    bgExplainAtmos: "Die orangen Täler macht der Sauerstoff in der Luft der Erde – nicht die Sonne!",
    fitBg: "🤖 Computer, finde den Hintergrund!",
    fitting: "Der Computer denkt nach…",
    bgFitted: "Fertig! Die graue gestrichelte Kurve folgt jetzt dem Hintergrund.",
    removeBg: "✨ Weg damit!",
    removed: "Hintergrund entfernt – jetzt sind nur noch die Linien übrig.",
    before: "Vorher zeigen",
    after: "Nachher zeigen",
    locked: "Mach zuerst Schritt 1.",
    addLine: "+ Linie dazu",
    lineN: "Linie {n}",
    selected: "ausgewählt",
    removeLine: "✕ Löschen",
    linesCount: "Linien: {n} / {max}",
    where: "Wo ist sie?",
    howDeep: "Wie tief?",
    howBright: "Wie hell?",
    howWide: "Wie breit?",
    howFull: "Wie voll? (optische Tiefe τ)",
    tauThin: "dünn und spitz",
    tauMid: "mittel",
    tauThick: "dick und rund",
    tauFull: "ganz voll, flacher {edge}",
    edgeBottom: "Boden",
    edgeTop: "Gipfel",
    clickHint: "Tipp: Klicke auf das Bild, um deine ausgewählte Linie dorthin zu schieben!",
    foundCount: "Linien an der richtigen Stelle: {n} / {total}",
    readyToCheck: " – bereit zum Prüfen!",
    keepGoing: " – weiter so!",
    check: "Prüfe meine Antwort!",
    reset: "Neu anfangen",
    fitQuality: "Wie gut passt deine grüne Kurve? {label}",
    fitNone: "Noch keine Linien",
    fitExcellent: "Super! 🌟",
    fitGood: "Gut",
    fitOk: "Fast",
    fitPoor: "Noch nicht",
    observed: "Gemessenes Licht",
    observedRemoved: "Gemessenes Licht (ohne Hintergrund)",
    atmosphereData: "Luft der Erde (in den Daten)",
    atmosphereFit: "Luft-Fit vom Computer",
    background: "Hintergrund",
    yourModel: "Deine Linien (grün)",
    axisNm: "Wellenlänge (nm) – Farbe des Lichts",
    axisGHz: "Frequenz (GHz) – Radiolicht",
    yRaw: "Helligkeit",
    yRemoved: "Helligkeit ohne Hintergrund",
    unknownLine: "Unbekannte Linie",
    greatJob: "Super gemacht, Detektiv! 🎉",
    almost: "Fast geschafft!",
    passedLead: "Du hast Level {n} gelöst: {name}",
    failedLead: "{n} von {total} Linien sind an der richtigen Stelle. Schieb die anderen ein bisschen und versuch es nochmal!",
    theLine: "Linie",
    realPlace: "Echte Stelle",
    yourPlace: "Deine Stelle",
    ok: "OK?",
    hear: "Anhören",
    play: "▶ Spielen",
    hearYourFit: "🎵 Hör dir deine Linien an",
    playAll: "Alle zusammen spielen",
    playing: "Spielt…",
    audioBlocked: "Drück nochmal auf Spielen, wenn du nichts hörst.",
    sonifyWindow: "Lichtwellen schwingen viel zu schnell zum Hören. Deshalb haben wir dieses Stück Spektrum auf zwei Oktaven eines Klaviers zusammengedrückt: höhere Frequenz → höherer Ton.",
    yourName: "Dein Name",
    saveName: "Trag mich in die Ruhmeshalle ein",
    enterName: "Schreib zuerst deinen Namen (bis zu {max} Buchstaben).",
    saved: "Gespeichert! Du bist Nummer {rank} in Level {level}.",
    notTop: "Toller Versuch – noch nicht unter den besten {n}. Spiel nochmal für mehr Sterne!",
    facts: "Wusstest du schon?",
    tryAgain: "Nochmal versuchen",
    nextLevel: "Nächstes Level ➜",
    lastLevel: "Zurück zum Start",
    exit: "Beenden",
    thanks: "Danke fürs Spielen!",
    thanksText: "Jetzt bist du ein echter Spektrum-Detektiv.",
    backToStart: "Zurück zum Start",
    stars: "{n} von 5 Sternen",
    nudgeDown: "Kleiner",
    nudgeUp: "Größer",
    mascotName: "Specky",
    mascotHello: "Hallo, ich bin Specky! Frag zuerst den Computer nach dem glatten Hintergrund.",
    mascotFitting: "Piep piep… der Computer probiert ganz viele Kurven aus!",
    mascotFitted: "Gut gepasst! Jetzt lass den Hintergrund verschwinden.",
    mascotStartAbs: "Jetzt du! Klicke auf ein dunkles Tal im Bild.",
    mascotStartEm: "Jetzt du! Klicke auf einen hellen Berg im Bild.",
    mascotSome: "{n} gefunden! Such weiter, Detektiv!",
    mascotReady: "Du hast alle gefunden! Drück „Prüfe meine Antwort!“",
    mascotStars5: "WOW! Perfekte Detektivarbeit!",
    mascotStars3: "Super! Du hast scharfe Augen.",
    mascotStars1: "Geschafft! Spiel nochmal für mehr Sterne.",
    mascotFailed: "Nicht aufgeben! Schieb die ❌-Linien ein bisschen.",
    hot: "🔥 Heiß!",
    warm: "♨️ Warm",
    cool: "🌤️ Kühl",
    cold: "❄️ Kalt",
    stickerBook: "Stickeralbum",
    stickerCount: "{n} von {total} gesammelt",
    stickerIntro: "Löse Level, um jedes Atom und Molekül zu sammeln!",
    newSticker: "🎁 Neuer Sticker!",
    journey: "Deine Reise durchs Weltall",
    chapterSun: "Die Sonne",
    chapterSunDesc: "dunkle Linien im Regenbogen der Sonne",
    chapterAir: "Die Luft der Erde",
    chapterAirDesc: "unsere eigene Luft schleicht sich ins Sonnenlicht",
    chapterCloud: "Wolken im Weltall",
    chapterCloudDesc: "helle Radiolinien aus kalten Wolken",
    nextStop: "Nächster Halt!",
    quizStart: "🎵 Errate das Molekül an seinem Lied",
    quizTitle: "Errate das Molekül an seinem Lied",
    quizIntro: "Jede Linie singt ihren eigenen Ton. Hör dir den geheimen Ton an und tippe auf die Linie, die ihn singt!",
    quizHintSolar: "Im Sonnenlicht sind die hohen Töne auf der violetten (linken) Seite.",
    quizHintRadio: "Im Radiolicht sind die hohen Töne auf der rechten Seite.",
    quizPlay: "▶ Geheimen Ton spielen",
    quizRight: "Ja! Das war {name}!",
    quizWrong: "Nicht die – die klingt so. Hör nochmal hin!",
    quizNext: "Nächstes Lied ➜",
    quizScore: "Beim ersten Versuch richtig: {n} von {total}",
    quizMuted: "Mach den Ton an, um dieses Spiel zu spielen!",
    quizAxisSound: "Ton, den du hörst (Hz)",
  },
};

let LANG = (() => {
  try {
    return localStorage.getItem(LANG_KEY) === "de" ? "de" : "en";
  } catch (e) {
    return "en";
  }
})();

function setLang(lang) {
  LANG = lang === "de" ? "de" : "en";
  document.documentElement.lang = LANG;
  try {
    localStorage.setItem(LANG_KEY, LANG);
  } catch (e) {}
}

/** Translate a UI key, filling {placeholders} from vars. */
function t(key, vars) {
  const s = STRINGS[LANG][key] != null ? STRINGS[LANG][key] : STRINGS.en[key] != null ? STRINGS.en[key] : key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
}

/** Pick the current language out of an { en, de } object (plain strings pass through). */
function tx(obj) {
  if (obj == null || typeof obj === "string") return obj || "";
  return obj[LANG] || obj.en || "";
}

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

/** Continuum shape for a level (physical solar / dust models, or a flat baseline). */
function continuumSpec(level) {
  if (level && level.continuum) return level.continuum;
  return { type: "flat", c0: (level && level.baseline) || 0 };
}

/**
 * The wavelength (or frequency) the continuum is normalised at: the middle of the level's
 * window. Every shaped continuum equals its reference brightness there, whatever the player
 * does with the sliders, so the overall amplitude is never a free parameter.
 */
function continuumRefX(xMin, xMax) {
  return (xMin + xMax) / 2;
}

/** Planck's law in wavelength, up to constants — only ratios are ever used. */
function planckLambda(lambdaNm, temperatureK) {
  if (!(lambdaNm > 0) || !(temperatureK > 0)) return 0;
  const expArg = HC_OVER_K_NM_K / (lambdaNm * temperatureK);
  return 1 / (Math.pow(lambdaNm, 5) * (Math.exp(expArg) - 1));
}

/** Rayleigh optical depth of the air column: scattering goes as lambda^-4, so blue is lost first. */
function rayleighTau(lambdaNm, airmass) {
  return (
    RAYLEIGH_TAU_550 * airmass * Math.pow(RAYLEIGH_REF_NM / lambdaNm, 4)
  );
}

/**
 * Evaluate the continuum along x.
 * - solar: normalised Planck curve at temperature T, reddened by `airmass` of Rayleigh
 *   scattering. Both factors are 1 at the band centre, so the curvature comes from the solar
 *   temperature and the slope from the amount of air we look through.
 * - powerLaw: dust emission, S ~ nu^index, pinned to a known brightness at the band centre.
 */
function evaluateContinuum(x, continuum, xMin, xMax) {
  const spec = continuum || { type: "flat", c0: 0 };
  if (spec.type === "solar") {
    const ref = continuumRefX(xMin, xMax);
    const planckRef = planckLambda(ref, spec.temperatureK);
    const tauRef = rayleighTau(ref, spec.airmass);
    if (!(planckRef > 0)) return x.map(() => 0);
    return x.map(
      (xi) =>
        (planckLambda(xi, spec.temperatureK) / planckRef) *
        Math.exp(-(rayleighTau(xi, spec.airmass) - tauRef))
    );
  }
  if (spec.type === "powerLaw") {
    const ref = continuumRefX(xMin, xMax);
    const refBrightness = spec.refBrightnessK != null ? spec.refBrightnessK : 1;
    return x.map((xi) => refBrightness * Math.pow(xi / ref, spec.index));
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

/**
 * Absorption transmission of one line: its `amplitude` is the depth at line centre as a
 * fraction of whatever continuum sits behind it, so 0.8 always means "80 % of the light here
 * is swallowed" no matter how the continuum slopes.
 */
function lineTransmission(x, line) {
  const depth = evaluateLineProfile(x, line);
  return depth.map((d) => 1 - Math.min(1, Math.max(0, d)));
}

/**
 * Emission adds brightness temperatures onto the continuum; absorption multiplies the
 * continuum by the transmission of every line in front of it (solar lines at the Sun, then
 * telluric lines in our own air). The product can never go negative, so nothing is clamped.
 */
function composeSpectrum(x, lines, continuum, mode, xMin, xMax) {
  const absorb = isAbsorption(mode);
  const xmin = xMin != null ? xMin : x[0];
  const xmax = xMax != null ? xMax : x[x.length - 1];
  const contSpec =
    typeof continuum === "number" ? { type: "flat", c0: continuum } : continuum;
  const y = evaluateContinuum(x, contSpec, xmin, xmax);
  for (const line of lines) {
    if (absorb) {
      const transmission = lineTransmission(x, line);
      for (let i = 0; i < y.length; i++) y[i] *= transmission[i];
    } else {
      const contribution = evaluateLineProfile(x, line);
      for (let i = 0; i < y.length; i++) y[i] += contribution[i];
    }
  }
  return y;
}

/** One component drawn against the continuum, so absorption components dip downwards. */
function componentCurve(x, component, continuum, mode, xMin, xMax) {
  const contSpec =
    typeof continuum === "number" ? { type: "flat", c0: continuum } : continuum;
  const cont = evaluateContinuum(x, contSpec, xMin, xMax);
  if (isAbsorption(mode)) {
    const transmission = lineTransmission(x, component);
    return cont.map((c, i) => c * transmission[i]);
  }
  const contribution = evaluateLineProfile(x, component);
  return contribution.map((v, i) => cont[i] + v);
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

/** Where the continuum sliders start: plausible but clearly not the answer. */
function continuumDefaults(level) {
  const c = continuumSpec(level);
  if (c.type === "solar") {
    return { type: "solar", temperatureK: 4000, airmass: 2.5 };
  }
  if (c.type === "powerLaw") {
    return { type: "powerLaw", refBrightnessK: c.refBrightnessK, index: 1 };
  }
  return { type: "flat", c0: c.c0 };
}

/**
 * What the player recovered from the continuum, next to the truth. This is the physical payoff
 * of Level 10: fitting the curvature of the Sun's continuum measures its surface temperature.
 */
function continuumResults(fitted, truth) {
  if (!fitted || !truth || fitted.type !== truth.type) return [];
  if (truth.type === "solar") {
    return [
      {
        label: "Solar temperature",
        unit: "K",
        fitted: Math.round(fitted.temperatureK),
        truth: truth.temperatureK,
        decimals: 0,
      },
      {
        label: "Airmass",
        unit: "",
        fitted: fitted.airmass,
        truth: truth.airmass,
        decimals: 2,
      },
    ];
  }
  if (truth.type === "powerLaw") {
    return [
      {
        label: "Dust spectral index α",
        unit: "",
        fitted: fitted.index,
        truth: truth.index,
        decimals: 2,
      },
    ];
  }
  return [];
}

/** Doppler equivalent of a width: the same sigma in km/s, whichever axis the level uses. */
function velocityWidthKms(sigma, center) {
  if (!(sigma > 0) || !(center > 0)) return NaN;
  return (sigma / center) * (SPEED_OF_LIGHT_M_S / 1000);
}

/**
 * The spectrograph behind a level. The drawn widths are far broader than a real Fraunhofer or
 * molecular line, because a 0.01 nm line is invisible across a 320 nm window — so the width is
 * the instrument's resolution, not the gas. That is also the point of the close-up levels:
 * Fraunhofer's prism (R ~ 300) shows one dark "Mg b"; a grating (R ~ 5000) splits the triplet.
 */
function levelResolution(level) {
  const lines = level && level.trueLines ? level.trueLines : [];
  if (!lines.length) return null;
  const sigmas = lines.map((l) => l.sigma).sort((a, b) => a - b);
  const sigma = sigmas[Math.floor(sigmas.length * 0.25)];
  const fwhm = sigma * FWHM_PER_SIGMA;
  const mid = continuumRefX(level.xMin, level.xMax);
  return {
    sigma,
    fwhm,
    resolvingPower: fwhm > 0 ? mid / fwhm : NaN,
    velocityKms: velocityWidthKms(fwhm, mid),
  };
}

/**
 * The computer's starting guess for Earth's own lines: it knows where oxygen absorbs (the
 * catalogue wavelength, as a real reduction pipeline does), but not yet how deep or wide.
 */
function seedTelluricComponents(level) {
  return telluricLinesOf(level.trueLines).map((line, i) => ({
    id: 1000 + i,
    amplitude: 0.02,
    center: line.center,
    sigma: line.sigma * 0.6,
    tau: line.tau,
    role: "telluric",
  }));
}

/**
 * The computer's own background fit: coordinate descent on the existing baseline residual,
 * over the continuum shape and each telluric line's depth and width.
 * ponytail: coordinate descent over at most ~6 params on a thinned spectrum; switch to
 * Levenberg–Marquardt if windows get wider or parameters multiply.
 * @returns {{ continuum: ContinuumSpec; tellurics: PlayerComponent[] }}
 */
function autoFitBaseline(spectrum, level, startContinuum, startTellurics) {
  const science = scienceLinesOf(level.trueLines);
  const stride = Math.max(1, Math.floor(spectrum.x.length / 800));
  const thin = {
    x: spectrum.x.filter((_, i) => i % stride === 0),
    y: spectrum.y.filter((_, i) => i % stride === 0),
  };
  const params = [];
  if (startContinuum.type === "solar") {
    params.push({ key: "temperatureK", min: 3000, max: 12000, step: 800 });
    params.push({ key: "airmass", min: 0.3, max: 4, step: 0.4 });
  } else if (startContinuum.type === "powerLaw") {
    params.push({ key: "index", min: -1, max: 6, step: 0.8 });
  }
  const sigmaMax = (level.xMax - level.xMin) / 10;
  startTellurics.forEach((_, i) => {
    params.push({ tel: i, key: "amplitude", min: 0.01, max: 1, step: 0.15 });
    params.push({ tel: i, key: "sigma", min: sigmaMax / 100, max: sigmaMax, step: sigmaMax / 8 });
  });
  const read = (s, p) => (p.tel == null ? s.c[p.key] : s.t[p.tel][p.key]);
  const cost = (s) =>
    baselineResidualPercent(thin, s.c, s.t, science, level.mode, level.xMin, level.xMax);
  let best = { c: { ...startContinuum }, t: startTellurics.map((x) => ({ ...x })) };
  let bestCost = cost(best);
  for (let iter = 0; iter < 200; iter++) {
    if (!params.some((p) => p.step > 1e-4 * (p.max - p.min))) break;
    for (const p of params) {
      let improved = false;
      for (const dir of [1, -1]) {
        const trial = { c: { ...best.c }, t: best.t.map((x) => ({ ...x })) };
        const v = Math.min(p.max, Math.max(p.min, read(best, p) + dir * p.step));
        if (p.tel == null) trial.c[p.key] = v;
        else trial.t[p.tel][p.key] = v;
        const c = cost(trial);
        if (c < bestCost) {
          best = trial;
          bestCost = c;
          improved = true;
          break;
        }
      }
      if (!improved) p.step /= 2;
    }
  }
  return { continuum: best.c, tellurics: best.t };
}

/** Linear blend of two parameter objects, for animating the computer's fit. */
function lerpParams(a, b, f) {
  const out = { ...b };
  for (const k of Object.keys(b)) {
    if (typeof b[k] === "number" && typeof a[k] === "number") out[k] = a[k] + (b[k] - a[k]) * f;
  }
  return out;
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
  if (!isFinite(fitPct)) return { label: t("fitNone"), cls: "" };
  if (fitPct < 3) return { label: t("fitExcellent"), cls: "good" };
  if (fitPct < 8) return { label: t("fitGood"), cls: "good" };
  if (fitPct < 15) return { label: t("fitOk"), cls: "ok" };
  return { label: t("fitPoor"), cls: "bad" };
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

/** Drawn lines with graded !== false count toward pass / stars; graded:false are optional bonus. */
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

/** "Calcium (Ca II K)" — the everyday name first, the astronomer's label after it. */
function lineSpeciesLabel(line) {
  if (!line || !line.knownLine) return t("unknownLine");
  const species = SPECIES[line.label];
  const code = line.transition ? line.label + " " + line.transition : line.label;
  return species ? tx(species.name) + " (" + code + ")" : code || "—";
}

function meanPercentError(lineErrors) {
  const vals = lineErrors.map((le) => le.percentError).filter((v) => v != null && isFinite(v));
  if (!vals.length) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** How many graded lines already sit inside the level's pass threshold. */
function countLinesWithin(lineErrors, thresholdPercent) {
  return lineErrors.filter(
    (le) => le.percentError != null && le.percentError <= thresholdPercent
  ).length;
}

function lineWithinThreshold(le, thresholdPercent) {
  return le && le.percentError != null && le.percentError <= thresholdPercent;
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

  if (mode === "window") {
    // The whole window becomes two piano octaves: easy to hear, higher frequency → higher note.
    const edgeA = axis.toHz(level.xMin);
    const edgeB = axis.toHz(level.xMax);
    const lo = Math.min(edgeA, edgeB);
    const hi = Math.max(edgeA, edgeB);
    return {
      mode: "window",
      unit: axisKey,
      audibleHz: originalHz.map((hz) =>
        isFinite(hz) ? WINDOW_LOW_HZ * Math.pow(4, (hz - lo) / (hi - lo)) : NaN
      ),
      originalHz,
      scaleFactor: NaN,
    };
  }

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
  if (sonification.mode === "window") return t("sonifyWindow");
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

/**
 * Short game sounds on the master gain (so mute and volume apply):
 * "ding" = a line landed in place, "win" = level solved, "miss" = not yet.
 */
async function playSfx(kind) {
  if (globalMuted) return;
  const ctx = await ensureAudioReady();
  if (!ctx || !masterGainNode) return;
  const now = ctx.currentTime;
  const notes = {
    ding: [[1046, 1046, 0, 0.18]],
    win: [[523, 523, 0, 0.14], [659, 659, 0.12, 0.14], [784, 784, 0.24, 0.14], [1046, 1046, 0.36, 0.4]],
    miss: [[330, 150, 0, 0.45]],
  }[kind];
  (notes || []).forEach(([fromHz, toHz, at, dur]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === "miss" ? "triangle" : "sine";
    osc.frequency.setValueAtTime(fromHz, now + at);
    osc.frequency.exponentialRampToValueAtTime(toHz, now + at + dur);
    gain.gain.setValueAtTime(0, now + at);
    gain.gain.linearRampToValueAtTime(0.25, now + at + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + at + dur);
    osc.connect(gain);
    gain.connect(masterGainNode);
    osc.start(now + at);
    osc.stop(now + at + dur + 0.05);
  });
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

/** Everyday names, a sticker character (emoji + nickname) and a fun fact for every species the kids' levels use. */
const SPECIES = {
  "Ca II": {
    emoji: "🦴",
    nick: { en: "Bony Calcium", de: "Knochen-Kalzium" },
    name: { en: "Calcium", de: "Kalzium" },
    fact: { en: "Calcium is in your bones and teeth — and it makes the two biggest dark lines in the Sun's violet light.", de: "Kalzium steckt in deinen Knochen und Zähnen – und es macht die zwei größten dunklen Linien im violetten Sonnenlicht." },
  },
  "H I": {
    emoji: "🎈",
    nick: { en: "Tiny Hydrogen", de: "Winziger Wasserstoff" },
    name: { en: "Hydrogen", de: "Wasserstoff" },
    fact: { en: "Hydrogen is the most common stuff in the whole Universe. The Sun is mostly made of it!", de: "Wasserstoff ist der häufigste Stoff im ganzen Universum. Die Sonne besteht zum größten Teil daraus!" },
  },
  "Fe I": {
    emoji: "🔩",
    nick: { en: "Rusty Iron", de: "Rostiges Eisen" },
    name: { en: "Iron", de: "Eisen" },
    fact: { en: "Iron — the metal of nails and bikes — makes thousands of little dark lines in sunlight.", de: "Eisen – das Metall von Nägeln und Fahrrädern – macht Tausende kleine dunkle Linien im Sonnenlicht." },
  },
  "Mg I": {
    emoji: "🎆",
    nick: { en: "Sparkly Magnesium", de: "Funkel-Magnesium" },
    name: { en: "Magnesium", de: "Magnesium" },
    fact: { en: "Magnesium burns with a super-bright white flame. It is used in fireworks and sparklers!", de: "Magnesium brennt mit einer super-hellen weißen Flamme. Man benutzt es in Feuerwerk und Wunderkerzen!" },
  },
  "Na I": {
    emoji: "🧂",
    nick: { en: "Salty Sodium", de: "Salziges Natrium" },
    name: { en: "Sodium", de: "Natrium" },
    fact: { en: "Sodium is half of table salt. It makes old street lamps glow orange-yellow.", de: "Natrium ist die Hälfte von Kochsalz. Es lässt alte Straßenlaternen orange-gelb leuchten." },
  },
  O2: {
    emoji: "🌬️",
    nick: { en: "Breathy Oxygen", de: "Puste-Sauerstoff" },
    name: { en: "Oxygen in our air", de: "Sauerstoff in unserer Luft" },
    fact: { en: "This line is not from the Sun at all: the oxygen you breathe swallows a bit of sunlight before it reaches the telescope.", de: "Diese Linie kommt gar nicht von der Sonne: Der Sauerstoff, den du atmest, schluckt ein bisschen Sonnenlicht, bevor es beim Teleskop ankommt." },
  },
  HCN: {
    emoji: "🧪",
    nick: { en: "Sneaky HCN", de: "Heimliche Blausäure" },
    name: { en: "Hydrogen cyanide", de: "Blausäure" },
    fact: { en: "Hydrogen cyanide is poisonous on Earth, but in space it helps astronomers find places where stars are born.", de: "Blausäure ist auf der Erde giftig, aber im Weltall hilft sie Astronomen, Orte zu finden, an denen Sterne geboren werden." },
  },
  "HCO+": {
    emoji: "⚡",
    nick: { en: "Zippy Formyl", de: "Flinkes Formyl" },
    name: { en: "Formyl ion", de: "Formyl-Ion" },
    fact: { en: "The formyl ion falls apart quickly on Earth, but in cold, empty space it can survive for a very long time.", de: "Das Formyl-Ion zerfällt auf der Erde schnell, aber im kalten, leeren Weltall kann es sehr lange überleben." },
  },
  "N2H+": {
    emoji: "🥶",
    nick: { en: "Chilly Diazenylium", de: "Bibber-Diazenylium" },
    name: { en: "Diazenylium", de: "Diazenylium" },
    fact: { en: "Diazenylium lives in the coldest places in space, about −260 °C, where new stars are just starting to form.", de: "Diazenylium lebt an den kältesten Orten im Weltall, etwa −260 °C, wo gerade neue Sterne entstehen." },
  },
  C34S: {
    emoji: "🏋️",
    nick: { en: "Heavy Hugo", de: "Schwerer Hugo" },
    name: { en: "Heavy carbon monosulfide", de: "Schweres Kohlenstoffmonosulfid" },
    fact: { en: "This is carbon monosulfide with a heavier kind of sulfur. Comparing heavy and light versions tells us how thick a cloud is.", de: "Das ist Kohlenstoffmonosulfid mit einer schwereren Sorte Schwefel. Schwere und leichte Versionen verraten, wie dick eine Wolke ist." },
  },
  CS: {
    emoji: "🧽",
    nick: { en: "Squeezy CS", de: "Quetsch-CS" },
    name: { en: "Carbon monosulfide", de: "Kohlenstoffmonosulfid" },
    fact: { en: "Carbon monosulfide shows astronomers where space clouds are thick and squeezed together.", de: "Kohlenstoffmonosulfid zeigt Astronomen, wo Wolken im Weltall dicht und zusammengedrückt sind." },
  },
  SO: {
    emoji: "🥚",
    nick: { en: "Stinky SO", de: "Stinke-SO" },
    name: { en: "Sulfur monoxide", de: "Schwefelmonoxid" },
    fact: { en: "Sulfur monoxide lights up where fast jets from baby stars crash into the cloud around them.", de: "Schwefelmonoxid leuchtet dort, wo schnelle Strahlen von Baby-Sternen in die Wolke um sie herum krachen." },
  },
  C18O: {
    emoji: "🤿",
    nick: { en: "Deep-Diver CO", de: "Tiefentaucher-CO" },
    name: { en: "Carbon monoxide (heavy oxygen)", de: "Kohlenmonoxid (schwerer Sauerstoff)" },
    fact: { en: "Only about one in 500 oxygen atoms is this heavy kind, so this line is faint — perfect for seeing deep inside clouds.", de: "Nur etwa eins von 500 Sauerstoffatomen ist von dieser schweren Sorte. Die Linie ist deshalb schwach – perfekt, um tief in Wolken hineinzuschauen." },
  },
  "13CO": {
    emoji: "👯",
    nick: { en: "Twin CO", de: "Zwillings-CO" },
    name: { en: "Carbon monoxide (heavy carbon)", de: "Kohlenmonoxid (schwerer Kohlenstoff)" },
    fact: { en: "This carbon monoxide has a slightly heavier carbon atom, so it sings at a slightly different frequency.", de: "Dieses Kohlenmonoxid hat ein etwas schwereres Kohlenstoffatom, darum „singt“ es bei einer etwas anderen Frequenz." },
  },
  CN: {
    emoji: "👴",
    nick: { en: "Grandpa CN", de: "Opa CN" },
    name: { en: "Cyanide radical", de: "Cyan-Radikal" },
    fact: { en: "CN was one of the very first molecules ever found in space, back in 1940!", de: "CN war eines der allerersten Moleküle, die im Weltall entdeckt wurden – schon 1940!" },
  },
  CO: {
    emoji: "👑",
    nick: { en: "King CO", de: "König CO" },
    name: { en: "Carbon monoxide", de: "Kohlenmonoxid" },
    fact: { en: "Carbon monoxide makes the brightest radio line in the sky. Astronomers use it to map the whole Milky Way.", de: "Kohlenmonoxid macht die hellste Radiolinie am Himmel. Astronomen kartieren damit die ganze Milchstraße." },
  },
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

/** Clear all named leaderboard scores and collected stickers for this device. */
function clearLeaderboard() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STICKER_KEY);
  } catch (e) {}
  return {};
}

/** Species labels collected in the sticker book on this device. */
function loadStickers() {
  try {
    const list = JSON.parse(localStorage.getItem(STICKER_KEY) || "[]");
    return Array.isArray(list) ? list.filter((label) => SPECIES[label]) : [];
  } catch (e) {
    return [];
  }
}

/** @returns {{ all: string[]; fresh: string[] }} the whole collection and the stickers new this time */
function addStickers(labels) {
  const have = loadStickers();
  const fresh = labels.filter((label) => SPECIES[label] && !have.includes(label));
  const all = have.concat(fresh);
  try {
    localStorage.setItem(STICKER_KEY, JSON.stringify(all));
  } catch (e) {}
  return { all, fresh };
}

/** Every species a level shows: its science lines, plus Earth's oxygen on telluric levels. */
function levelSpecies(level) {
  const labels = scienceLinesOf(level.trueLines).map((l) => l.label);
  if (telluricLinesOf(level.trueLines).length) labels.push("O2");
  return labels.filter((label, i) => SPECIES[label] && labels.indexOf(label) === i);
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
  { key: "solar", label: "trackSolar", desc: "trackSolarDesc" },
  { key: "dust", label: "trackDust", desc: "trackDustDesc" },
];

const SOLAR_CONTINUUM = { type: "solar", temperatureK: SUN_TEFF_K, airmass: 1.15 };
const DUST_CONTINUUM = { type: "powerLaw", refBrightnessK: 0.85, index: 4.0 };
/** Every level passes when each centre is within this fraction of the window width. */
const PASS_FRACTION_OF_WINDOW = 0.02;

/** Shared settings for a kids' window, so all ten levels are equally hard. */
function kidsLevel(cfg) {
  const solar = cfg.track === "solar";
  const mid = (cfg.xMin + cfg.xMax) / 2;
  return Object.assign(
    {
      mode: solar ? "absorption" : "emission",
      axis: solar ? "nm" : "GHz",
      sonify: "window",
      noiseLevel: solar ? 0.012 : 0.05,
      baseline: solar ? 1 : 0.6,
      continuum: solar ? SOLAR_CONTINUUM : DUST_CONTINUUM,
      showSpectrumColors: solar,
      errorThresholdPercent: ((PASS_FRACTION_OF_WINDOW * (cfg.xMax - cfg.xMin)) / mid) * 100,
    },
    cfg
  );
}

/**
 * Ten windows with at most three features each, cut from the old Level 10 (solar, 380–700 nm)
 * and Level 13 (dust continuum, 88–116 GHz). Line data is the real Fraunhofer / CDMS values;
 * the radio widths are a little broader so the peaks are easy to see.
 * @type {LevelConfig[]}
 */
const LEVELS = [
  kidsLevel({
    id: 1,
    track: "solar",
    name: { en: "Violet Sun", de: "Violette Sonne" },
    blurb: {
      en: "The violet end of sunlight. Calcium makes two big dark dips, and hydrogen makes a third!",
      de: "Das violette Ende des Sonnenlichts. Kalzium macht zwei große dunkle Täler, und Wasserstoff ein drittes!",
    },
    xMin: 385,
    xMax: 415,
    trueLines: [
      { amplitude: 0.8, center: 393.366, sigma: 0.65, tau: 8, knownLine: true, label: "Ca II", transition: "K" },
      { amplitude: 0.75, center: 396.847, sigma: 0.62, tau: 7, knownLine: true, label: "Ca II", transition: "H" },
      { amplitude: 0.45, center: 410.175, sigma: 0.7, tau: 2.5, knownLine: true, label: "H I", transition: "H-δ" },
    ],
  }),
  kidsLevel({
    id: 2,
    track: "solar",
    name: { en: "Blue Sun", de: "Blaue Sonne" },
    blurb: {
      en: "Iron, hydrogen and more iron each leave a dark mark in the blue light.",
      de: "Eisen, Wasserstoff und nochmal Eisen hinterlassen je eine dunkle Spur im blauen Licht.",
    },
    xMin: 425,
    xMax: 445,
    trueLines: [
      { amplitude: 0.35, center: 430.78, sigma: 0.8, tau: 2, knownLine: true, label: "Fe I", transition: "G" },
      { amplitude: 0.48, center: 434.047, sigma: 0.75, tau: 2.5, knownLine: true, label: "H I", transition: "H-γ" },
      { amplitude: 0.22, center: 438.355, sigma: 0.6, tau: 1, knownLine: true, label: "Fe I", transition: "e" },
    ],
  }),
  kidsLevel({
    id: 3,
    track: "solar",
    name: { en: "Turquoise Sun", de: "Türkise Sonne" },
    blurb: {
      en: "Hydrogen and iron hide in the blue-green part of the rainbow.",
      de: "Wasserstoff und Eisen verstecken sich im blaugrünen Teil des Regenbogens.",
    },
    xMin: 478,
    xMax: 505,
    trueLines: [
      { amplitude: 0.52, center: 486.134, sigma: 0.8, tau: 3, knownLine: true, label: "H I", transition: "H-β" },
      { amplitude: 0.2, center: 495.761, sigma: 0.6, tau: 1, knownLine: true, label: "Fe I", transition: "c" },
    ],
  }),
  kidsLevel({
    id: 4,
    track: "solar",
    name: { en: "Green Sun", de: "Grüne Sonne" },
    blurb: {
      en: "Magnesium and iron in the green, where the Sun shines brightest.",
      de: "Magnesium und Eisen im Grünen, wo die Sonne am hellsten strahlt.",
    },
    xMin: 510,
    xMax: 535,
    trueLines: [
      { amplitude: 0.55, center: 517.3, sigma: 1.1, tau: 4, knownLine: true, label: "Mg I", transition: "b" },
      { amplitude: 0.26, center: 527.039, sigma: 0.7, tau: 1.2, knownLine: true, label: "Fe I", transition: "E2" },
    ],
  }),
  kidsLevel({
    id: 5,
    track: "solar",
    name: { en: "Yellow & Orange Sun", de: "Gelbe & orange Sonne" },
    blurb: {
      en: "Sodium — the stuff in table salt and street lamps — plus a dip made by the oxygen in our own air!",
      de: "Natrium – das steckt in Kochsalz und Straßenlaternen – und dazu ein Tal vom Sauerstoff in unserer eigenen Luft!",
    },
    xMin: 575,
    xMax: 640,
    trueLines: [
      { amplitude: 0.7, center: 589.29, sigma: 0.8, tau: 6, knownLine: true, label: "Na I", transition: "D" },
      { amplitude: 0.2, center: 627.661, sigma: 0.6, tau: 0.8, knownLine: true, role: "telluric", label: "O2", transition: "a" },
    ],
  }),
  kidsLevel({
    id: 6,
    track: "solar",
    name: { en: "Red Sun", de: "Rote Sonne" },
    blurb: {
      en: "Hydrogen in the red — and Earth's air takes two big bites out of the sunlight.",
      de: "Wasserstoff im Roten – und die Luft der Erde beißt zwei große Stücke aus dem Sonnenlicht.",
    },
    xMin: 640,
    xMax: 770,
    trueLines: [
      { amplitude: 0.55, center: 656.281, sigma: 0.8, tau: 3, knownLine: true, label: "H I", transition: "H-α" },
      { amplitude: 0.28, center: 686.719, sigma: 0.7, tau: 1.5, knownLine: true, role: "telluric", label: "O2", transition: "B" },
      { amplitude: 0.5, center: 759.37, sigma: 0.8, tau: 2, knownLine: true, role: "telluric", label: "O2", transition: "A" },
    ],
  }),
  kidsLevel({
    id: 7,
    track: "dust",
    name: { en: "Cold Cloud", de: "Kalte Wolke" },
    blurb: {
      en: "Radio light from a dark, cold cloud where new stars are born. Three molecules shine here.",
      de: "Radiolicht aus einer dunklen, kalten Wolke, in der neue Sterne entstehen. Drei Moleküle leuchten hier.",
    },
    xMin: 87.5,
    xMax: 94.5,
    trueLines: [
      { amplitude: 2.4, center: 88.631847, sigma: 0.2, tau: 1.8, knownLine: true, label: "HCN", transition: "J=1-0" },
      { amplitude: 2.0, center: 89.188523, sigma: 0.2, tau: 1.4, knownLine: true, label: "HCO+", transition: "J=1-0" },
      { amplitude: 1.1, center: 93.173764, sigma: 0.2, tau: 0.7, knownLine: true, label: "N2H+", transition: "J=1-0" },
    ],
  }),
  kidsLevel({
    id: 8,
    track: "dust",
    name: { en: "Sulfur Cloud", de: "Schwefelwolke" },
    blurb: {
      en: "Three molecules with sulfur in them — the stuff that makes rotten eggs smell!",
      de: "Drei Moleküle mit Schwefel – dem Stoff, der faule Eier stinken lässt!",
    },
    xMin: 95,
    xMax: 101,
    trueLines: [
      { amplitude: 0.9, center: 96.41295, sigma: 0.2, tau: 0.5, knownLine: true, label: "C34S", transition: "J=2-1" },
      { amplitude: 1.4, center: 97.980953, sigma: 0.2, tau: 1.0, knownLine: true, label: "CS", transition: "J=2-1" },
      { amplitude: 1.0, center: 99.29987, sigma: 0.2, tau: 0.8, knownLine: true, label: "SO", transition: "3(2)-2(1)" },
    ],
  }),
  kidsLevel({
    id: 9,
    track: "dust",
    name: { en: "Carbon Monoxide Twins", de: "Kohlenmonoxid-Zwillinge" },
    blurb: {
      en: "Two kinds of the same molecule, standing close together. Can you tell them apart?",
      de: "Zwei Sorten desselben Moleküls, ganz dicht beieinander. Kannst du sie auseinanderhalten?",
    },
    xMin: 108.5,
    xMax: 112,
    trueLines: [
      { amplitude: 0.9, center: 109.782173, sigma: 0.15, tau: 0.5, knownLine: true, label: "C18O", transition: "J=1-0" },
      { amplitude: 2.2, center: 110.201354, sigma: 0.15, tau: 1.3, knownLine: true, label: "13CO", transition: "J=1-0" },
    ],
  }),
  kidsLevel({
    id: 10,
    track: "dust",
    name: { en: "The Brightest Line", de: "Die hellste Linie" },
    blurb: {
      en: "Carbon monoxide, the brightest radio line in the sky, and its small neighbour CN.",
      de: "Kohlenmonoxid, die hellste Radiolinie am Himmel, und sein kleiner Nachbar CN.",
    },
    xMin: 112.5,
    xMax: 118,
    trueLines: [
      { amplitude: 1.0, center: 113.490982, sigma: 0.2, tau: 0.6, knownLine: true, label: "CN", transition: "N=1-0" },
      { amplitude: 3.6, center: 115.271202, sigma: 0.22, tau: 4.0, knownLine: true, label: "CO", transition: "J=1-0" },
    ],
  }),
];

function levelById(id) {
  return LEVELS.find((lvl) => lvl.id === id) || null;
}

function levelTitle(level) {
  return t("level", { n: level.id }) + " · " + tx(level.name);
}

function levelBandLabel(level) {
  return level.xMin + "–" + level.xMax + " " + axisOf(level).unit;
}

/** Every science line can be fitted, plus two spare lines. */
function maxComponentsForLevel(level) {
  return scienceLinesOf(level.trueLines).length + 2;
}

/** Slider ranges follow the level; the width can't go below the spectrograph's resolution. */
function sliderRanges(level) {
  const lines = scienceLinesOf(level.trueLines);
  const sigmas = lines.map((l) => l.sigma);
  const range = level.xMax - level.xMin;
  const absorb = isAbsorption(level.mode);
  const amplitudeMax = absorb ? 1 : Math.max.apply(null, lines.map((l) => l.amplitude)) * 1.3;
  const resolution = levelResolution(level);
  const sigmaMin = Math.max(1e-4, Math.min(resolution.sigma * 0.8, Math.min.apply(null, sigmas) * 0.9));
  const sigmaMax = Math.max.apply(null, sigmas) * 3;
  return {
    amplitudeMin: absorb ? 0.01 : amplitudeMax / 100,
    amplitudeMax,
    amplitudeStep: amplitudeMax / 200,
    amplitudeFineStep: amplitudeMax / 100,
    sigmaMin,
    sigmaMax,
    sigmaStep: (sigmaMax - sigmaMin) / 200,
    sigmaFineStep: (sigmaMax - sigmaMin) / 100,
    centerStep: range / 1000,
    centerFineStep: range / 500,
  };
}

/** Starting values for a new line: a sensible guess, never the answer. */
function componentDefaults(level) {
  const lines = scienceLinesOf(level.trueLines);
  const amplitudes = lines.map((l) => l.amplitude).sort((a, b) => a - b);
  const sigmas = lines.map((l) => l.sigma).sort((a, b) => a - b);
  const mid = (arr) => arr[Math.floor(arr.length / 2)];
  return { amplitude: mid(amplitudes) || 1, sigma: mid(sigmas) || 0.3, tau: 1 };
}

function newComponent(level, id, center) {
  const defs = componentDefaults(level);
  return { id, amplitude: defs.amplitude, center, sigma: defs.sigma, tau: defs.tau, role: "science" };
}

/** The τ slider is logarithmic, so thin and saturated lines each get half of its travel. */
function tauToSlider(tau) {
  const clamped = Math.min(TAU_MAX, Math.max(TAU_MIN, tau || TAU_MIN));
  return (1000 * Math.log(clamped / TAU_MIN)) / Math.log(TAU_MAX / TAU_MIN);
}

function sliderToTau(sliderValue) {
  return TAU_MIN * Math.pow(TAU_MAX / TAU_MIN, sliderValue / 1000);
}

/** Kid words for how saturated a line is: thin lines are Gaussian, thick ones flatten out. */
function describeTau(tau, absorb) {
  if (tau < 0.3) return t("tauThin");
  if (tau < 1.5) return t("tauMid");
  if (tau < 6) return t("tauThick");
  return t("tauFull", { edge: t(absorb ? "edgeBottom" : "edgeTop") });
}

function formatAmplitude(level, v) {
  return isAbsorption(level.mode) ? Math.round(v * 100) + " %" : v.toFixed(1) + " K";
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

/** Smoothstep animation over `ms`; returns a cancel function. */
function animate(ms, onFrame, onDone) {
  const t0 = performance.now();
  let raf = 0;
  const step = (now) => {
    const f = Math.min(1, (now - t0) / ms);
    onFrame(f * f * (3 - 2 * f));
    if (f < 1) raf = requestAnimationFrame(step);
    else if (onDone) onDone();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

// ——— Shared UI bits ———

const h = (...args) => React.createElement(...args);

/** One parameter: name, value, a slider, and big (−)/(+) buttons for small steps. */
function ParamSlider(props) {
  const { label, display, min, max, step, fineStep, value, onChange } = props;
  const nudge = (delta) => onChange(Math.min(max, Math.max(min, value + delta)));
  return h(
    "div",
    { className: "slider-group" },
    h("div", { className: "slider-label" }, h("span", null, label), h("span", { className: "value" }, display)),
    h(
      "div",
      { className: "slider-row" },
      h(
        "button",
        { type: "button", className: "nudge-button", onClick: () => nudge(-fineStep), "aria-label": label + " – " + t("nudgeDown") },
        "−"
      ),
      h("input", {
        type: "range",
        className: "slider-input",
        min,
        max,
        step,
        value,
        "aria-label": label,
        onChange: (e) => {
          const v = parseFloat(e.target.value);
          if (isFinite(v)) onChange(v);
        },
      }),
      h(
        "button",
        { type: "button", className: "nudge-button", onClick: () => nudge(fineStep), "aria-label": label + " – " + t("nudgeUp") },
        "+"
      )
    )
  );
}

function LangToggle(props) {
  return h(
    "div",
    { className: "lang-toggle", role: "group", "aria-label": t("language") },
    ["en", "de"].map((l) =>
      h(
        "button",
        {
          key: l,
          type: "button",
          className: "lang-button" + (props.lang === l ? " active" : ""),
          "aria-pressed": props.lang === l,
          onClick: () => props.onChange(l),
        },
        l.toUpperCase()
      )
    )
  );
}

function LearnMore() {
  return h(
    "div",
    { className: "cdms-block" },
    h(
      "div",
      { className: "cdms-text" },
      h("div", { className: "panel-title" }, t("learnMore")),
      h("p", { className: "cdms-copy" }, t("learnMoreText")),
      h("a", { href: CDMS_URL, target: "_blank", rel: "noopener noreferrer", className: "cdms-link" }, CDMS_URL)
    ),
    h("img", { src: "./cdms-qr.png", alt: t("qrAlt"), className: "cdms-qr", width: 120, height: 120 })
  );
}

function StarsDisplay(props) {
  const n = props.stars || 0;
  return h(
    "span",
    { className: "stars", "aria-label": t("stars", { n }) },
    [1, 2, 3, 4, 5].map((i) => h("span", { key: i, className: i <= n ? "star on" : "star" }, "★"))
  );
}

function ModePill(props) {
  const absorb = isAbsorption(props.level.mode);
  return h("span", { className: "mode-pill " + (absorb ? "absorption" : "emission") }, t(absorb ? "absorption" : "emission"));
}

function LeaderboardPanel(props) {
  const board = props.board || {};
  return h(
    "div",
    { className: "panel leaderboard-panel" },
    h(
      "div",
      { className: "leaderboard-header" },
      h("div", { className: "panel-title" }, "🏆 ", t("leaderboard")),
      h("button", { type: "button", className: "secondary-button tiny-button", onClick: props.onReset }, t("resetLeaderboard"))
    ),
    h("p", { className: "leaderboard-intro" }, t("leaderboardIntro")),
    h(
      "div",
      { className: "leaderboard-levels" },
      LEVELS.map((lvl) => {
        const list = Array.isArray(board[String(lvl.id)]) ? board[String(lvl.id)] : [];
        return h(
          "div",
          { key: lvl.id, className: "leaderboard-level-block" },
          h("div", { className: "leaderboard-level-title" }, levelTitle(lvl)),
          list.length === 0
            ? h("p", { className: "leaderboard-empty" }, t("noScores"))
            : h(
                "ol",
                { className: "leaderboard-list" },
                list.map((entry, i) =>
                  h(
                    "li",
                    { key: entry.at + "-" + i },
                    h("span", { className: "lb-rank" }, i + 1, "."),
                    h("span", { className: "lb-name" }, entry.name),
                    h(StarsDisplay, { stars: entry.stars })
                  )
                )
              )
        );
      })
    )
  );
}

/** The attract-screen map: the Sun, then Earth's air, then space clouds. */
const CHAPTERS = [
  { key: "sun", emoji: "☀️", title: "chapterSun", desc: "chapterSunDesc", has: (l) => l.track === "solar" && !telluricLinesOf(l.trueLines).length },
  { key: "air", emoji: "🌍", title: "chapterAir", desc: "chapterAirDesc", has: (l) => l.track === "solar" && telluricLinesOf(l.trueLines).length > 0 },
  { key: "cloud", emoji: "☁️", title: "chapterCloud", desc: "chapterCloudDesc", has: (l) => l.track === "dust" },
];

/** Every level is playable from the start; the first unsolved one is marked as the next stop. */
function LevelPicker(props) {
  const board = props.board || {};
  const bestOf = (lvl) => (board[String(lvl.id)] || [])[0];
  const solved = (lvl) => bestOf(lvl) || (props.passedLevels && props.passedLevels.has(lvl.id));
  const next = LEVELS.find((lvl) => !solved(lvl));
  return h(
    "div",
    { className: "panel level-picker" },
    h("div", { className: "panel-title" }, "🗺️ ", t("journey")),
    h(
      "div",
      { className: "journey" },
      CHAPTERS.map((chapter) =>
        h(
          "div",
          { key: chapter.key, className: "journey-chapter" },
          h(
            "div",
            { className: "journey-chapter-title" },
            h("span", { className: "journey-chapter-emoji", "aria-hidden": true }, chapter.emoji),
            h("span", null, h("strong", null, t(chapter.title)), h("span", { className: "journey-chapter-desc" }, t(chapter.desc)))
          ),
          h(
            "div",
            { className: "journey-stops" },
            LEVELS.filter(chapter.has).map((lvl) => {
              const best = bestOf(lvl);
              return h(
                "button",
                {
                  key: lvl.id,
                  type: "button",
                  className: "map-stop" + (solved(lvl) ? " map-stop-played" : "") + (lvl === next ? " map-stop-next" : ""),
                  onClick: () => props.onPlay(LEVELS.indexOf(lvl)),
                },
                h("span", { className: "map-stop-dot" }, lvl.id),
                h("span", { className: "map-stop-name" }, tx(lvl.name)),
                best
                  ? h(StarsDisplay, { stars: best.stars })
                  : solved(lvl)
                  ? h("span", { className: "map-stop-label" }, "✓")
                  : lvl === next
                  ? h("span", { className: "map-stop-label" }, "📍 ", t("nextStop"))
                  : h("span", { className: "map-stop-label" }, t("notPlayed"))
              );
            })
          )
        )
      )
    )
  );
}

/** Every species as a sticker: collected ones show their character and fact, the rest a "?". */
function StickerBook(props) {
  const have = props.stickers || [];
  const labels = Object.keys(SPECIES);
  return h(
    "div",
    { className: "panel sticker-book" },
    h(
      "div",
      { className: "leaderboard-header" },
      h("div", { className: "panel-title" }, "📒 ", t("stickerBook")),
      h("span", { className: "sticker-count" }, t("stickerCount", { n: have.length, total: labels.length }))
    ),
    h("p", { className: "leaderboard-intro" }, t("stickerIntro")),
    h(
      "div",
      { className: "sticker-grid" },
      labels.map((label) => {
        const sp = SPECIES[label];
        const got = have.includes(label);
        return h(
          "div",
          { key: label, className: "sticker" + (got ? " sticker-got" : "") },
          h("span", { className: "sticker-emoji", "aria-hidden": true }, got ? sp.emoji : "❔"),
          h("strong", null, got ? tx(sp.nick) : "???"),
          got && h("span", { className: "sticker-name" }, tx(sp.name)),
          got && h("p", { className: "sticker-fact" }, tx(sp.fact))
        );
      })
    )
  );
}

/** Specky the detective: a face and a speech bubble. Re-keying replays the little bounce. */
function Mascot(props) {
  return h(
    "div",
    { className: "mascot" },
    h("span", { key: props.face + props.text, className: "mascot-face", "aria-hidden": true }, props.face),
    h("p", { className: "mascot-bubble", role: "status" }, h("strong", null, t("mascotName"), ": "), props.text)
  );
}

/** Warmer / colder: "hot" exactly when the line would pass, then by distance as a share of the window. */
function heatOf(level, center) {
  const lines = scienceLinesOf(level.trueLines);
  if (lines.some((l) => (Math.abs(l.center - center) / l.center) * 100 <= level.errorThresholdPercent)) return "hot";
  const d = Math.min.apply(null, lines.map((l) => Math.abs(l.center - center))) / (level.xMax - level.xMin);
  return d <= 0.08 ? "warm" : d <= 0.2 ? "cool" : "cold";
}

function newQuizRound() {
  const level = LEVELS[Math.floor(Math.random() * LEVELS.length)];
  const lines = level.trueLines;
  // Only a line whose species appears once can be the answer, or two markers would both be right.
  const unique = lines.map((l, i) => i).filter((i) => lines.filter((o) => o.label === lines[i].label).length === 1);
  return { levelId: level.id, target: unique[Math.floor(Math.random() * unique.length)], tried: [], solved: false };
}

/** Mini-game: hear one line's note (same two-octave mapping as the level) and tap which line sang it. */
function QuizScreen(props) {
  const [round, setRound] = React.useState(newQuizRound);
  const [score, setScore] = React.useState({ right: 0, total: 0 });
  const [msg, setMsg] = React.useState("");
  const level = levelById(round.levelId);
  const markers = level.trueLines;
  const notes = React.useMemo(() => sonifyAxisValues(markers.map((l) => l.center), level).audibleHz, [level]);
  const solar = level.track === "solar";
  const axis = axisOf(level);
  // Five ticks across the window, each labelled with the light (nm / GHz) and the note it becomes (Hz).
  const ticks = React.useMemo(() => {
    const fs = [0, 0.25, 0.5, 0.75, 1];
    const values = fs.map((f) => level.xMin + f * (level.xMax - level.xMin));
    const hz = sonifyAxisValues(values, level).audibleHz;
    return fs.map((f, i) => ({ f, light: values[i], hz: hz[i] }));
  }, [level]);

  React.useEffect(() => () => stopAllAudio(), []);

  function playNote(i) {
    stopAllAudio();
    playTone(notes[i], 1.2, props.muted);
  }

  function guess(i) {
    if (round.solved || i === round.target) {
      if (!round.solved) {
        setScore((sc) => ({ right: sc.right + (round.tried.length ? 0 : 1), total: sc.total + 1 }));
        setRound({ ...round, solved: true });
        setMsg(t("quizRight", { name: tx(SPECIES[markers[i].label].nick) }));
        playSfx("win");
      } else playNote(i);
      return;
    }
    setRound({ ...round, tried: round.tried.concat(i) });
    setMsg(t("quizWrong"));
    playNote(i);
  }

  const stripStyle = solar
    ? {
        background:
          "linear-gradient(to right, " +
          [0, 0.25, 0.5, 0.75, 1]
            .map((f) => "rgba(" + wavelengthToRgb(level.xMin + f * (level.xMax - level.xMin)).join(",") + ",0.55)")
            .join(", ") +
          ")",
      }
    : null;

  return h(
    "main",
    null,
    h(
      "div",
      { className: "panel quiz-panel" },
      h("div", { className: "panel-title modal-title" }, "🎵 ", t("quizTitle")),
      h(Mascot, { face: round.solved ? "🤩" : "🕵️", text: msg || t("quizIntro") }),
      h("p", { className: "step-text" }, levelTitle(level), " — ", t(solar ? "quizHintSolar" : "quizHintRadio")),
      props.muted
        ? h("p", { className: "phase-lock-hint" }, t("quizMuted"))
        : h("button", { type: "button", className: "primary-button large-button", onClick: () => playNote(round.target) }, t("quizPlay")),
      h(
        "div",
        { className: "quiz-strip" + (solar ? "" : " quiz-strip-radio"), style: stripStyle },
        markers.map((line, i) =>
          h(
            "button",
            {
              key: i,
              type: "button",
              className:
                "quiz-marker" +
                (i % 2 ? " quiz-marker-low" : "") +
                (round.tried.includes(i) ? " quiz-marker-wrong" : "") +
                (round.solved && i === round.target ? " quiz-marker-right" : ""),
              style: { left: ((line.center - level.xMin) / (level.xMax - level.xMin)) * 100 + "%" },
              disabled: props.muted,
              onClick: () => guess(i),
            },
            h("span", { className: "quiz-marker-emoji", "aria-hidden": true }, SPECIES[line.label].emoji),
            h("span", { className: "quiz-marker-name" }, tx(SPECIES[line.label].nick)),
            round.solved && h("span", { className: "quiz-tick-sound" }, Math.round(notes[i]) + " Hz")
          )
        )
      ),
      h(
        "div",
        { className: "quiz-axis", "aria-hidden": true },
        ticks.map((tick) =>
          h(
            "span",
            { key: tick.f, className: "quiz-tick", style: { left: tick.f * 100 + "%" } },
            h("span", { className: "quiz-tick-light" }, tick.light.toFixed(axis.key === "nm" ? 1 : 2)),
            h("span", { className: "quiz-tick-sound" }, Math.round(tick.hz))
          )
        )
      ),
      h(
        "div",
        { className: "quiz-axis-titles" },
        h("span", { className: "quiz-tick-light" }, "▲ ", t(axis.key === "nm" ? "axisNm" : "axisGHz")),
        h("span", { className: "quiz-tick-sound" }, "▼ ", t("quizAxisSound"))
      ),
      h("p", { className: "step-text" }, t("quizScore", { n: score.right, total: score.total })),
      round.solved &&
        h(
          "button",
          {
            type: "button",
            className: "primary-button large-button",
            onClick: () => {
              stopAllAudio();
              setRound(newQuizRound());
              setMsg("");
            },
          },
          t("quizNext")
        )
    )
  );
}

function AttractScreen(props) {
  return h(
    "div",
    { className: "attract-screen" },
    h(
      "div",
      { className: "attract-hero panel" },
      h("h1", { className: "attract-title" }, "🔭 ", t("appTitle")),
      h("p", { className: "attract-tagline" }, t("tagline")),
      h(
        "ol",
        { className: "attract-howto" },
        ["howto1", "howto2", "howto3", "howto4"].map((k) => h("li", { key: k }, t(k)))
      ),
      h(
        "div",
        { className: "attract-actions" },
        h("button", { type: "button", className: "primary-button large-button", onClick: props.onStart }, t("start")),
        h("button", { type: "button", className: "secondary-button large-button", onClick: props.onQuiz }, t("quizStart")),
        h("span", { className: "attract-actions-hint" }, t("orPick"))
      )
    ),
    h(LevelPicker, { board: props.board, passedLevels: props.passedLevels, onPlay: props.onPlayLevel }),
    h(StickerBook, { stickers: props.stickers }),
    h(LeaderboardPanel, { board: props.board, onReset: props.onResetLeaderboard }),
    h(LearnMore)
  );
}

// ——— Game view ———

/** Faint rainbow behind the solar plots, so kids see which colour of light a line sits in. */
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
      const f = i / steps;
      const rgb = wavelengthToRgb(xScale.min + f * (xScale.max - xScale.min));
      gradient.addColorStop(f, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.22)");
    }
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
    ctx.restore();
  },
};

const COMPONENT_COLORS = [
  "rgba(248, 113, 113, 0.95)",
  "rgba(251, 191, 36, 0.95)",
  "rgba(196, 181, 253, 0.95)",
  "rgba(244, 114, 182, 0.95)",
  "rgba(129, 230, 217, 0.95)",
];

/** Colour follows the line's own number, so removing one never recolours the rest. */
function componentColor(component) {
  const n = component && component.id ? component.id - 1 : 0;
  return COMPONENT_COLORS[n % COMPONENT_COLORS.length];
}

/**
 * One level: (1) the computer fits the continuum and Earth's atmosphere while the kids watch,
 * (2) it removes them with an animated before→after, (3) the kids place their own lines.
 */
function SpectrumGameView(props) {
  const { level, lang, onCompletion } = props;
  const absorb = isAbsorption(level.mode);
  const axis = axisOf(level);
  const scienceTruth = React.useMemo(() => scienceLinesOf(level.trueLines), [level]);
  const telluricTruth = React.useMemo(() => telluricLinesOf(level.trueLines), [level]);
  const ranges = React.useMemo(() => sliderRanges(level), [level]);
  const coarseX = React.useMemo(() => linspace(level.xMin, level.xMax, 500), [level]);
  const maxComponents = maxComponentsForLevel(level);
  const [spectrum] = React.useState(() => generateSpectrum(level));
  const [continuumFit, setContinuumFit] = React.useState(() => continuumDefaults(level));
  const [telluricComponents, setTelluricComponents] = React.useState(() => seedTelluricComponents(level));
  /** "look" → "fitting" → "fitted" → "removed" */
  const [bgStep, setBgStep] = React.useState("look");
  /** 0 = raw spectrum, 1 = background divided out (absorption) or subtracted (emission). */
  const [mix, setMix] = React.useState(0);
  const [components, setComponents] = React.useState([]);
  const [selectedId, setSelectedId] = React.useState(null);
  const [chartCanvas, setChartCanvas] = React.useState(null);
  const chartRef = React.useRef(null);
  const chartSignatureRef = React.useRef("");
  const clickHandlerRef = React.useRef(() => {});
  const cancelAnimRef = React.useRef(null);
  const linesOpen = bgStep === "removed";

  React.useEffect(() => () => cancelAnimRef.current && cancelAnimRef.current(), []);

  const baselineModelY = React.useMemo(
    () => composeSpectrum(spectrum.x, telluricComponents, continuumFit, level.mode, level.xMin, level.xMax),
    [spectrum.x, telluricComponents, continuumFit, level]
  );
  const modelY = React.useMemo(
    () =>
      composeSpectrum(spectrum.x, telluricComponents.concat(components), continuumFit, level.mode, level.xMin, level.xMax),
    [spectrum.x, telluricComponents, components, continuumFit, level]
  );
  const fitPct = React.useMemo(
    () => (components.length ? normalizedFitPercent(spectrum.y, modelY) : NaN),
    [components.length, spectrum.y, modelY]
  );

  function startAnimation(ms, onFrame, onDone) {
    if (cancelAnimRef.current) cancelAnimRef.current();
    cancelAnimRef.current = animate(ms, onFrame, onDone);
  }

  function handleFitBackground() {
    setBgStep("fitting");
    // Let the "thinking" label paint before the (short) search blocks the thread.
    setTimeout(() => {
      const startC = continuumFit;
      const startT = telluricComponents;
      const result = autoFitBaseline(spectrum, level, startC, startT);
      startAnimation(
        2200,
        (f) => {
          setContinuumFit(lerpParams(startC, result.continuum, f));
          setTelluricComponents(startT.map((c, i) => lerpParams(c, result.tellurics[i], f)));
        },
        () => setBgStep("fitted")
      );
    }, 50);
  }

  function animateMixTo(target) {
    const from = mix;
    startAnimation(1200, (f) => setMix(from + (target - from) * f));
  }

  function handleRemoveBackground() {
    setBgStep("removed");
    animateMixTo(1);
    if (!components.length) {
      setComponents([newComponent(level, 1, (level.xMin + level.xMax) / 2)]);
      setSelectedId(1);
    }
  }

  function handleAddComponent() {
    if (!linesOpen || components.length >= maxComponents) return;
    const nextId = components.length ? Math.max.apply(null, components.map((c) => c.id)) + 1 : 1;
    const span = level.xMax - level.xMin;
    const center = (level.xMin + level.xMax) / 2 + ((components.length % 5) - 2) * span * 0.05;
    setComponents([newComponent(level, nextId, center)].concat(components));
    setSelectedId(nextId);
  }

  function handleRemoveComponent(id) {
    const next = components.filter((c) => c.id !== id);
    setComponents(next);
    if (id === selectedId) setSelectedId(next.length ? next[0].id : null);
  }

  function handleUpdateComponent(id, field, value) {
    setComponents((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }

  function handleReset() {
    if (cancelAnimRef.current) cancelAnimRef.current();
    setContinuumFit(continuumDefaults(level));
    setTelluricComponents(seedTelluricComponents(level));
    setBgStep("look");
    setMix(0);
    setComponents([]);
    setSelectedId(null);
  }

  function handleSubmit() {
    const lineErrors = computeLineErrors(scienceTruth, components);
    const meanErr = meanPercentError(lineErrors);
    const withinCount = countLinesWithin(lineErrors, level.errorThresholdPercent);
    const fittedCenters = lineErrors.map((le) => (le.matchedGaussian ? le.matchedGaussian.center : null));
    onCompletion({
      levelId: level.id,
      lineErrors,
      meanErr,
      mse: meanSquaredError(spectrum.y, modelY),
      stars: starsFromMeanError(meanErr, starBandsForLevel(level)),
      sonification: sonifyAxisValues(fittedCenters, level),
      passed: withinCount === scienceTruth.length,
      withinCount,
      gradedCount: scienceTruth.length,
      thresholdPercent: level.errorThresholdPercent,
    });
  }

  function buildDatasets() {
    const blend = (raw, removed) => (mix === 0 ? raw : raw.map((v, i) => v + (removed[i] - v) * mix));
    const removeBg = (ys) =>
      absorb ? ys.map((v, i) => (baselineModelY[i] > 0 ? v / baselineModelY[i] : NaN)) : ys.map((v, i) => v - baselineModelY[i]);
    const toPoints = (xs, ys) => xs.map((xi, i) => ({ x: xi, y: ys[i] }));
    const nearAtmosphere = (xi) => telluricTruth.some((line) => Math.abs(xi - line.center) <= line.sigma * 4);
    const observedY = blend(spectrum.y, removeBg(spectrum.y));
    const datasets = [
      {
        label: t(mix > 0.5 ? "observedRemoved" : "observed"),
        data: spectrum.x.map((xi, i) => ({ x: xi, y: nearAtmosphere(xi) ? NaN : observedY[i] })),
        borderColor: "rgba(96, 165, 250, 1)",
        borderWidth: 1.6,
        pointRadius: 0,
        spanGaps: false,
      },
    ];
    if (telluricTruth.length) {
      datasets.push({
        label: t("atmosphereData"),
        data: spectrum.x.map((xi, i) => ({ x: xi, y: nearAtmosphere(xi) ? observedY[i] : NaN })),
        borderColor: TELLURIC_COLOR,
        borderWidth: 2.4,
        pointRadius: 0,
        spanGaps: false,
      });
    }
    datasets.push({
      label: t("background"),
      data: toPoints(spectrum.x, blend(baselineModelY, removeBg(baselineModelY))),
      borderColor: "rgba(203, 213, 225, 0.9)",
      borderWidth: 2,
      borderDash: [6, 5],
      pointRadius: 0,
    });
    if (linesOpen && components.length) {
      datasets.push({
        label: t("yourModel"),
        data: toPoints(spectrum.x, blend(modelY, removeBg(modelY))),
        borderColor: "rgba(52, 211, 153, 1)",
        borderWidth: 2.2,
        pointRadius: 0,
      });
      const coarseCont = evaluateContinuum(coarseX, continuumFit, level.xMin, level.xMax);
      components.forEach((component) => {
        const alone = absorb ? lineTransmission(coarseX, component) : evaluateLineProfile(coarseX, component);
        const onCont = alone.map((v, i) => (absorb ? coarseCont[i] * v : coarseCont[i] + v));
        datasets.push({
          label: t("lineN", { n: component.id }),
          data: toPoints(coarseX, blend(onCont, alone)),
          borderColor: componentColor(component),
          borderWidth: component.id === selectedId ? 2.6 : 1.4,
          hideInLegend: true,
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
      if (!linesOpen || selectedId == null || !chart || !chart.scales.x) return;
      const value = chart.scales.x.getValueForPixel(evt.x);
      if (value == null || !isFinite(value)) return;
      handleUpdateComponent(selectedId, "center", Math.min(level.xMax, Math.max(level.xMin, value)));
    };
  });

  React.useEffect(() => {
    if (!chartCanvas || typeof Chart !== "function") return;
    const signature = level.id + "|" + lang;
    if (chartRef.current && chartSignatureRef.current !== signature) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    const yTitle = t(mix > 0.5 ? "yRemoved" : "yRaw");
    if (!chartRef.current) {
      chartRef.current = new Chart(chartCanvas.getContext("2d"), {
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
            legend: {
              labels: {
                color: "#e5e5ff",
                boxWidth: 14,
                font: { size: 13 },
                filter: (item, data) => !data.datasets[item.datasetIndex].hideInLegend,
              },
            },
            tooltip: { enabled: false },
          },
          scales: {
            x: {
              type: "linear",
              min: level.xMin,
              max: level.xMax,
              ticks: { color: "#a5b4fc", maxTicksLimit: 8, font: { size: 13 } },
              title: { display: true, text: t(axis.key === "nm" ? "axisNm" : "axisGHz"), color: "#e5e5ff", font: { size: 14 } },
            },
            y: {
              type: "linear",
              beginAtZero: true,
              ticks: { color: "#a5b4fc", font: { size: 13 } },
              title: { display: true, text: yTitle, color: "#e5e5ff", font: { size: 14 } },
            },
          },
        },
      });
      chartSignatureRef.current = signature;
      chartCanvas.style.cursor = "crosshair";
    } else {
      chartRef.current.data.datasets = buildDatasets();
      chartRef.current.options.scales.y.title.text = yTitle;
      chartRef.current.update("none");
    }
  }, [chartCanvas, level, lang, spectrum, modelY, baselineModelY, components, selectedId, mix, linesOpen]);

  React.useEffect(
    () => () => {
      if (chartRef.current) chartRef.current.destroy();
      chartRef.current = null;
    },
    []
  );

  const liveErrors = React.useMemo(() => computeLineErrors(scienceTruth, components), [scienceTruth, components]);
  const liveWithin = countLinesWithin(liveErrors, level.errorThresholdPercent);
  const ready = linesOpen && liveWithin === scienceTruth.length;
  const fitQuality = describeFitQuality(fitPct);
  const nLines = scienceTruth.length;

  const prevWithinRef = React.useRef(0);
  React.useEffect(() => {
    if (liveWithin > prevWithinRef.current) playSfx("ding");
    prevWithinRef.current = liveWithin;
  }, [liveWithin]);

  const mascot =
    bgStep === "look"
      ? { face: "🕵️", text: t("mascotHello") }
      : bgStep === "fitting"
      ? { face: "🤖", text: t("mascotFitting") }
      : bgStep === "fitted"
      ? { face: "😃", text: t("mascotFitted") }
      : ready
      ? { face: "🤩", text: t("mascotReady") }
      : liveWithin > 0
      ? { face: "😃", text: t("mascotSome", { n: liveWithin }) }
      : { face: "🕵️", text: t(absorb ? "mascotStartAbs" : "mascotStartEm") };

  const step1 = h(
    "div",
    { className: "panel step-panel" + (linesOpen ? " step-done" : "") },
    h("div", { className: "panel-title" }, t("step1"), linesOpen ? " ✓" : ""),
    h("p", { className: "step-text" }, t(level.track === "solar" ? "bgExplainSolar" : "bgExplainDust")),
    telluricTruth.length > 0 && h("p", { className: "step-text step-atmos" }, t("bgExplainAtmos")),
    bgStep === "look" &&
      h("button", { type: "button", className: "primary-button large-button", onClick: handleFitBackground }, t("fitBg")),
    bgStep === "fitting" &&
      h("button", { type: "button", className: "primary-button large-button thinking", disabled: true }, t("fitting")),
    bgStep === "fitted" &&
      h(
        React.Fragment,
        null,
        h("p", { className: "step-text step-good" }, t("bgFitted")),
        h("button", { type: "button", className: "primary-button large-button", onClick: handleRemoveBackground }, t("removeBg"))
      ),
    linesOpen && h("p", { className: "step-text step-good" }, t("removed"))
  );

  const step2 = h(
    "div",
    { className: "panel step-panel fit-panel" + (linesOpen ? "" : " step-locked") },
    h(
      "div",
      { className: "controls-header" },
      h("span", { className: "panel-title" }, t("step2")),
      linesOpen &&
        h(
          "div",
          { className: "controls-header-right" },
          h("span", { className: "count-label" }, t("linesCount", { n: components.length, max: maxComponents })),
          h(
            "button",
            { type: "button", className: "secondary-button", onClick: handleAddComponent, disabled: components.length >= maxComponents },
            t("addLine")
          )
        )
    ),
    !linesOpen && h("p", { className: "phase-lock-hint" }, t("locked")),
    linesOpen && h("p", { className: "step-text" }, t("clickHint")),
    linesOpen &&
      h(
        "div",
        { className: "component-list component-grid" },
        components.map((component) =>
          h(
            "div",
            {
              key: component.id,
              className: "gaussian-row" + (component.id === selectedId ? " gaussian-row-selected" : ""),
              onClick: () => setSelectedId(component.id),
            },
            h(
              "div",
              { className: "gaussian-row-header" },
              h(
                "span",
                null,
                h("span", { className: "component-swatch", style: { background: componentColor(component) } }),
                t("lineN", { n: component.id }),
                component.id === selectedId ? h("span", { className: "selected-tag" }, t("selected")) : null,
                (() => {
                  const heat = heatOf(level, component.center);
                  return h("span", { className: "heat heat-" + heat }, t(heat));
                })()
              ),
              components.length > 1 &&
                h(
                  "button",
                  {
                    type: "button",
                    className: "secondary-button tiny-button remove-line-button",
                    onClick: (e) => {
                      e.stopPropagation();
                      handleRemoveComponent(component.id);
                    },
                  },
                  t("removeLine")
                )
            ),
            h(ParamSlider, {
              label: t("where"),
              display: formatAxisValue(component.center, axis.key) + " " + axis.unit,
              min: level.xMin,
              max: level.xMax,
              step: ranges.centerStep,
              fineStep: ranges.centerFineStep,
              value: component.center,
              onChange: (v) => handleUpdateComponent(component.id, "center", v),
            }),
            h(ParamSlider, {
              label: t(absorb ? "howDeep" : "howBright"),
              display: formatAmplitude(level, component.amplitude),
              min: ranges.amplitudeMin,
              max: ranges.amplitudeMax,
              step: ranges.amplitudeStep,
              fineStep: ranges.amplitudeFineStep,
              value: component.amplitude,
              onChange: (v) => handleUpdateComponent(component.id, "amplitude", v),
            }),
            h(ParamSlider, {
              label: t("howWide"),
              display: component.sigma.toFixed(2) + " " + axis.unit,
              min: ranges.sigmaMin,
              max: ranges.sigmaMax,
              step: ranges.sigmaStep,
              fineStep: ranges.sigmaFineStep,
              value: component.sigma,
              onChange: (v) => handleUpdateComponent(component.id, "sigma", v),
            }),
            h(ParamSlider, {
              label: t("howFull"),
              display: component.tau.toFixed(1) + " · " + describeTau(component.tau, absorb),
              min: 0,
              max: 1000,
              step: 1,
              fineStep: 20,
              value: tauToSlider(component.tau),
              onChange: (v) => handleUpdateComponent(component.id, "tau", sliderToTau(v)),
            })
          )
        )
      ),
    linesOpen &&
      h(
        "p",
        { className: "submit-check " + (ready ? "submit-check-ready" : "submit-check-pending") },
        t("foundCount", { n: liveWithin, total: nLines }),
        t(ready ? "readyToCheck" : "keepGoing")
      ),
    h(
      "div",
      { className: "button-row" },
      h("button", { type: "button", className: "secondary-button", onClick: handleReset }, t("reset")),
      h(
        "button",
        { type: "button", className: "primary-button large-button", onClick: handleSubmit, disabled: !linesOpen || !components.length },
        t("check")
      )
    )
  );

  return h(
    "div",
    { className: "game-layout" },
    h(
      "div",
      { className: "panel plot-panel" },
      h(
        "div",
        { className: "plot-header" },
        h("div", { className: "panel-title" }, levelTitle(level)),
        h(
          "div",
          { className: "plot-header-right" },
          h(ModePill, { level }),
          linesOpen &&
            h(
              "button",
              {
                type: "button",
                className: "secondary-button",
                onClick: () => animateMixTo(mix > 0.5 ? 0 : 1),
                "aria-pressed": mix > 0.5,
              },
              t(mix > 0.5 ? "before" : "after")
            )
        )
      ),
      h("p", { className: "level-blurb" }, tx(level.blurb)),
      h("div", { className: "plot-wrap" }, h("canvas", { ref: setChartCanvas, className: "plot-canvas" })),
      linesOpen &&
        h("div", { className: "fit-quality " + fitQuality.cls }, t("fitQuality", { label: fitQuality.label })),
      h(
        "div",
        { className: "info-pills" },
        h("div", { className: "metric-pill" }, nLines === 1 ? t("lineToFind") : t("linesToFind", { n: nLines })),
        h("div", { className: "metric-pill" }, levelBandLabel(level))
      )
    ),
    h("div", { className: "controls-column" }, h(Mascot, mascot), step1, step2)
  );
}

/** A burst of CSS confetti for a solved level. */
function Confetti() {
  const pieces = React.useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: Math.random() * 100 + "%",
        animationDelay: Math.random() * 0.8 + "s",
        background: COMPONENT_COLORS[i % COMPONENT_COLORS.length],
        transform: "rotate(" + Math.round(Math.random() * 360) + "deg)",
      })),
    []
  );
  return h(
    "div",
    { className: "confetti", "aria-hidden": true },
    pieces.map((style, i) => h("span", { key: i, style }))
  );
}

// ——— App ———

function App() {
  const [lang, setLangState] = React.useState(LANG);
  const [screen, setScreen] = React.useState("attract");
  const [levelIndex, setLevelIndex] = React.useState(0);
  const [attempt, setAttempt] = React.useState(0);
  const [passedLevels, setPassedLevels] = React.useState(() => new Set());
  const [modal, setModal] = React.useState(null);
  const [muted, setMuted] = React.useState(false);
  const [volume, setVolume] = React.useState(0.85);
  const [leaderboard, setLeaderboard] = React.useState(() => loadLeaderboard());
  const [stickers, setStickers] = React.useState(() => loadStickers());
  const [playerName, setPlayerName] = React.useState("");
  const [leaderboardMsg, setLeaderboardMsg] = React.useState("");
  const [audioStatus, setAudioStatus] = React.useState("");
  const idleTimerRef = React.useRef(null);

  React.useEffect(() => setLang(lang), [lang]);

  // t() reads the module-level LANG while rendering, so it must change before the re-render.
  function changeLang(l) {
    setLang(l);
    setLangState(l);
  }
  React.useEffect(() => setMasterMuted(muted), [muted]);
  React.useEffect(() => setMasterVolume(volume), [volume]);

  function clearModal() {
    stopAllAudio();
    setModal(null);
    setPlayerName("");
    setLeaderboardMsg("");
    setAudioStatus("");
  }

  const resetIdle = React.useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      clearModal();
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
    if (window.confirm(t("resetConfirm"))) {
      setLeaderboard(clearLeaderboard());
      setStickers([]);
    }
  }

  function goToLevel(idx) {
    clearModal();
    // Unlock audio on this click, but never wait for it: resume() can stay pending forever.
    ensureAudioReady();
    setLevelIndex(LEVELS[idx] ? idx : 0);
    setAttempt((a) => a + 1);
    setScreen("play");
  }

  function handleLevelCompleted(summary) {
    let newStickers = [];
    if (summary.passed) {
      setPassedLevels((prev) => new Set(prev).add(summary.levelId));
      const got = addStickers(levelSpecies(levelById(summary.levelId)));
      setStickers(got.all);
      newStickers = got.fresh;
    }
    clearModal();
    playSfx(summary.passed ? "win" : "miss");
    setModal({ ...summary, newStickers });
  }

  function handleSaveToLeaderboard() {
    if (!sanitizePlayerName(playerName)) {
      setLeaderboardMsg(t("enterName", { max: MAX_NAME_LEN }));
      return;
    }
    const result = saveLeaderboardEntry(modal.levelId, playerName, modal.mse, modal.meanErr, modal.stars);
    setLeaderboard(result.board);
    setLeaderboardMsg(
      result.accepted ? t("saved", { rank: result.rank, level: modal.levelId }) : t("notTop", { n: LEADERBOARD_TOP_N })
    );
  }

  async function playLine(idx) {
    stopAllAudio();
    const ok = await playTone(modal.sonification.audibleHz[idx], 1.2, muted);
    setAudioStatus(t(ok ? "playing" : "audioBlocked"));
  }

  async function playAll() {
    const ok = await playChord(modal.sonification.audibleHz, 1.8, muted);
    setAudioStatus(t(ok ? "playing" : "audioBlocked"));
  }

  const currentLevel = LEVELS[levelIndex];
  const modalLevel = modal ? levelById(modal.levelId) : null;
  const modalAxis = modalLevel ? axisOf(modalLevel) : AXES.nm;
  const facts = modalLevel ? levelSpecies(modalLevel) : [];
  const modalMascot = !modal
    ? null
    : !modal.passed
    ? { face: "🤔", text: t("mascotFailed") }
    : modal.stars >= 5
    ? { face: "🤩", text: t("mascotStars5") }
    : modal.stars >= 3
    ? { face: "😄", text: t("mascotStars3") }
    : { face: "🙂", text: t("mascotStars1") };

  const header = h(
    "header",
    { className: "app-header" },
    h("div", { className: "title" }, screen === "attract" ? "" : "🔭 " + t("appTitle")),
    h(
      "div",
      { className: "header-right" },
      screen === "play" &&
        h(
          "div",
          { className: "level-select" },
          TRACKS.map((track) =>
            h(
              "div",
              { key: track.key, className: "level-group" },
              h("span", { className: "level-group-label" }, t(track.label)),
              LEVELS.filter((lvl) => lvl.track === track.key).map((lvl) => {
                const idx = LEVELS.indexOf(lvl);
                return h(
                  "button",
                  {
                    key: lvl.id,
                    type: "button",
                    title: levelTitle(lvl),
                    className:
                      "level-button" + (idx === levelIndex ? " active" : "") + (passedLevels.has(lvl.id) ? " completed" : ""),
                    onClick: () => goToLevel(idx),
                  },
                  lvl.id,
                  passedLevels.has(lvl.id) ? " ✓" : ""
                );
              })
            )
          )
        ),
      h(LangToggle, { lang, onChange: changeLang }),
      h(
        "label",
        { className: "volume-control" },
        h("span", null, t("vol")),
        h("input", {
          type: "range",
          min: 0,
          max: 100,
          value: Math.round(volume * 100),
          className: "volume-slider",
          disabled: muted,
          onChange: (e) => setVolume(parseInt(e.target.value, 10) / 100),
          "aria-label": t("volume"),
        })
      ),
      h(
        "button",
        { type: "button", className: "secondary-button mute-button", onClick: () => setMuted((m) => !m), "aria-pressed": muted },
        t(muted ? "unmute" : "mute")
      ),
      (screen === "play" || screen === "quiz") &&
        h(
          "button",
          {
            type: "button",
            className: "secondary-button",
            onClick: () => {
              clearModal();
              setScreen("attract");
            },
          },
          t("home")
        )
    )
  );

  const modalView =
    modal &&
    h(
      "div",
      { className: "modal-backdrop" },
      modal.passed && h(Confetti),
      h(
        "div",
        { className: "modal-content modal-content-wide" },
        h("div", { className: "panel-title modal-title" }, t(modal.passed ? "greatJob" : "almost")),
        h(Mascot, modalMascot),
        h(
          "p",
          { className: "modal-lead" },
          modal.passed
            ? t("passedLead", { n: modal.levelId, name: tx(modalLevel.name) })
            : t("failedLead", { n: modal.withinCount, total: modal.gradedCount })
        ),
        modal.passed && h("div", { className: "modal-score-row" }, h(StarsDisplay, { stars: modal.stars })),
        h(
          "div",
          { className: "modal-table-wrap" },
          h(
            "table",
            { className: "lines-table modal-lines-table" },
            h(
              "thead",
              null,
              h(
                "tr",
                null,
                h("th", null, t("theLine")),
                modal.passed && h("th", null, t("realPlace")),
                h("th", null, t("yourPlace")),
                h("th", null, t("ok")),
                modal.passed && h("th", null, t("hear"))
              )
            ),
            h(
              "tbody",
              null,
              modal.lineErrors.map((le, idx) =>
                h(
                  "tr",
                  { key: idx },
                  h("td", null, lineSpeciesLabel(le.line)),
                  modal.passed && h("td", null, formatAxisValue(le.line.center, modalAxis.key) + " " + modalAxis.unit),
                  h(
                    "td",
                    null,
                    le.matchedGaussian ? formatAxisValue(le.matchedGaussian.center, modalAxis.key) + " " + modalAxis.unit : "—"
                  ),
                  h("td", { className: "ok-cell" }, lineWithinThreshold(le, modal.thresholdPercent) ? "✅" : "❌"),
                  modal.passed &&
                    h(
                      "td",
                      null,
                      h(
                        "button",
                        { type: "button", className: "secondary-button tiny-button", onClick: () => playLine(idx), disabled: muted },
                        t("play")
                      )
                    )
                )
              )
            )
          )
        ),
        modal.passed &&
          h(
            "div",
            { className: "sonify-panel" },
            h(
              "div",
              { className: "sonify-header" },
              h("strong", null, t("hearYourFit")),
              h("button", { type: "button", className: "primary-button", onClick: playAll, disabled: muted }, t("playAll"))
            ),
            h("p", { className: "sonify-scale" }, describeSonifyRule(modal.sonification)),
            audioStatus && h("p", { className: "audio-status" }, audioStatus)
          ),
        modal.passed &&
          facts.length > 0 &&
          h(
            "div",
            { className: "fact-cards" },
            h("div", { className: "panel-title" }, t("facts")),
            facts.map((label) =>
              h(
                "div",
                { key: label, className: "fact-card" + (modal.newStickers.includes(label) ? " fact-card-new" : "") },
                h("span", { className: "sticker-emoji", "aria-hidden": true }, SPECIES[label].emoji),
                h("strong", null, tx(SPECIES[label].nick), " · ", tx(SPECIES[label].name)),
                modal.newStickers.includes(label) && h("span", { className: "new-sticker" }, t("newSticker")),
                h("p", null, tx(SPECIES[label].fact))
              )
            )
          ),
        modal.passed &&
          h(
            "div",
            { className: "name-save-row" },
            h(
              "label",
              { className: "name-label" },
              t("yourName"),
              h("input", {
                type: "text",
                className: "name-input",
                maxLength: MAX_NAME_LEN,
                placeholder: t("yourName"),
                value: playerName,
                onChange: (e) => setPlayerName(e.target.value),
              })
            ),
            h("button", { type: "button", className: "primary-button", onClick: handleSaveToLeaderboard }, t("saveName"))
          ),
        modal.passed && leaderboardMsg && h("p", { className: "leaderboard-msg" }, leaderboardMsg),
        h(
          "div",
          { className: "modal-actions" },
          h(
            "button",
            {
              type: "button",
              className: "secondary-button",
              onClick: () => {
                clearModal();
                setScreen("exit");
              },
            },
            t("exit")
          ),
          modal.passed
            ? h(
                "button",
                {
                  type: "button",
                  className: "primary-button large-button",
                  onClick: () => {
                    if (levelIndex + 1 < LEVELS.length) goToLevel(levelIndex + 1);
                    else {
                      clearModal();
                      setScreen("attract");
                    }
                  },
                },
                t(levelIndex + 1 < LEVELS.length ? "nextLevel" : "lastLevel")
              )
            : h("button", { type: "button", className: "primary-button large-button", onClick: clearModal }, t("tryAgain"))
        )
      )
    );

  return h(
    "div",
    { className: "app-shell kiosk" },
    header,
    screen === "attract" &&
      h(AttractScreen, {
        onStart: () => goToLevel(0),
        onPlayLevel: goToLevel,
        onQuiz: () => {
          ensureAudioReady();
          setScreen("quiz");
        },
        board: leaderboard,
        passedLevels,
        stickers,
        onResetLeaderboard: handleResetLeaderboard,
      }),
    screen === "exit" &&
      h(
        "main",
        null,
        h(
          "div",
          { className: "panel exit-panel" },
          h("div", { className: "panel-title" }, t("thanks")),
          h("p", { className: "exit-copy" }, t("thanksText")),
          h("button", { type: "button", className: "primary-button large-button", onClick: () => setScreen("attract") }, t("backToStart"))
        )
      ),
    screen === "quiz" && h(QuizScreen, { muted }),
    screen === "play" &&
      h(
        "main",
        null,
        h(SpectrumGameView, {
          key: currentLevel.id + "-" + attempt,
          level: currentLevel,
          lang,
          onCompletion: handleLevelCompleted,
        })
      ),
    modalView
  );
}

// ——— Self-check: `node main.js`, or open index.html?selftest and read the console ———

function selfTest() {
  const assert = (ok, msg) => {
    if (!ok) throw new Error("selfTest: " + msg);
  };
  assert(LEVELS.length === 10, "ten levels");
  LEVELS.forEach((level) => {
    assert(level.trueLines.length <= 3, "L" + level.id + " shows at most 3 features");
    level.trueLines.forEach((l) => assert(l.center > level.xMin && l.center < level.xMax, "L" + level.id + " line inside window"));
    const spectrum = generateSpectrum(level);
    const science = scienceLinesOf(level.trueLines);
    const fit = autoFitBaseline(spectrum, level, continuumDefaults(level), seedTelluricComponents(level));
    const res = (c, tel) => baselineResidualPercent(spectrum, c, tel, science, level.mode, level.xMin, level.xMax);
    const truth = res(level.continuum, telluricLinesOf(level.trueLines));
    const got = res(fit.continuum, fit.tellurics);
    assert(got <= truth * 1.1 + 0.2, "L" + level.id + " auto-fit residual " + got.toFixed(2) + " vs truth " + truth.toFixed(2));
    const tol = (level.errorThresholdPercent / 100) * ((level.xMin + level.xMax) / 2);
    const shifted = (k) => science.map((l, i) => ({ ...l, id: i + 1, center: l.center + k * tol }));
    const within = (comps) => countLinesWithin(computeLineErrors(science, comps), level.errorThresholdPercent);
    assert(within(shifted(0.5)) === science.length, "L" + level.id + " half-tolerance offsets pass");
    assert(within(shifted(2)) === 0, "L" + level.id + " double-tolerance offsets fail");
    assert(tx(level.name) && level.name.de && level.blurb.de, "L" + level.id + " has German text");
    science.forEach((l) => assert(SPECIES[l.label], "L" + level.id + " species " + l.label + " has a name"));
    science.forEach((l) => assert(heatOf(level, l.center) === "hot", "L" + level.id + " exact centre is hot"));
    assert(heatOf(level, level.xMin - (level.xMax - level.xMin)) === "cold", "L" + level.id + " far away is cold");
  });
  Object.keys(STRINGS.en).forEach((k) => assert(STRINGS.de[k] != null, "German string for " + k));
  [TAU_MIN, 1, 8, TAU_MAX].forEach((tau) => assert(Math.abs(sliderToTau(tauToSlider(tau)) - tau) < 1e-9 * tau + 1e-12, "tau slider round-trips " + tau));
  Object.keys(SPECIES).forEach((k) => assert(SPECIES[k].emoji && SPECIES[k].nick.de, "sticker for " + k));
  for (let i = 0; i < 50; i++) {
    const round = newQuizRound();
    const lines = levelById(round.levelId).trueLines;
    assert(lines.filter((l) => l.label === lines[round.target].label).length === 1, "quiz answer is unambiguous");
  }
  console.log("selfTest: all " + LEVELS.length + " levels OK");
}

if (typeof document === "undefined") {
  selfTest();
} else {
  const rootEl = document.getElementById("root");
  if (rootEl) ReactDOM.createRoot(rootEl).render(h(App));
  if (/[?&]selftest/.test(location.search)) selfTest();
}
