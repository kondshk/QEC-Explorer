# QEC Explorer · Product Plan

> **Status:** Living document. This is the master plan for taking QEC
> Explorer from "a working single-page tool with a few companion"
> to a polished platform that someone in the IBM Quantum or
> open-source-quantum community can ship behind their org.

---

## 1 · The vision

> **QEC Explorer is the most clonable, link-shareable, honestly-visualized
> open-source playground for how a quantum computer protects its
> information. Anyone who can click a link can decode a syndrome. Anyone
> who can write a unit test can add a decoder. Anyone who can write a
> paragraph can add a step to the basics primer.**

If two things are true after v2.0 ships, we've succeeded:

1. Plug "QEC visualizer" into a search engine - ours is what's returned.
2. A reading-level-10 student can finish Module 1 with a working
   intuition for what a stabilizer is, and a specialist can finish
   Module 3 with the same number that `decoders.js` returns on the same
   input.

---

## 2 · Current state - what's working

| Feature | Where it lives | Status |
| --- | --- | --- |
| Surface-code playground | `index.html` · Module 1 | ✅ Polished |
| Decoder race (lookup / MWPM / BP) | `decoder.html` · Module 2 | ✅ Polished |
| Monte-Carlo threshold explorer | `noise.html` · Module 3 | ✅ Polished |
| Quantum basics primer (5 steps) | `basics.html` · Module 0 | ✅ Polished |
| Landing page (plain English) | `landing.html` | ✅ Polished |
| Daily puzzle | `puzzle.html` | ✅ Polished |
| Research-connection narrative | `research.html` | ✅ Polished |
| 6 Python companion notebooks | `notebook0X_*` | ✅ Polished |
| Honest captions on every numerical output | embedded in JS | ✅ Yes |
| No-cookies counter | `counter.js` | ✅ Degrades gracefully |
| URL-hash deep linking on every page | various | ✅ Yes |
| Native Share Sheet + clipboard fallback | various | ✅ Yes |
| Keyboard nav, screen-reader live, reduced-motion | inline | ✅ Yes, partial |

## 3 · Current state - what was missing

| Gap | What this fixes |
| --- | --- |
| **Token system fragmented across 7 files** | A 60-line `:root{...}` block had been copied to every page by hand. Any color tweak meant seven edits. |
| **No automated tests** | Algorithms were verified by inspection only. Each new contributor would re-verify by re-reading. |
| **No contributing guide** | Newcomers had to infer the dev loop from the README. |
| **No design infrastructure** | Every new page started from a copy-paste of the inline CSS. |
| **No "what's an error" API for power users** | The `lattice-core.js` functions existed but were not exposed as a runnable playground beyond the notebook. |
| **No shortcut discoverability** | Tab/Enter/Space/Arrow worked but no cheat sheet. |

v2.0 ships the foundations for all six.

---

## 4 · The technical stack - what we're keeping, what we're adding

### Kept (load-bearing, do not replace)

- **lattice-core.js** - surface-code physics. Verified exports
  include `buildCode`, `computeSyndromeFor`, `logicalStatusFor`,
  `cloneErrors`, `combineErrors`, `errorWeight`, `diffErrorKeys`.
- **decoders.js** - lookup, MWPM, BP decoders + `evaluateCorrection`.
- **Notebooks** - six Python notebooks proving the math from scratch.

### Replaced

- Seven inline `<style>` blocks → one shared **`assets/theme.css`**.
- Three Google Fonts (`Instrument Serif`, `Outfit`, `JetBrains Mono`) →
  **IBM Plex Sans + IBM Plex Mono + IBM Plex Serif** for a more
  professional / institutional voice consistent with how serious
  quantum documentation reads. No new dependencies, still via Google
  Fonts.
- Ad-hoc keyboard handlers → centralized in **`assets/qec-shared.js`**.
  Press `?` on any page to open a cheat sheet.

### Added (v2.0)

- **`tests/`** - tiny browser test runner. Open `tests/test-runner.html`
  in any browser; no build, no install.
- **`CHANGELOG.md`** - Keep-a-Changelog 1.1 format.
- **`CONTRIBUTING.md`** - modeled on Qiskit community standards.
- **`PRODUCT_PLAN.md`** - this document.

### Explicitly **not** adding (and why)

| Considered | Why declined |
| --- | --- |
| React / Vue / any framework | Breaks the "view source is the docs" promise. |
| TypeScript | Same. Adds a compiler step. |
| MathJax for equations | Most physics content stays prose. Where it's needed, plain Unicode (`|0⟩`, `β`, `-`) is enough. |
| 3D canvas / WebGL | Surface code is a 2-D layout and that visual language is correct. |
| A real SQL-backed user account system | The counter and puzzle are sufficient, no accounts means GDPR-clean. |

---

## 5 · Audience × feature matrix

The matrix below shows which feature each audience should hit first.

| Audience | Start here | Then | Then |
| --- | --- | --- | --- |
| Curious newcomer | `landing.html` | `basics.html` | `index.html` |
| High school / undergrad | `basics.html` | `index.html` | `decoder.html` |
| Graduate student | `index.html` | `decoder.html` | `noise.html` + NB 02 / 03 |
| Researcher / educator | `research.html` | `noise.html` | NB 04 (qLDPC) / NB 05 (GNN) |
| Contributor | `CONTRIBUTING.md` | `tests/test-runner.html` | `PRODUCT_PLAN.md` |
| Maintainer | `PRODUCT_PLAN.md` | `CHANGELOG.md` | `tests/` |

---

## 6 · Pillar: design system

**The visual identity is "professional, dark, scientific instrument."**

| Decision | Why |
| --- | --- |
| Dark theme only | Lab tools are dark. Quantum-themed design literature skews dark. Carbon's dark palette is mature. |
| IBM Plex Sans + IBM Plex Mono | Standard for serious quantum documentation. Free under SIL OFL. |
| Domain-aware token names (`--pauli-x`, `--stab-z`, `--syndrome`) | Code reads like the physics it represents. |
| Generous spacing | Components breathe. Spacing scale is 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. |
| Hairline borders | Defines cards without dominating them. |
| Sharp 4 px corners for buttons, generous 8 / 12 px for cards | Hierarchy without being trendy. |
| Focus rings ALWAYS 2 px solid `--focus` blue | Accessibility first, WCAG 2.4.7. |

Where we deliberately **don't** ape Carbon:

- We allow rounded card corners (4 px for buttons, 8 px for panels,
  12 px for hero cards). Carbon is famously sharp-cornered everywhere;
  for an educational tool, a softer card feels more inviting.
- We rely on hand-written SVG for the lattice, not Carbon's icon library.

---

## 7 · Pillar: testability

Adopted the **"every exported function gets its regression test"** rule.

Coverage snapshot (v2.0):

| Function | Tested in | Notes |
| --- | --- | --- |
| `buildCode` | syndrome.test.js | All d, commutation, boundary-weight-2 rule. |
| `computeSyndrome` | syndrome.test.js | Every error class. |
| `logicalStatus` | syndrome.test.js | Full-column X, full-row Z both detect. |
| `withErrors` indirection | syndrome.test.js | State mutation guard. |
| `combineErrors` | syndrome.test.js | Identity cancellation. |
| `mwpmDecode` | decoder.test.js | Single X, single Z, 2-X pattern. |
| `bpDecode` | decoder.test.js | Single X, Y, convergence cap, marginal validity. |
| `lookupDecode` | lookup.test.js | All 27 single-qubit errors, weight-2 pair, degenerate syndromes. |
| `evaluateCorrection` | decoder.test.js | All 3 statuses. |

Future tests that haven't yet landed:

| Function | Planned |
| --- | --- |
| MWPM on the famous `Z@1,2` boundary trap | Coming in v2.1 |
| BP-OSD hybrid (a real research decoder) | v3.0 |
| A surface code at d=11 with threshold sweep purity | v3.0 |

---

## 8 · Pillar: developer experience

| Concern | Addressed by |
| --- | --- |
| "How do I run the tests?" | Open `tests/test-runner.html`. |
| "How do I add a test?" | Append to one of the three test files; match the pattern. |
| "How do I run a real bench?" | `noise.html` already does it interactively. |
| "What language is this?" | Plain JS, no TypeScript, no JSX, no transpile step. |
| "How do I style a new button?" | Read `assets/theme.css`; use existing token names. |

---

## 9 · Gap analysis against a hypothetical "Downstream Adopt" target

| What a downstream would check | Today |
| --- | --- |
| TOML-correct package.json for npm packaging | (Not needed; static site ships as files.) |
| License header on every source file | ✅ Yes, MIT. |
| Counterpart license for any vendored fonts/icons | IBM Plex: SIL OFL ✅. No vendored icons. |
| README has screenshots or GIFs | Currently ASCII layout descriptions; screenshots planned for v2.1. |
| Discovery: tags / topics on a registry | N/A (no npm yet). |
| License compatibility with CC-BY content | ✅ No CC-BY content; all original. |
| Trademark concerns | ✅ No Qiskit or IBM logos; uses IBM Plex (open font). |
| Accessibility: WCAG 2.1 AA | In progress; ARIA roles + keyboard nav + SR live in place. Full audit planned v2.1. |
| Privacy: no third-party trackers | ✅ Only one optional counter, anonymous. |
| Internationalization | UI strings are inline; extracted i18n layer planned v3.0. |

---

## 10 · Roadmap - *90 days*

### Week 1-2 · v2.0 (this release)

- [x] Shared theme system (`assets/theme.css`, `qec-shared.js`,
      `qec-modal.css`)
- [x] Browser test runner + 3 test suites
- [x] `CHANGELOG.md`, `CONTRIBUTING.md`, `PRODUCT_PLAN.md`
- [x] `?` keyboard shortcut overlay on every page

### Week 3-6 · v2.1 - *Look like it was made for IBM Quantum*

- [ ] Screenshot pass: 14 images (one per module) under `docs/img/`
- [ ] Light theme equivalent of `theme.css` - `media (prefers-color-scheme: light)`
- [ ] WCAG 2.1 AA audit pass; contrast fixes
- [ ] Extract strings to `assets/i18n/en.json` (en only at first)
- [ ] New optional decoder: **BP-OSD** (post-processing by ordered
      statistics on Gaussian-eliminated stabilizers - the workhorse of
      real-life decoding)

### Week 7-10 · v2.2 - *Live with qiskit*

- [ ] A "load a Pauli error from a string" importer - paste from a
      Qiskit `SparsePauliOp` into the playground.
- [ ] Python companion: `qec_explorer.py` with a Jupyter-friendly
      API that wraps `lattice-core.js` (via Pyodide) and `decoders.js`
      (via the existing `module.exports`).

### Week 11-14 · v3.0 - *The real frontier*

- [ ] Module 4 · **qLDPC lattice**: a bivariate-bicycle
      [[144,12,12]] code, the GNN-OSD decoder wired up, and
      honest benchmarks against MWPM.
- [ ] An instructor mode that supports printing a quiz endpoint
      with one error pattern and the correct decoder answer at the
      bottom (PDF-friendly print stylesheet).
- [ ] Optional Qiskit job integration: paste a
      `qiskit.quantum_info.SparsePauliOp` that came out of an IBM
      Cloud backend error-correction experiment, replay it locally,
      see what the decoders would have done.

---

## 11 · Risk register

| Risk | Mitigation |
| --- | --- |
| IBM/Carbon trademark concerns | We deliberately do NOT use IBM or Qiskit logos. We use IBM Plex (open font) and design idioms inspired by Carbon. |
| Performance regression on mobile | Theme.css is 9 KB gzipped; no extra DOM nodes added. |
| External counter dependency | Already gracefully degrades to hidden UI on failure. |
| Future Qiskit SDK breakage | None - no SDK dependency; only our own JS. |
| Browser compat | Target evergreen: Chrome, Firefox, Safari 14+. No IE. No outbound compat Shim. |
| AI-generated content flags | All content is original, manually written; sources cited. |

---

## 12 · Acceptance criteria - when is v2.0 "done"?

A reviewer should be able to say yes to each:

1. **Open `assets/theme.css`** and see **every** color / spacing /
   radius token used in any page. No orphaned values.
2. **Open `tests/test-runner.html`** and see **all suites passing**,
   with a green total.
3. **Press `?` on any page** and see a cheat sheet that lists the
   page's keyboard shortcuts.
4. **Read `CONTRIBUTING.md`** end-to-end and feel ready to send the
   first PR.
5. **Read this document** and understand the 90-day roadmap.
6. **Open any page** and feel the typography, spacing, and color
   hierarchy match across the whole site.

---

## 13 · License and upstream acknowledgement

- App source: **MIT** (see `LICENSE`).
- IBM Plex Sans / Mono / Serif fonts: **SIL Open Font License 1.1**.
- Design vocabulary inspired by **IBM Carbon Design System** (MIT
  license for token API patterns); no IBM assets are vendored.
- All quantum-domain physical content (surface code, decoders,
  threshold theory) is original or properly cited.

No third-party quantum-computing trademarks appear in the UI.
