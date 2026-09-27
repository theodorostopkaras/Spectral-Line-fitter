## Spectrum Detective — kids' edition (branch `project_for_kids`)

A browser mini-game for **ages 8–10**, in **English and German** (EN | DE switch in the header, remembered on this device). Kids find the lines hidden in real spectra, from the Sun and from cold space clouds, and then hear them as music.

The full outreach version for adults, with 13 levels and hand-fitted continua, lives on `main`.

### How to run (offline)

Open `index.html` in Chrome, Edge or Firefox. You don't need internet, a build step or Node.js. React and Chart.js are in `vendor/`. Keep `vendor/` and `cdms-qr.png` next to `index.html`.

### How a level works

1. **Step 1 · The background.** The kids see the raw spectrum. They press **🤖 Computer, fit the background!** and watch the computer fit the continuum, bending the grey dashed curve onto the data:
   - **Sun levels:** a Planck curve × Rayleigh reddening.
   - **Radio levels:** a dust power law ν^α.
   - **Earth's air:** on levels 5–6 the computer also fits the orange O₂ lines from our own atmosphere (telluric lines).
2. **✨ Remove it!** The background is divided out (Sun) or subtracted (radio) with an animation. **Show before / Show after** flips between the two views.
3. **Step 2 · Find the lines.**
   - Click the plot to move the selected line there.
   - Adjust **How deep? / How bright?**, **How wide?** and **How full?**. "How full?" is the optical depth τ on a log slider (0.02–30): thin lines are pointy Gaussians, thick ones get a flat, saturated bottom or top.
   - Press **Check my answer!** You pass when every line centre is within 2 % of the window width.
4. **After passing:**
   - See your stars.
   - Play each line or all of them together; the window is spread over two piano octaves.
   - Read a “Did you know?” fact.
   - Add your name to the hall of fame (stored in `localStorage` key `spectrumFitter.kids.v1`).

The computer's fit is a real one: a small coordinate-descent search over the continuum shape and the telluric depths and widths. It minimises the residual away from the science lines (`autoFitBaseline` in `main.js`).

### Extras for kids

- **Specky the detective** is a mascot that tells the kids what to do next and cheers when they get stars.
- **Warm or cold hints:** each line shows 🔥 Hot / ♨️ Warm / 🌤️ Cool / ❄️ Cold. It shows 🔥 Hot exactly when that line would pass.
- **Sound effects:** a ding when a line lands in the right place, a fanfare when you solve a level and a "boing" when you miss. They follow the mute and volume controls.
- **Sticker book:** every atom and molecule is a character with an emoji and a nickname. Solving a level collects its stickers (`localStorage` key `spectrumFitter.kids.stickers`). **Clear hall of fame** wipes them too.
- **Story map:** the level picker is a journey from the Sun to Earth's air to space clouds, and it marks the next stop.
- **🎵 Guess the molecule by its song:** a mini-game. Listen to one line's note (the same two-octave mapping the levels use) and tap which line sang it.

### Levels

Each window shows at most 3 features. All levels use the same pass rule: 2 % of the window width.

| # | Window | Lines to find | Computer removes |
|---|--------|---------------|------------------|
| 1 Violet Sun | 385–415 nm | Ca II K, Ca II H, H-δ | solar continuum |
| 2 Blue Sun | 425–445 nm | Fe G, H-γ, Fe e | solar continuum |
| 3 Turquoise Sun | 478–505 nm | H-β, Fe c | solar continuum |
| 4 Green Sun | 510–535 nm | Mg b, Fe E2 | solar continuum |
| 5 Yellow & Orange Sun | 575–640 nm | Na D | continuum + O₂ a |
| 6 Red Sun | 640–770 nm | H-α | continuum + O₂ B + O₂ A |
| 7 Cold Cloud | 87.5–94.5 GHz | HCN, HCO+, N2H+ | dust continuum |
| 8 Sulfur Cloud | 95–101 GHz | C34S, CS, SO | dust continuum |
| 9 Carbon Monoxide Twins | 108.5–112 GHz | C18O, 13CO | dust continuum |
| 10 The Brightest Line | 112.5–118 GHz | CN, CO | dust continuum |

Solar wavelengths come from standard Fraunhofer tables. Radio frequencies come from [CDMS](https://cdms.astro.uni-koeln.de/classic/).

### Kiosk features

- Large touch-friendly buttons, a bigger base font, and CSS-only confetti. Confetti is turned off under "reduce motion".
- After 120 s without input, the game returns to the start screen.
- Every level can be chosen from the start screen or the header.

### Self-check

`node main.js` (or `index.html?selftest`, then look in the console) runs `selfTest()`. For every level it checks:
- 10 levels, each with ≤ 3 features
- the computer's background fit is as good as the true background
- line centres pass at half the tolerance and fail at twice the tolerance
- every text has a German version
