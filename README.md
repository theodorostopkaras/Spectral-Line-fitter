## Spectrum Fitter

A browser-based **public outreach** mini-game: fit Gaussian components to **real astronomical spectral lines**, then **hear** those frequencies as scaled audio tones.

Frequencies and molecule names come from the [Cologne Database for Molecular Spectroscopy (CDMS)](https://cdms.astro.uni-koeln.de/classic/).

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

### How to play

1. On the **attract screen**, read the short how-to, check the **leaderboard**, then press **Start playing**.
2. Add Gaussian components and tune:
   - **Amplitude** (peak height)
   - **Center (GHz)** (line frequency)
   - **Width / sigma** (line width)
3. Match the green **model** to the blue **observed spectrum**.
4. Click **Submit fit**. You pass when every true line center is within **5%**.
5. In the congratulations box you can:
   - See **stars**, mean error %, MSE, and fitted parameters (including audible Hz)
   - Enter your **name** and **Save to leaderboard**
   - **Play** each line or **Play all lines** (chord)
   - Read **molecule facts** and open **CDMS** (link / QR)
   - **Save as CSV**, go to the **Next level**, or **Exit**

### Sonification

Radio lines are in the **GHz** range — far above human hearing (~20 Hz–20 kHz). After a pass, fitted centers are scaled by a **single factor** into an audible band (lowest line ≈ 220 Hz) so **relative spacing** between lines is preserved.

- Per-line **Play** and **Play all lines**
- Header **Vol** slider and **Mute**
- Collapsible explanation: “Why can’t I hear GHz?”
- Audio waits for `AudioContext` resume after a user click (required by browsers)

### Levels (CDMS rest frequencies)

| Level | Band | Lines |
|-------|------|--------|
| 1 Warm-up | 86–95 GHz | HCN, HCO+ |
| 2 Blended | 93–102 GHz | C34S, CS (unknown), SO |
| 3 Crowded | 217–235 GHz | H2CO ×2, C18O, 13CO |
| 4 3 mm band | 108–117 GHz | C18O, 13CO, CN (unknown), CO |
| 5 Submm blend | 228–246 GHz | CO J=2-1, CH3OH (unknown), CS J=5-4 |
| 6 Dense tracers | 263–282 GHz | HCN, HCO+, N2H+ (unknown) |

Difficulty rises with more lines, noise, blending, and unknown species. Win rule: **≤ 5%** error on each line center frequency.

### Scoring and leaderboard

- **Stars** from mean percent error: ≤1% → 3★, ≤3% → 2★, ≤5% → 1★
- **Named leaderboard** stored in the browser (`localStorage` key `spectrumFitter.leaderboard.v2`)
- Top **5** scores **per level**, ranked by mean % error (then MSE)
- After a pass: type a name (max 20 characters) → **Save to leaderboard**
- On the attract screen: **Reset leaderboard** clears all scores on this device (with confirmation)

Scores stay on that browser/kiosk only; there is no online server.

### Outreach / kiosk features

- Attract screen: *Fit the spectrum — hear the molecule*
- Molecule fact cards after a successful fit
- CDMS “Learn more” link + offline QR (`cdms-qr.png`)
- Large touch-friendly buttons
- Idle timeout (120 s) → back to attract screen
- CSV export of fitted lines, fit parameters, errors, and audible Hz

### Controls (header)

- **Vol** — master volume
- **Mute** / **Unmute**
- **Home** — return to attract screen (during play)
- **L1–L6** — jump between levels

### Credits

Line frequencies are curated from [CDMS](https://cdms.astro.uni-koeln.de/classic/) for educational use in this toy fitting game.
