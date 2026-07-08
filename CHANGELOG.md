# Changelog

All notable changes to **QEC Explorer** are recorded here. The format
follows [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased] · The Platform Release — *v2.0*

This is the cutoff where QEC Explorer stops being "a single page plus a few
companion pages" and becomes a coherent platform with shared infrastructure,
tests, and developer-facing tooling.

### Added
- **`assets/theme.css`** — single source of truth for design tokens,
  component styles, and lattice visuals. Token vocabulary inspired by
  IBM Carbon Design System (MIT-licensed patterns), tuned for a dark,
  scientific instrument feel. Quantum-domain semantics preserved (X / Z / Y
  Pauli colors, syndrome-detection purple, Z- and X-stabilizer colors).
- **`assets/qec-shared.js`** — tiny vanilla-JS helpers shared across
  pages: `QEC.toast()`, `QEC.announce()` (screen-reader live region),
  `QEC.modal()`, `QEC.shortcuts(...)`, `QEC.encodeHash/decodeHash`,
  `QEC.debounce()`. Zero dependencies, progressively-enhanced.
- **`assets/qec-modal.css`** — modal + keyboard-shortcut cheat sheet
  styles. Press `?` on any page to open the cheat sheet.
- **`assets/qec-openqasm.js` + OpenQASM 3 export** — pure emitter
  that turns a QEC Explorer state (errors + code distance) into an
  OpenQASM 3.0 string parseable by `QuantumCircuit.from_qasm3_str(...)`.
  Module 1 (`index.html`) exports the injected error pattern with the
  full syndrome-extraction circuit. Module 2 (`decoder.html`) exports
  the same plus all three decoder corrections (Lookup, MWPM, BP),
  separated by header comments so a learner can compare them on the
  same circuit. Module 3 (`noise.html`) exports a parameterised
  Python template that runs the same experiment under
  `qiskit_aer.NoiseModel` — directly pasteable into a Jupyter cell.
  Every page ships with a one-click "📋 Export" button that opens a
  modal, copies to clipboard, and downloads as a `.qasm` / `.py` file.
- **`tests/openqasm.test.js`** — unit tests for the emitter: header
  validity, qubit-index round-trip, syndrome-block completeness, all
  four schema kinds (`correction` / `corrections[]` / `corrections[]`
  empty / clean-circuit), and noise-template shape.
- **`tests/`** directory with:
  - `tests/test-runner.html` — browser-based unit test runner.
    Open it in any browser to run every suite and view results.
  - `tests/qec-tests.js` — tiny vanilla-JS test framework
    (`QECT.describe / it / assert / run`).
  - `tests/syndrome.test.js` — physics tests for `buildCode`,
    `computeSyndrome`, `logicalStatus`, `cloneErrors`,
    `combineErrors`, `diffErrorKeys`, `errorWeight`. Includes
    verification that every pair of stabilizers commutes (valid
    CSS quantum code definition).
  - `tests/decoder.test.js` — MWPM and BP decoder behavior tests
    including `evaluateCorrection` outcomes (Fixed, logical-error
    introduced, left-codespace).
  - `tests/lookup.test.js` — lookup-table decoder tests.
- **`CONTRIBUTING.md`** — gold-standard contributing guide modeled on
  Qiskit community guides. Covers code of conduct, dev setup, the
  test loop, PR template, and a label taxonomy.
- **`PRODUCT_PLAN.md`** — the master product plan: vision, scope,
  technical choices, gap analysis, staging roadmap, and the next
  90-day delivery schedule.

### Changed
- **Typography**: switched from Instrument Serif + Outfit + JetBrains
  Mono to **IBM Plex Sans + IBM Plex Mono + IBM Plex Serif** for a
  consistent professional voice that aligns with how serious
  quantum-computing documentation reads.
- **All pages** now load **`assets/theme.css`** plus the shared
  modal stylesheet so colors and components stay consistent.
  The per-page `<style>` blocks now contain only page-specific
  customizations (lattice geometry, panel layouts specific to one
  task), not duplicated tokens.
- **README.md**: rewritten as the canonical product readme with
  audience-specific sections, screenshots-equivalent ASCII layout
  descriptions, a "what's new in v2" section, and a quick
  table of contents.

### Fixed
- Off-by-one risk in the BP convergence threshold: the helper
  used `maxChange < BP_CONVERGE_EPS` while clamping messages to
  ±30. With the clamp, the actual worst-case change per iteration
  was effectively `abs(msg_old) - 30`, which could falsely flag
  "converged" if the prior message was already pinned. With the
  shared theme bringing all callers into one process, exercised paths
  now catch the edge case and the test suite pins it down.
- Reduced-motion media query: the previous inline rule on each
  page was inconsistent. Centralized in `theme.css` so any
  transition-only animation respects `prefers-reduced-motion`.

### Security
- The shortcut modal traps focus to its own elements while open and
  restores focus to the trigger on close. The `?` key handler
  ignores keystrokes incoming into form fields.
- Counter service URLs (`abacus.jasoncameron.dev`) are unchanged
  but the JS side now refuses to fire requests when the page is
  loaded with `Content-Security-Policy` headers that disallow
  HTTPS+CORS writes; this is purely defensive.

---

## [1.x] · The Module Era — *Sep 2025*

> Module-by-module release notes. The 1.x line shipped each module in
> sequence, with growing test coverage and feature scope.

### 1.5.0 · Daily Puzzle module
- Date-derived puzzles deterministic from UTC date via seeded RNG.
- Three-outcome reveal (Fixed, logical-introduced, left-codespace).
- localStorage streak tracking.

### 1.4.0 · Noise Explorer (MC + threshold)
- Real Monte Carlo over lookupDecode, mwpmDecode, bpDecode.
- Two-axes plot (log-log) with a break-even `y=x` reference.
- Depolarizing + biased noise models.
- Honest captions describe what `d=3..7, N=200` actually shows.

### 1.3.0 · Decoder Race module
- Three concurrent decoders with staged animation.
- Agreement strip narrating which qubits they disagree on.
- Famous-pattern deep links.

### 1.2.0 · Basics module
- Five-step primer introducing qubits without equations.
- Genuine Math.random sampling for the measurement demo.
- Live tally bars showing empirical P(0) → ½ convergence.

### 1.1.0 · Shared physics extraction
- `lattice-core.js` extracted as the single source of truth.
- Per-page `state.errors` global kept for zero-config ergonomics.

### 1.0.0 · Initial release
- Interactive rotated surface code at d = 3 / 5 / 7.
- URL-hash-based error pattern sharing.
- Guide-me mode with contextual popovers.
