/* ============================================================
   QEC EXPLORER - tests/qldpc.test.js
   ------------------------------------------------------------
   Tests for qldpc-core.js: the [[144,12,12]] gross code
   (bivariate-bicycle, Bravyi et al. Nature 627, 2024) and its
   BP-OSD decoder.

   Two families of checks:
     1. Code invariants - the DEFINITION of a valid [[144,12,12]]
        CSS code (qubit/check counts, weight-6 checks, commuting
        stabilizers, k = 12). If any of these break, the code we
        drew and decode is not the gross code.
     2. Decoder guarantees - BP-OSD always returns to the codespace,
        corrects every single-qubit error exactly, and its OSD-0
        solve reproduces the syndrome (H*e = s over GF(2)).

   Loaded by tests/test-runner.html as a global `QLDPC`.
   ============================================================ */

QECT.describe("qLDPC · [[144,12,12]] gross-code construction", () => {
  const code = QLDPC.buildGrossCode();

  QECT.it("has 144 physical qubits", () => {
    QECT.assert.equal(code.n, 144);
  });

  QECT.it("has 72 X-checks and 72 Z-checks", () => {
    QECT.assert.equal(code.numXChecks, 72);
    QECT.assert.equal(code.numZChecks, 72);
  });

  QECT.it("every stabilizer check has weight 6", () => {
    QECT.assert.ok(code.xChecks.every(q => q.length === 6), "an X-check was not weight 6");
    QECT.assert.ok(code.zChecks.every(q => q.length === 6), "a Z-check was not weight 6");
  });

  QECT.it("every data qubit is in exactly 3 X-checks and 3 Z-checks", () => {
    QECT.assert.ok(code.qubitXChecks.every(cs => cs.length === 3), "a qubit was not in 3 X-checks");
    QECT.assert.ok(code.qubitZChecks.every(cs => cs.length === 3), "a qubit was not in 3 Z-checks");
  });

  QECT.it("is a valid CSS code: Hx * Hz^T = 0 over GF(2)", () => {
    let bad = 0;
    for (let i = 0; i < code.Hx.length; i++) {
      for (let j = 0; j < code.Hz.length; j++) {
        let s = 0;
        const a = code.Hx[i], b = code.Hz[j];
        for (let t = 0; t < a.length; t++) s ^= (a[t] & b[t]);
        if (s) bad++;
      }
    }
    QECT.assert.equal(bad, 0);
  });

  QECT.it("encodes exactly 12 logical qubits (k = n - rank Hx - rank Hz)", () => {
    QECT.assert.equal(QLDPC.logicalCount(code), 12);
  });
});

QECT.describe("qLDPC · syndrome extraction", () => {
  const code = QLDPC.buildGrossCode();

  QECT.it("a clean state has an all-zero syndrome", () => {
    const s = QLDPC.syndrome(code, QLDPC.blankError(code));
    QECT.assert.ok([...s.x, ...s.z].every(v => v === 0));
  });

  QECT.it("a single X error fires exactly 3 Z-checks and no X-checks", () => {
    const e = QLDPC.blankError(code);
    QLDPC.toggle(e, 37, "X");
    const s = QLDPC.syndrome(code, e);
    QECT.assert.equal([...s.z].reduce((a, v) => a + v, 0), 3);
    QECT.assert.equal([...s.x].reduce((a, v) => a + v, 0), 0);
  });

  QECT.it("a single Z error fires exactly 3 X-checks and no Z-checks", () => {
    const e = QLDPC.blankError(code);
    QLDPC.toggle(e, 90, "Z");
    const s = QLDPC.syndrome(code, e);
    QECT.assert.equal([...s.x].reduce((a, v) => a + v, 0), 3);
    QECT.assert.equal([...s.z].reduce((a, v) => a + v, 0), 0);
  });

  QECT.it("toggling the same Pauli twice is the identity", () => {
    const e = QLDPC.blankError(code);
    QLDPC.toggle(e, 12, "Y");
    QLDPC.toggle(e, 12, "Y");
    QECT.assert.equal(QLDPC.weight(e), 0);
  });
});

QECT.describe("qLDPC · BP-OSD decoder", () => {
  const code = QLDPC.buildGrossCode();

  // Deterministic PRNG so the suite is reproducible run-to-run.
  let seed = 0xC0FFEE;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  QECT.it("a clean input decodes to no correction and stays in the codespace", () => {
    const r = QLDPC.decode(code, QLDPC.blankError(code));
    QECT.assert.equal(r.correctionWeight, 0);
    QECT.assert.ok(r.inCodespace);
    QECT.assert.ok(r.logicalOk);
  });

  QECT.it("corrects every single-qubit X, Z, and Y error exactly (all 432)", () => {
    let bad = [];
    for (let q = 0; q < code.n; q++) {
      for (const p of ["X", "Z", "Y"]) {
        const e = QLDPC.blankError(code);
        QLDPC.toggle(e, q, p);
        const r = QLDPC.decode(code, e);
        if (!r.inCodespace || !r.logicalOk) { bad.push(p + "@" + q); if (bad.length > 3) break; }
      }
    }
    QECT.assert.ok(bad.length === 0, "uncorrected single-qubit errors: " + bad.join(", "));
  });

  QECT.it("ALWAYS returns to the codespace on heavy random errors (the OSD guarantee)", () => {
    let leftCodespace = 0;
    for (let t = 0; t < 120; t++) {
      const w = 1 + Math.floor(rnd() * 8);
      const e = QLDPC.blankError(code);
      const used = new Set();
      for (let i = 0; i < w;) {
        const q = Math.floor(rnd() * code.n);
        if (used.has(q)) continue; used.add(q); i++;
        QLDPC.toggle(e, q, ["X", "Z", "Y"][Math.floor(rnd() * 3)]);
      }
      const r = QLDPC.decode(code, e);
      if (!r.inCodespace) leftCodespace++;
    }
    QECT.assert.equal(leftCodespace, 0);
  });

  QECT.it("the correction reproduces the syndrome exactly (H*e = s over GF(2))", () => {
    let bad = 0;
    for (let t = 0; t < 40; t++) {
      const w = 3 + Math.floor(rnd() * 5);
      const e = QLDPC.blankError(code);
      const used = new Set();
      for (let i = 0; i < w;) {
        const q = Math.floor(rnd() * code.n);
        if (used.has(q)) continue; used.add(q); i++;
        QLDPC.toggle(e, q, "X");
      }
      const s = QLDPC.syndrome(code, e);
      const r = QLDPC.decode(code, e);
      // X-errors are caught by Z-checks; the X-correction must reproduce s.z.
      const reproduced = QLDPC.applyChecks(code.zChecks, r.correction.x);
      for (let i = 0; i < s.z.length; i++) if (reproduced[i] !== s.z[i]) { bad++; break; }
    }
    QECT.assert.equal(bad, 0);
  });

  QECT.it("OSD-0 solve on the sparse H satisfies H*e = syndrome directly", () => {
    // Build a random X-error, take its Z-check syndrome, solve, verify.
    const e = QLDPC.blankError(code);
    QLDPC.toggle(e, 4, "X"); QLDPC.toggle(e, 55, "X"); QLDPC.toggle(e, 130, "X");
    const s = QLDPC.syndrome(code, e);
    const order = Array.from({ length: code.n }, (_, i) => i);
    const sol = QLDPC.osd0Solve(code.zChecks, s.z, code.n, order);
    const reproduced = QLDPC.applyChecks(code.zChecks, sol);
    let match = true;
    for (let i = 0; i < s.z.length; i++) if (reproduced[i] !== s.z[i]) { match = false; break; }
    QECT.assert.ok(match, "osd0Solve did not reproduce the syndrome");
  });
});
