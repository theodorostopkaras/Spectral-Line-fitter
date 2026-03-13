## Spectrum Fitter (browser toy game)

This is a small browser game where you fit Gaussian components to **real astronomical spectral lines**. Frequencies and molecule names are from the [Cologne Database for Molecular Spectroscopy (CDMS)](https://cdms.astro.uni-koeln.de/classic/).

### How to run

- **Option 1 – Open directly in a browser**
  - Open `index.html` in a modern browser (Chrome/Edge/Firefox).
  - Everything is loaded from CDNs, no build step or Node.js is required.

### How to play

- At the top you can pick **Level 1–3**.
- The blue curve is the **observed spectrum**; the green curve is your **model** (sum of Gaussians + small baseline).
- In the right panel:
  - Use the **\"+ Gaussian\"** button to increase the number of Gaussian components (up to the level limit).
  - For each Gaussian you can tune:
    - **Amplitude** (peak height),
    - **Center (GHz)** (line frequency),
    - **Width (sigma)** (line width).
  - As you move sliders, the model curve updates live.
  - The **fit quality** meter below the plot shows an approximate MSE between data and model.
- When you are happy with the fit, click **\"Submit fit\"**.
  - The game checks the **percent error in center frequency** for each true line against your nearest Gaussian.
  - If all visible true lines are within **5%** in center frequency, the level is marked as **completed**.
  - A summary table appears listing (all in **GHz**):
    - The **frequency (GHz)** of each line,
    - The **molecule** (e.g. HCN, CO, H2CO) and transition when known, or **Unknown line**,
    - Your **fitted frequency (GHz)** (with the closest CDMS molecule when nearby),
    - The **percent error** in center frequency.

### Levels (real CDMS lines)

- **Level 1 – Warm-up** (86–95 GHz)
  - 2 lines: **HCN** J=1-0 (88.63 GHz), **HCO+** J=1-0 (89.19 GHz).
- **Level 2 – Blended** (93–102 GHz)
  - 3 lines: **C34S** J=2-1, **CS** J=2-1 (unknown), **SO** 3(2)-2(1).
- **Level 3 – Crowded** (217–235 GHz)
  - 4 lines: **H2CO**, **H2CO** (unknown), **C18O** J=2-1, **13CO** J=2-1.

The spectrum is built from real rest frequencies; the game uses a small curated catalog of CDMS-style lines. Fitted frequencies are shown in GHz and, when close to a catalog line, the corresponding molecule is indicated.

