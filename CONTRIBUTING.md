# Contributing to QEC Explorer

> Thank you for your interest in making quantum error correction more
> accessible. QEC Explorer is a community project; we welcome
> contributions of all sizes - typo fixes, new test cases, full
> decoder implementations, or a new educational module.

## Code of conduct

We expect all contributors and maintainers to follow the spirit of the
[Qiskit Code of Conduct](https://github.com/Qiskit/qiskit/blob/main/CODE_OF_CONDUCT.md):

> Be welcoming. Be considerate. Be respectful. Choose your words carefully,
> and assume good faith on the part of your fellow contributors.

Harassment of any kind is not tolerated. Maintainers may remove
contributions, lock threads, or ban accounts that violate these norms.

## Where to start

| You want to... | Start here |
| --- | --- |
| Fix a typo or improve wording | Open a PR directly against the page. |
| Add a unit test | Add to `tests/syndrome.test.js`, `tests/decoder.test.js`, or `tests/lookup.test.js`. |
| Fix a bug in the lattice or decoders | Open an Issue first; talk through the fix. |
| Add a new educational module | Open a Discussion; we'll co-design the scope. |
| Improve the design / accessibility | Open a PR; small enough to review. |

## Development setup

QEC Explorer has **zero build step** and **zero runtime dependencies**.

```bash
git clone <repo>
cd PASSION_PROJECT
python -m http.server 8000      # any static file server works
# then open http://localhost:8000/detection.html
```

For tests:

```bash
# Open tests/test-runner.html in a browser. Tests run on load.
# All tests should pass before submitting a PR.
```

For Node-based testing (useful in CI):

```bash
# decoders.js exposes module.exports when loaded in Node.
node -e "
  global.state = { errors: {} };
  const d = require('./decoders.js');
  // ... write your assertions
"
```

> The `state` global is required by `lattice-core.js`. Test files set
> it explicitly because `lattice-core.js` guards against an undefined
> reference (`var state = (typeof state !== 'undefined' && state) ? state : { errors: {} };`).

## Pull request checklist

- [ ] All tests pass in `tests/test-runner.html`
- [ ] The change keeps the "no build step, no dependencies, no CDN" contract
      (Google Fonts is the only external request, and even that is
      optional - pages should look acceptable with system fallbacks)
- [ ] No new global pollution besides the `QEC.*` namespace
- [ ] New class names are prefixed and live in `theme.css`
      (avoid scattering new design tokens across pages)
- [ ] Keyboard nav verified for any new interactive widget:
      Tab-order makes sense, Enter/Space activates buttons,
      Escape closes modals, `?` opens cheat sheet
- [ ] Updates to `decoders.js` come with a paired regression test in
      `tests/decoder.test.js`
- [ ] Updates to `lattice-core.js` come with a paired regression test
      in `tests/syndrome.test.js`

## Coding style

QEC Explorer uses **plain JS**, **plain CSS**, **plain HTML**. The lint:
"Read the file aloud. Would you keep reading?"

A few rules of thumb:

1. **No frameworks, ever.** We considered React; we said no. The
   shipping artifact is six `.html` files plus three `.js` files.
   Adding React would break the "`view source` is the documentation"
   promise.
2. **No bundlers.** Each file is independently readable.
3. **One source of truth per concept.** `lattice-core.js` is where
   the surface code lives. Don't re-implement `buildCode` in a page.
   Don't re-implement `computeSyndrome` in a notebook.
4. **Mutate, don't recreate.** Each page caches DOM nodes in a
   `nodeMap` and only changes attributes on click. No `innerHTML`
   rewrites for lattice nodes.
5. **Comments are the truth.** If a comment explains a tricky
   invariant ("X → labels.X detector parity"), it should still be
   true after your change.

## Testing policy

- Every commit to `decoders.js` / `lattice-core.js` MUST come with
  at least one paired regression test. The test runner is in the repo
  at `tests/test-runner.html`.
- "It still works in my browser" is not a test.
- CI runs the Node form of every test file on every PR.

## Label taxonomy

We follow the same label taxonomy as the wider Qiskit / quantum-OSS
community, so cross-repo maintainers can route PRs without context-switch
overhead:

| Label | Color | Meaning |
| --- | --- | --- |
| `good first issue` | `#7057ff` | Tiny scope; perfect for a first PR. |
| `help wanted` | `#008672` | Maintainer bandwidth is welcome. |
| `bug` | `#d73a4a` | Something is broken and we can reproduce. |
| `enhancement` | `#a2eeef` | New behavior the existing API doesn't support. |
| `docs` | `#0075ca` | Documentation only (no code change). |
| `design` | `#bfd4f2` | UX / visual / accessibility. |
| `algorithm` | `#fbca04` | Quantum-physics correctness. |
| `wontfix` | `#ffffff` | Considered and declined - please read the conversation. |
| `duplicate` | `#cfd3d7` | Already covered. |

## Release process

1. Bump `version` in `package.json` if a manifest is added later. (For
   now the version lives in `CHANGELOG.md`.)
2. Update `CHANGELOG.md` with the new version's changes.
3. Open a PR titled `chore(release): vX.Y.Z`.
4. Tag the merge commit `vX.Y.Z`.

## Contact

For sensitive issues (security, conduct), open a private security
advisory. For everything else, open a Discussion or Issue.
