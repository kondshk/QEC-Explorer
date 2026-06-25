# QEC Explorer

**An open-source, interactive tool to see how quantum error correction works — in real time, in your browser.**

This is **Module 1 — Detection**: an interactive *rotated surface code* playground. Click data qubits to inject X / Z / Y errors and watch the stabilizers light up to detect them — the foundation of how quantum computers protect information.

👉 **[Open the live tool](index.html)** (or visit the GitHub Pages site once enabled)

---

## What it does

- **Interactive surface-code lattice** at distance d = 3, 5, and 7
- **Click any data qubit** to inject an X (bit flip), Z (phase flip), or Y (both) error
- **Stabilizers fire in real time** — this lit pattern is the *syndrome*, the only clue a real decoder gets
- **Live logical-state readout** that flips to ✗ when your errors form an undetectable logical error
- **Shareable links** — every error pattern encodes into the URL so you can send someone an exact configuration
- **Keyboard accessible** — Tab between qubits, Enter/Space to toggle
- **Zero dependencies** — one self-contained HTML file, no build step, no server

## The physics is real

The lattice connectivity, stabilizer construction, and syndrome parity are physically faithful to the rotated surface code — not a cartoon. The code has been checked against the defining invariants:

- Correct qubit / stabilizer counts (d² data qubits, d²−1 stabilizers) at every distance
- Every pair of stabilizers commutes (the formal definition of a valid CSS quantum code)
- Logical operators (a spanning column of X, or row of Z) correctly produce a silent syndrome

## Roadmap

**Interactive modules** (all live):

| Module | Status |
|--------|--------|
| **1 · Surface-code detection** — inject errors, watch syndromes fire | ✅ Live |
| **2 · Decoder race** — three real decoders compete to fix the same error | ✅ Live |
| **3 · Noise explorer** — Monte Carlo over error rate & bias; hunt the threshold | ✅ Live |

**Companion Colab notebooks** (build it all from scratch in plain Python):

| Notebook | Topic |
|----------|-------|
| **1 · Building the surface code by hand** | Data qubits, stabilizers, syndromes — proven to match the live tool |
| **2 · Decoding by hand** | Lookup, MWPM, and BP decoders, verified against `decoders.js` |
| **3 · Noise, Monte Carlo & the threshold** | The experiment behind Module 3, with an honest look at what d=3–7 can show |
| **4 · Beyond the surface code: qLDPC** | Bivariate-bicycle codes and the qubit-overhead problem (conceptual) |
| **5 · Learned decoding with a GNN** | A real PyTorch graph-neural-network decoder, trained and benchmarked honestly |

A plain-English [landing page](landing.html) and a [research-connection page](research.html) tie the whole thing together.

## Run it locally

No install needed — just open `index.html` in any modern browser, or serve the folder with any static host (GitHub Pages works out of the box).

## License

MIT — see [LICENSE](LICENSE).
