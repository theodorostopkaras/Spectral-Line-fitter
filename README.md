## Spectrum Fitter

A browser-based **public outreach** mini-game: fit line profiles to **real astronomical spectra**, in **emission** (radio molecular lines) and in **absorption** (the solar Fraunhofer spectrum), then **hear** those lines as scaled audio tones.

Radio rest frequencies come from the [Cologne Database for Molecular Spectroscopy (CDMS)](https://cdms.astro.uni-koeln.de/classic/); solar wavelengths come from standard Fraunhofer line tables.

### Files

| File | Role |
|------|------|
| `index.html` | Page shell (loads React, Chart.js, CSS, `main.js`) |
| `main.js` | Game logic, levels, audio, leaderboard, UI |
| `styles.css` | Layout and kiosk-friendly styling |
| `cdms-qr.png` | Offline QR code linking to CDMS |
| `README.md` | This documentation |

### How to run

1. Open `index.html` in a modern browser (Chrome, Edge, or Firefox).
2. No build step or Node.js is required (React and Chart.js load from CDNs).
3. Keep `cdms-qr.png` next to `index.html` so the QR works offline.

Tip: for a public kiosk, serve the folder over `http://` (or open the file) and use fullscreen; the game returns to the attract screen after **120 seconds** of inactivity.

### The line profile

Every line — true or player-placed — has **four** parameters, and the contribution of one line is

```
tau(x)       = tau * exp(-(x - center)^2 / (2 sigma^2))
contribution = Imax * (1 - exp(-tau(x))),   Imax = amplitude / (1 - exp(-tau))
```

- **Amplitude** is always the peak height (or, in absorption, the depth), whatever `tau` does.
- **Optical depth tau** only changes the *shape*: small tau is an ordinary Gaussian, large tau saturates the line into a flat-topped (or flat-bottomed) box. That is real physics — an opaque line cannot get any brighter than the source behind it.

The spectrum is then composed once, per level mode:

- **emission** — `baseline + sum of contributions`
- **absorption** — `continuum - sum of contributions`, clamped at zero

So the two modes are the same physics with a sign flip, which is exactly the point Levels 9–12 are there to make.

### How to play

1. On the **attract screen**, read the short how-to, then either press **Start with Level 1** or pick any level from **Choose a level**. Nothing is locked: every level can be played first, and each card shows its band, emission/absorption mode, how many lines are scored, and the current best score.
2. Add components and tune four sliders. Every level allows a component for **every line it draws** (plus two spare), so the weak forest can be fitted too — a new component is dropped automatically on the strongest feature the model does not explain yet:
   - **Amplitude** — peak height (emission) or depth (absorption)
   - **Center** — in **GHz** on the radio levels, in **nm** on the solar levels
   - **Width / sigma**
   - **Optical depth tau** — Gaussian when thin, flat-topped when thick
3. Placing a center on a wide level: **click the plot** to drop the selected component there, then use the **fine nudge** buttons or the fine number box; the slider is for coarse moves.
4. On the wide emission levels, press **Stretch weak lines (log)** to switch the intensity axis to logarithmic and see the faint forest under the bright lines.
5. Match the green **model** to the blue **observed spectrum**.
6. Click **Submit fit**. You pass when every **scored** line center is inside that level's threshold (0.015%–0.5%, see the table below). Weak lines never decide the pass, but any you fit anyway are credited as a **bonus** in the results and in the CSV.
7. In the congratulations box you can:
   - See **stars**, mean error %, MSE, and fitted parameters (including tau and audible Hz)
   - Enter your **name** and **Save to leaderboard**
   - **Play** each line or **Play all lines** (chord)
   - Read **molecule facts** / **element facts** and open **CDMS** (link / QR)
   - **Save as CSV**, go to the **Next level**, or **Exit**

### Sonification

Spectral lines are far outside human hearing (~20 Hz–20 kHz): a 100 GHz radio line and a 589 nm sodium line are at 10^11 and 5×10^14 Hz. Each level picks one of two rules, and the “How do we turn lines into sound?” panel says which one is in use.

| Rule | Used on | What it does |
|------|---------|--------------|
| **stretch** | narrow radio levels (1–6, 9) | **180 Hz of pitch per 1 GHz** of separation, then shifted into 180–1800 Hz. Exaggerated on purpose — neighbouring molecular lines would otherwise be the same note. Pitch *differences* are meaningful, ratios are not. |
| **ratio** | wide levels (7, 8) and all solar levels (10–12) | Divide every real frequency by **one** constant K, chosen so the level's window lands near 632 Hz (clamped to 150–4000 Hz). Frequency **ratios** survive, so you hear the true musical intervals of the real lines. |

Level 8 is the showpiece for the ratio rule: CO J=4-3 at 461.041 GHz through J=8-7 at 921.800 GHz is a **4:5:6:7:8 harmonic series** spanning almost exactly one octave, so **Play all lines** is a genuine overtone chord — and the octave being very slightly flat is real centrifugal stretching of the CO molecule.

Other audio notes:

- Higher frequency → higher pitch (so on the solar levels, *shorter wavelength* → higher pitch)
- Per-line **Play** and **Play all lines**; header **Vol** slider and **Mute**
- Audio waits for `AudioContext` resume after a user click (required by browsers)

### Levels

**Radio track — emission, CDMS rest frequencies** (Level 9 is absorption)

| Level | Band | Scored lines | Notes |
|-------|------|--------------|-------|
| 1 Warm-up | 86–95 GHz | HCN, HCO+ | Two lines, overlapping just enough to matter |
| 2 Blended | 93–102 GHz | N2H+, C34S, CS, SO, HC3N | Plus one unidentified line in the C34S shoulder |
| 3 Crowded | 217–235 GHz | H2CO, C18O, 13CO, CO 2-1 | H2CO pair under a linewidth apart; CO saturated flat |
| 4 3 mm band | 108–117 GHz | C18O, 13CO, CO 1-0, one unknown | The unknown at 113.49 GHz counts too |
| 5 Submm blend | 228–246 GHz | CO 2-1, CS 5-4, one U-line | A second U-line sits on the flank of CS |
| 6 Dense tracers | 263–282 GHz | HCN, HCO+, HNC (J=3-2), one unknown | Optically thick lines |
| 7 Wide 3 mm scan | 84–116 GHz | 8 of 16 lines | 20:1 intensity range, ratio sonification, log-Y toggle |
| 8 CO ladder scan | 450–930 GHz | CO 4-3…8-7, H2O, CI | HEXOS-flavoured octave scan with a weak forest |
| 9 Radio absorption | 86–95 GHz | C2H, HCN, HCO+, HNC, N2H+ | Level 1's molecules against a bright continuum; N2H+ core saturated |

**Solar track — absorption, Fraunhofer wavelengths**

| Level | Band | Scored lines | Notes |
|-------|------|--------------|-------|
| 10 Solar spectrum | 380–700 nm | Ca II K/H, H-delta, H-gamma, H-beta, Mg b (blend), Na D (blend), H-alpha | Whole visible range at school-spectroscope resolution; two telluric O2 bands are drawn but not scored |
| 11 Magnesium close-up | 515.5–519.5 nm | Mg I b1, b2, b4 | Level 10's single “Mg b” resolves into a triplet, with Fe I wedged against b4 |
| 12 Sodium close-up | 586.5–591.5 nm | Na I D2, D1 | Both cores saturated flat; He I D3 nearby, drawn but not scored |

Difficulty rises with blending, dynamic range, saturation, and unknown species. On the crowded levels many lines are drawn but flagged **not scored**, exactly as a real survey contains far more features than you would fit by hand — you are free to fit them all, and get bonus credit for the ones you catch.

### Scoring and leaderboard

- Each level has its own **pass threshold** on the center error, from 0.5% (Level 2) down to 0.015% (Level 11) — 5% of a 400 GHz window would be meaningless.
- **Stars** (out of 5) come from the **mean center error %** as a fraction of that level's threshold: ≤4% of it → 5★ · ≤10% → 4★ · ≤22% → 3★ · ≤50% → 2★ · ≤100% → 1★. Levels may override the bands.
- Matching is **one-to-one**: each player component can be claimed by only one true line (closest pairs first), so a single broad Gaussian cannot “fit” three blended lines.
- Live **spectrum mismatch %** = RMSE / intensity range × 100 (raw MSE is often tiny even for mediocre fits).
- **Named leaderboard** stored in the browser (`localStorage` key `spectrumFitter.leaderboard.v3`), grouped by track
- Top **5** scores **per level**, ranked by mean % error (then MSE)
- On the attract screen: **Reset leaderboard** clears all scores on this device (with confirmation)

Scores stay on that browser/kiosk only; there is no online server.

### Outreach / kiosk features

- Attract screen: *Fit the spectrum — hear the molecule*, with a level picker so a visitor can jump straight to whatever looks interesting
- Molecule and element fact cards after a successful fit
- CDMS “Learn more” link + offline QR (`cdms-qr.png`); solar levels point at the Fraunhofer line tables instead
- Visible-spectrum colour wash behind the solar plots
- Large touch-friendly buttons, click-to-place on the plot
- Idle timeout (120 s) → back to attract screen
- CSV export of level mode, spectral unit, every fitted line (scored and bonus), tau, errors, the audio rule, and audible Hz

### Controls (header)

- **Vol** — master volume
- **Mute** / **Unmute**
- **Home** — return to attract screen (during play)
- **Radio L1–L9** and **Solar L10–L12** — jump to any level at any time, in any order (a ✓ marks levels you have passed)

### Credits

Radio line frequencies are curated from [CDMS](https://cdms.astro.uni-koeln.de/classic/) and solar wavelengths from standard Fraunhofer tables, for educational use in this toy fitting game.
