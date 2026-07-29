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

Every line — true or player-placed — has **four** parameters. The optical-depth shape of one line is

```
tau(x)    = tau_0 * exp(-(x - center)^2 / (2 sigma^2))
P(x)      = Imax * (1 - exp(-tau(x))),   Imax = amplitude / (1 - exp(-tau_0))
```

so that `amplitude` always means the peak of `P` (brightness or depth), and `tau_0` only changes the *shape*: small τ₀ is an ordinary Gaussian, large τ₀ saturates the line into a flat-topped (or flat-bottomed) box.

How that profile enters the spectrum depends on the mode:

- **emission** — `y = C(ν) + Σ T_B,i · P_i(ν)` — brightness temperatures in **kelvin**, additive on the continuum
- **absorption** — `y = C(λ) · Π (1 − d_i · P_i(λ))` — each line a **fractional depth of the local continuum**, so 0.8 always means “80 % of the light here is swallowed”, wherever the continuum sits. Solar and telluric lines both multiply in (imprinted at the Sun, then in our air). There is no zero clamp: a saturated core reaches zero only at depth = 1.

### Units on every parameter

| Parameter | Emission | Absorption |
|-----------|----------|------------|
| Strength | Peak brightness **T_B (K)** | Line depth **% of continuum** |
| Center | **GHz** | **nm** |
| Width σ | **GHz**, with FWHM and km/s note | **nm**, with FWHM and km/s note |
| Optical depth τ₀ | dimensionless (thin → thick → saturated) | same |

Widths stay in wavelength/frequency (correct for a resolution-limited instrument). The note under each width slider shows the FWHM and its Doppler equivalent Δv = c · FWHM / x₀.

### Spectrograph resolution

The drawn widths are far broader than a real Fraunhofer or molecular line, because a 0.01 nm line is invisible across a 320 nm window. That width is the **instrument**: each level’s info strip shows `Resolution: FWHM ≈ … (R ≈ …)`. Fraunhofer’s prism (R ~ 300) shows one dark “Mg b”; Level 11’s grating (R ~ 5000) splits the triplet. The width slider cannot go below the instrumental sigma.

### Physical continua

Shaped continua are no longer free polynomials. Both are **normalised at the middle of the band**, so the overall amplitude is never fitted — only the physics of the shape.

**Level 10 — solar continuum**

```
C(λ) = [B_λ(λ, T) / B_λ(λ_ref, T)] · exp( −0.0973 A [ (550/λ)^4 − (550/λ_ref)^4 ] )
```

- **Solar surface temperature T** (K) — Planck curvature (Wien peak near 500 nm); truth 5772 K
- **Airmass A** — telluric reddening from Rayleigh scattering ∝ λ⁻⁴; truth 1.15; lives with the amber atmosphere controls

**Level 13 — dust continuum**

```
C(ν) = 0.85 K · (ν / ν_ref)^α
```

- **Dust spectral index α** — dust emission goes as ν^α, with α = 2 + β for emissivity index β; truth 4.0

### Continuum first (two-step levels)

Levels 10 and 13 require a **baseline phase** before science lines:

1. Fit the continuum (temperature + airmass on Level 10; dust index on Level 13) and, on Level 10, the amber **telluric** O₂ lines from Earth's atmosphere.
2. Press **Lock baseline** when the residual away from science lines is good enough.
3. Then fit the science lines. On absorption levels, **Rectify (÷ continuum)** divides by the locked continuum (and atmosphere) so lines dip from a flat 1.0 — what solar physicists call a rectified spectrum. Emission levels keep a subtractive residual.

Telluric lines are drawn in amber and count toward the pass — they are features of our air, not of the Sun.

### How to play

1. On the **attract screen**, read the short how-to, then either press **Start with Level 1** or pick any level from **Choose a level**. Nothing is locked: every level can be played first, and each card shows its band, emission/absorption mode, how many lines are scored, and the current best score.
2. Add lines (**+ Add line**) and tune four sliders. Every level allows a line for **every feature it draws** (plus two spare). New lines are added at the **top** of the list so they are visible immediately. Remove with **− Remove line N**.
3. Every slider has **(−)** and **(+)** nudge buttons for fine tuning; there is no separate number box. Parameters:
   - **Peak brightness T_B (K)** or **Line depth (% of continuum)**
   - **Center** — in **GHz** on the radio levels, in **nm** on the solar levels
   - **Width σ** — with FWHM and km/s note
   - **Line-centre optical depth τ₀** — Gaussian when thin, flat when thick
4. Placing a center on a wide level: **click the plot** to drop the selected line there, then use the nudge buttons; the slider is for coarse moves.
5. On the wide emission levels, press **Stretch weak lines (log)** to switch the intensity axis to logarithmic and see the faint forest under the bright lines.
6. Match the green **model** to the blue **observed spectrum**.
7. Click **Submit fit**. You pass when **every** line center on the plot is inside that level's threshold (0.015%–0.5%, see the table below).
8. In the congratulations box you can:
   - See **stars**, mean error %, continuum recovery (solar T, airmass, or dust α), and fitted parameters with units
   - Enter your **name** and **Save to leaderboard**
   - **Play** each line or **Play all lines** (chord)
   - Read **molecule facts** / **element facts** and open **CDMS** (link / QR)
   - **Save as CSV**, go to the **Next level**, or **Exit**

A compact **Level info** strip under the plot shows line counts, pass threshold, spectrograph resolution, and baseline state. Expand **What do these numbers mean?** for the short explanation.
### Sonification

Spectral lines are far outside human hearing (~20 Hz–20 kHz): a 100 GHz radio line and a 589 nm sodium line are at 10^11 and 5×10^14 Hz. Each level picks one of two rules, and the “How do we turn lines into sound?” panel says which one is in use.

| Rule | Used on | What it does |
|------|---------|--------------|
| **stretch** | narrow radio levels (1–6, 9) | **180 Hz of pitch per 1 GHz** of separation, then shifted into 180–1800 Hz. Exaggerated on purpose — neighbouring molecular lines would otherwise be the same note. Pitch *differences* are meaningful, ratios are not. |
| **ratio** | wide levels (7, 8, 13) and all solar levels (10–12) | Divide every real frequency by **one** constant K, chosen so the level's window lands near 632 Hz (clamped to 150–4000 Hz). Frequency **ratios** survive, so you hear the true musical intervals of the real lines. |

Level 8 is the showpiece for the ratio rule on the radio track: a curated cut of Herschel/HIFI **HEXOS Band 1a** (480–560 GHz) toward Orion KL, with seven real lines including water and the CO isotopes. Frequency ratios are preserved, so the chord you hear matches the true intervals of those lines.

Other audio notes:

- Higher frequency → higher pitch (so on the solar levels, *shorter wavelength* → higher pitch)
- Per-line **Play** and **Play all lines**; header **Vol** slider and **Mute**
- Audio waits for `AudioContext` resume after a user click (required by browsers)

### Levels

**Radio track — emission, CDMS rest frequencies** (Level 9 is absorption)

| Level | Band | Lines (all scored) | Notes |
|-------|------|--------------------|-------|
| 1 Warm-up | 86–95 GHz | HCN, HCO+ | Two lines, overlapping just enough to matter |
| 2 Blended | 93–102 GHz | N2H+, C34S, CS, SO, HC3N + U-line | Unidentified line in the C34S shoulder |
| 3 Crowded | 217–235 GHz | H2CO, C18O, 13CO, CO 2-1 + U-line | H2CO pair under a linewidth apart; CO saturated flat |
| 4 3 mm band | 108–117 GHz | C18O, 13CO, CO 1-0, one unknown | Unknown at 113.49 GHz |
| 5 Submm blend | 228–246 GHz | CO 2-1, CS 5-4, two U-lines | Second U-line on the flank of CS |
| 6 Dense tracers | 263–282 GHz | HCN, HCO+, HNC (J=3-2), one unknown | Optically thick lines |
| 7 Wide 3 mm scan | 84–116 GHz | 16 lines (SiO through CO) | 20:1 intensity range, ratio sonification, log-Y toggle |
| 8 HEXOS Band 1a | 480–560 GHz | CI, HCN, HCO+, CS, C18O, 13CO, H2O | Curated Orion KL vignette |
| 9 Radio absorption | 86–95 GHz | SiO, H13CO+, C2H, HCN, HCO+, HNC, N2H+ | Absorption as continuum depth fraction; N2H+ core saturated |
| 13 Continuum first | 88–116 GHz | HCN, HCO+, N2H+, CS, C18O, 13CO, CO | Dust power-law continuum (α) — lock baseline, then fit lines |

**Solar track — absorption, Fraunhofer wavelengths**

| Level | Band | Lines (all scored) | Notes |
|-------|------|--------------------|-------|
| 10 Solar spectrum | 380–700 nm | Ca II K/H, Fe, Balmer, Mg b, Na D, He I + telluric O₂ | Two-step: solar T + airmass + amber O₂ first |
| 11 Magnesium close-up | 515.5–519.5 nm | Mg I b1, b2, b4 + Fe I | Level 10's single “Mg b” resolves into a triplet |
| 12 Sodium close-up | 586.5–591.5 nm | Na I D2, D1 + He I D3 | Both Na cores saturated flat |

Difficulty rises with blending, dynamic range, saturation, and unknown species. Every line drawn on the plot counts toward pass and stars.

### Scoring and leaderboard

- Each level has its own **pass threshold** on the center error, from 0.5% (Level 2) down to 0.015% (Level 11) — 5% of a 400 GHz window would be meaningless.
- **Stars** (out of 5) come from the **mean center error %** as a fraction of that level's threshold: ≤4% of it → 5★ · ≤10% → 4★ · ≤22% → 3★ · ≤50% → 2★ · ≤100% → 1★. Levels may override the bands.
- Matching is **one-to-one**: each player line can be claimed by only one true line (closest pairs first), so a single broad Gaussian cannot “fit” three blended lines.
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
- Wide layout (up to 1800 px) with line cards in a multi-column grid so several lines’ parameters are visible at once
- Large touch-friendly buttons, click-to-place on the plot, (−)/(+) fine nudges on every slider
- Idle timeout (120 s) → back to attract screen
- CSV export of level mode, spectral unit, continuum recovery, every fitted line with units, τ₀, errors, the audio rule, and audible Hz
### Controls (header)

- **Vol** — master volume
- **Mute** / **Unmute**
- **Home** — return to attract screen (during play)
- **Radio L1–L9, L13** and **Solar L10–L12** — jump to any level at any time, in any order (a ✓ marks levels you have passed)

### Credits

Radio line frequencies are curated from [CDMS](https://cdms.astro.uni-koeln.de/classic/) and solar wavelengths from standard Fraunhofer tables, for educational use in this toy fitting game.
