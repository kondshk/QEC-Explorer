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

| Module | Status |
|--------|--------|
| **1 · Surface-code detection** | ✅ Live |
| **2 · Decoder race** — watch decoders compete to fix the same error | 🔨 In progress |
| **3 · Noise-model explorer** — slide error rate & bias, see protection hold or break | 📋 Planned |

## Run it locally

No install needed — just open `index.html` in any modern browser, or serve the folder with any static host (GitHub Pages works out of the box).

## License

MIT — see [LICENSE](LICENSE).
