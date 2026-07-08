# Tier A #2 — IBM Quantum Live-Calibration Explorer

> **Status:** Draft design sketch. Companion to `PRODUCT_PLAN.md` v2.2.
> **Owner:** Module 3 (`noise.html`).
> **Date:** 2026-07-07.

This document sketches how QEC Explorer stops treating "physical error rate
`p`" as a free slider and instead grounds it in **real IBM Quantum backend
calibration data** — so a learner can ask the question:

> *"If I run a rotated surface code on `ibm_torino`, what does the predicted
> logical error rate look like vs my selected code distance?"*

Honoring `PRODUCT_PLAN.md` and `CONTRIBUTING.md`, **no build step, no
React, no CPU sidecar server**. Everything below is reachable from a
single static `index.html`-style deploy.

---

## 1 · Path selection

Four paths were considered; **two are kept**.

| # | Path | Verdict | Reason |
|---|------|---------|--------|
| **A** | Direct browser fetch to an IBM REST endpoint | ❌ rejected | IBM Quantum requires an API token; no public CORS-friendly endpoint exists for the calibration resource. Browser-direct would force every learner to create an IBM account and paste a token — bad first-run UX. |
| **B** | **Static snapshot bundle** committed to the repo, refreshed weekly by a GitHub Action that runs Python/Qiskit | ✅ **PRIMARY** | Stays purely browser-side. `fetch('assets/ibm-snapshots/ibm_torino.json')` Just Works. Cached forever by browser / CDN. Zero user setup. |
| **C** | Tiny Python FastAPI sidecar the user runs locally | ❌ rejected | Breaks `CONTRIBUTING.md`'s "no server, no build step, no dependencies" contract. Reservable for a future v3 advanced tier if we add a feature that genuinely cannot be done in-browser. |
| **D** | **User-paste pattern** — user runs a 3-line Jupyter snippet, copies a small JSON, pastes into a textbox on the page | ✅ **FALLBACK** | Browser-only, no CORS, no API token leaked. Useful when the user wants *right now* calibration, or when the CI snapshot is stale. |

**Recommended ship order: B for MVP, D as v2.2.x polish.**

---

## 2 · JSON schema

The CI script (`scripts/refresh_ibm_snapshots.py`, lives outside
`PASSION_PROJECT/` since it's not part of the web app) distils the
heavy `BackendProperties` object into one tall-and-skinny JSON per
backend. **Medians, not per-qubit arrays**, because the Web app only
needs a single `(p_eff, d)` order of magnitude — and a per-qubit array
would either need device-specific connectivity knowledge (Heron /
Condor layouts differ) or muddy the educational narrative.

```jsonc
// assets/ibm-snapshots/ibm_torino.json
{
  "backend_name": "ibm_torino",
  "snapshot_date": "2026-07-07T00:00:00Z",
  "qubit_count": 133,
  "basis_gates": ["ecr", "id", "rz", "sx", "x"],   // 2q gate may be "cx" or "ecr"
  "two_qubit_gate": "ecr",
  "metrics": {
    "t1_us":                  122.0,    // median over all qubits
    "t2_us":                   86.0,
    "two_qubit_error":        0.0088,   // median across pairs used by the device
    "two_qubit_duration_ns":  660.0,
    "readout_error":          0.0125,
    "readout_duration_ns":   1500.0
  },
  "ci": {
    "two_qubit_error_median": 0.008,
    "two_qubit_error_p90":    0.018    // so the caption can warn about the worst case
  }
}
```

The page never reads non-`metrics` fields, so we can add metadata
later (e.g. backend topology, basis gates, processor type) without a
schema break.

---

## 3 · Surface-code translation layer

A standard **rotated-surface-code syndrome-extraction round** per
data qubit touches 4 two-qubit gates (one per adjacent stabilizer),
1 measurement, and idle time equal to one round.

```
t_round = 4 × t_2q + t_meas

p_idle   ≈ t_round / T1  +  (1/2) × t_round / T2       (first-order decoherence)
p_round  ≈ 4 × p_2q + p_meas + p_idle
```

`p_round` is plugged straight into `sampleError()` in `noise.html`
(the existing function takes a single `p` per round and draws X and
Z flips independently — this is the standard *phenomenological*
mapping from circuit-level to code-level noise).

### 3.1 · Why a phenomenological `p_eff`, not a real `NoiseModel`?

- **`sampleError()` already exists** and is unit-tested against the
  other two decoders (lookup / mwpm / bp). Re-using it avoids
  re-implementing circuit-level fidelity on the Web side, which is
  out of scope for a teaching tool.
- The degraded accuracy at small `d` is acceptable: we will *honestly*
  say so in the captions (Section 5). The pedagogical goal is "where
  does the IBM device sit on your threshold plot?" — not "build me
  a publishable fidelity estimate."

### 3.2 · Worked example (`ibm_torino` from Section 2)

```
t_round = 4 × 660ns + 1500ns = 4140 ns ≈ 4.14 µs
p_idle  = (4.14 / 122) + 0.5 × (4.14 / 86)  ≈ 0.0339 + 0.0241  ≈ 0.0580
p_round = 4 × 0.0088 + 0.0125 + 0.0580    ≈ 0.0352 + 0.0125 + 0.0580 ≈ 0.106
```

So on a `d = 5` surface code at one round per cycle, ~10% of data
qubits experience an X or Z flip per round — well above the
~0.7%-1% circuit-level *threshold*, which honestly tells the learner
that **current hardware is above threshold for a single round, and
the code only saves you because you can repeat the rounds and use a
decoder.**

> The 10% per-round rate compounds into a per-shot LER ≈ `~0.5` at
> `d = 3` (single round), which is what the Monte Carlo will show
> them. That's exactly the right narrative jolt.

---

## 4 · UI walkthrough

A new control group **directly below the "Noise model" group** in
`noise.html`:

```
┌─ Hardware calibration ──────────────────────┐
│ ( ) Synthetic (slider)                      │
│ ( ) ibm_torino        [snapshot 2026-07-07] │
│ ( ) ibm_brisbane      [snapshot 2026-06-30] │
│ ( ) ibm_sherbrooke    [snapshot 2026-07-02] │
│ ( ) Paste your own JSON…                   │  ← opens modal
└─────────────────────────────────────────────┘
```

Behavior:

1. **Synthetic** is the existing slider; nothing changes.
2. **ibm_torino / ibm_brisbane / ibm_sherbrooke** — click fetches
   `assets/ibm-snapshots/<backend>.json`, derives `p_eff`, locks the
   `p` slider, and updates the `pVal` readout to:
   `p ≈ 0.106 (from ibm_torino snapshot 2026-07-07)`.
3. **Paste your own JSON…** opens a modal with a textarea pre-filled
   with the schema, and a copy-to-clipboard "Python one-liner to grab
   fresh calibration" snippet the user can run in a Jupyter cell.

### Plot additions

In sweep mode (`#sweepView`), the existing log-log LER-vs-p plot
gains:

- A **vertical dotted line** at `x = p_eff`, classed `.hardware-line`.
- Three **point markers** where the line crosses the `d = 3, 5, 7`
  curves (computed once at sweep time).
- A small **badge** in the legend chip strip: "ibm_torino · snapshot
  2026-07-07".

In single-point mode, the existing convergence plot is reused as-is
— the "where does my device sit?" question is fundamentally a
sweep-mode question.

---

## 5 · Honesty / pedagogy captions

The honest caption (parallels the existing muddiness captions in
`describeThreshold()`):

> *"The dotted line maps median hardware calibration to a single
> phenomenological `p_eff` per code round. We use device medians and
> ignore per-qubit variation; on real `ibm_torino` the worst
> `two_qubit_error` is roughly 2× the median. We also ignore
> crosstalk and the differences between ECR and CX. This is a
> cartoon — designed to show **where current hardware sits on the
> threshold plot**, not to predict a publishable LER. The fact that
> the line sits well to the right of break-even on this plot is
> the lesson: today's superconducting qubits are above the
> rotated-surface-code threshold for short codes, and big-distance
> codes are the path forward."*

This caption must be **statically rendered, not animated away**. The
existing `threshHonest` slot is the natural host.

---

## 6 · Testability

Add **`tests/hardware.test.js`** to the existing test runner:

| Test | What it pins down |
|------|-------------------|
| `parseSnapshot(json)` rejects bad shape | Schema validation round-trip. |
| `parseSnapshot(json)` rejects unknown backend names | Closed-world prevents typos. |
| `pEffFromSnapshot(snapshot)` matches the worked example in §3.2 exactly (with rounding) | Stops accidental sign-flips and unit-conversion bugs in CI before they leak. |
| `pEffFromSnapshot(snapshot)` is monotone in `p_2q` and `p_readout` | Catches regression where a refactor accidentally flips a sign or swaps a coefficient. |
| Given a fixed snapshot and a fixed seed, two sweeps through `window.__mcSinglePoint(d=3, p_eff, ...)` return the same `ler` | Locks down determinism for shared links. |

Plus **UI smoke tests** in `test-runner.html`:

1. `parseSnapshot(...)` returns the same `p_eff` for the in-repo
   fixtures in `tests/fixtures/snapshots/ibm_torino.json`.
2. `tests/fixtures/snapshots/ibm_torino.json` is byte-for-byte
   identical to `assets/ibm-snapshots/ibm_torino.json`.
3. A backend whose snapshot 404s falls back to "Synthetic (slider)"
   silently and surfaces a toast.

---

## 7 · Risk register

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Snapshot stale** | Medium | CI auto-fails if its Qiskit token is missing; the user-paste path lets a learner bypass stale data. Add a small `Last verified:` row in the badge. |
| **Per-qubit variation hidden by median** | High | Honest caption explicitly mentions p90 vs median — see `ci.two_qubit_error_p90` in the schema — and clearly says "this is a cartoon." |
| **Threshold vs LER confusion** | Medium | The vertical line is positioned on the *sweep-mode* (LER-vs-p) plot, where the threshold crossing is the conceptual landmark. Single-point mode is unchanged. |
| **Pedagogical over-interpretation: "surface code works on IBM!"** | High | Forced honest caption with "this is a cartoon" language, anchored by the visible vertical line being right of break-even. |
| **Different basis gate per backend (ECR vs CX)** | Low | Schema carries `two_qubit_gate`; if absent we default to ECr. Documented in `assets/hardware.js` JSDoc. |
| **CI dependency drift (qiskit-ibm-runtime version bumps)** | Medium | Pin the Qiskit version in `requirements-ci.txt`. Snapshot refresh is weekly; if it breaks the page silently reverts to "Synthetic". |
| **Snapshot accidentally checked into the wrong branch** | Low | CI commits snapshots to `main` only; PRs touching `assets/ibm-snapshots/` are flagged for review. |

---

## 8 · Milestone breakdown (fits v2.2 slot in `PRODUCT_PLAN.md`)

### M1 (week 7) — math pipeline **without** CI
- New `assets/hardware.js` module exposing:
  - `parseSnapshot(json) → { valid, metrics, ci, ... }`
  - `pEffFromSnapshot(snapshot) → { p_eff, breakdown, snapshot_date, backend_name }`
  - `loadSnapshot(backendName) → Promise<snapshot>`
- New unit suite `tests/hardware.test.js` with the schema / math
  / determinism tests from §6.
- Fixtures in `tests/fixtures/snapshots/ibm_torino.json` (a hand-
  written realistic-but-deterministic snapshot, NOT a CI-generated
  one, so the page works during dev without IBM credentials).
- Reuses the existing `QEC.toast()` / `QEC.announce()` / modal
  helpers from `assets/qec-shared.js`.

### M2 (week 8) — UI integration
- New control group from §4 placed in `noise.html`.
- New modal for the "Paste JSON…" path from §1, including the
  3-line Jupyter snippet.
- Vertical line + 3 markers on the sweep plot, in the same SVG
  namespace as the existing curves.
- Honest caption binding (see §5).
- The `qec-shared.js` `encodeHash` already supports new keys — add
  `hw=<backend>` so existing shared-link patterns still work.

### M3 (week 9) — CI + docs
- New repo-folder `scripts/` (outside `PASSION_PROJECT/` so it
  isn't shipped as part of the web app):
  - `scripts/refresh_ibm_snapshots.py`
  - `scripts/requirements-ci.txt` (pinned `qiskit`, `qiskit-ibm-runtime`)
  - `.github/workflows/refresh-snapshots.yml` running weekly
- `README.md` updated to mention "Live IBM calibration, refreshed
  weekly; for now-accurate data, paste a fresh JSON from your Jupyter."
- `CHANGELOG.md` v2.2 entry under `### Added`.

---

## 9 · What this doc does *not* decide

Out-of-scope, deliberately. These are noted as future work so a
future contributor doesn't re-litigate them:

- **Per-qubit fidelity maps** for the heavy backends — solvable later
  via a separate "usability heatmap" module (v3.x).
- **Real circuit-level `qiskit-aer` simulation** on the Web
  (Pyodide + `qiskit-aer` would be ~80 MB of WASM; out of scope
  for a tool that explicitly values "view source is the docs").
- **Other vendors** (Rigetti, IonQ, Quantinuum). The schema is
  vendor-neutral on purpose; we'd add a parallel fetcher per
  vendor rather than re-designing.

---

## 10 · Cross-references

- `PRODUCT_PLAN.md` §10 (v2.2 ladder, Weeks 7–10)
- `CONTRIBUTING.md` "no build step" doctrine
- `CHANGELOG.md` v2.0 shared-emitter pattern (the "📋 Export"
  buttons are the precedent: emit *something runnable* the user
  takes to a Jupyter cell)
- `noise.html` (current Module 3 surface)
- `decoders.js` lookup/mwpm/bp (consumers of `p` from the slider;
  will transparently work with `p_eff` once the slider is replaced)
- `assets/qec-shared.js` (toast / modal / shared-link glue)

