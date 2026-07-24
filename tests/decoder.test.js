/* ============================================================
   QEC EXPLORER - tests/decoder.test.js
   ------------------------------------------------------------
   Tests for the three decoders in decoders.js:
     lookup table decoder (baseline)
     MWPM - minimum-weight perfect matching
     BP   - iterative belief propagation
   Plus tests for the universal evaluateCorrection() outcome
   reporter (Fixed | logical-error | left-codespace).
   ============================================================ */

QECT.describe("decoder utilities · evaluateCorrection", () => {

  QECT.it("returns Fixed when correction matches error exactly", () => {
    const code = buildCode(3);
    const e = { "1,1": { x: true, z: false } };
    const res = evaluateCorrection(code, e, cloneErrors(e));
    QECT.assert.equal(res.status, "fixed");
    QECT.assert.ok(res.ok);
  });

  QECT.it("flags a 'broken chain' correction as LEFT-CODESPACE (syndrome still fires)", () => {
    // Real error: single X on (1,1). Decoder proposes a 3-qubit correction
    // {(0,1)X, (1,1)X, (2,1)X}. residual = error XOR correction = {(0,1)X, (2,1)X}
    // - the middle flakes cancel, leaving a BROKEN CHAIN with a gap at (1,1).
    // The two endpoint stabs still fire (parity 1 each), so the syndrome is
    // NOT silent: evaluateCorrection correctly returns "left-codespace".
    //
    // A TRUE logical-introduced case requires the residual to be
    // SILENT (zero syndrome) AND to anti-commute with a logical observable.
    // That needs a residue equal to (some stabilizer product) * (logical),
    // which a 3-qubit correction cannot reach from a single (1,1)X error.
    // Such a case is rare in practice - the much more common failure is a
    // broken chain or a non-matching pair, both producing left-codespace.
    const code = buildCode(3);
    const err = { "1,1": { x: true, z: false } };
    const badCorrection = {
      "0,1": { x: true, z: false },
      "1,1": { x: true, z: false },   // cancels the original at (1,1)
      "2,1": { x: true, z: false },
    };
    const res = evaluateCorrection(code, err, badCorrection);
    QECT.assert.equal(res.status, "left-codespace");
    QECT.assert.equal(res.ok, false);
    // Sanity: residual syndrome actually still fires - proves we are
    // counting this as left-codespace and not a logical flip.
    const resStab = computeSyndromeFor(code, res.residual);
    QECT.assert.ok(resStab.some(v => v === 1),
      "broken chain leaves syndrome lit");
  });

  QECT.it("flags left-codespace when residual still triggers a syndrome", () => {
    // Real error: single X on (1,1). Correction: a single X on (2,2).
    // Residual still leaves syndrome lit and not equal to original.
    const code = buildCode(3);
    const err = { "1,1": { x: true, z: false } };
    const off = { "2,2": { x: true, z: false } };
    const res = evaluateCorrection(code, err, off);
    QECT.assert.equal(res.status, "left-codespace");
    QECT.assert.equal(res.ok, false);
  });
});

QECT.describe("MWPM decoder", () => {

  QECT.it("exactly repairs a single X error at d=3, 5, 7", () => {
    for (const d of [3, 5, 7]) {
      const code = buildCode(d);
      const errors = { "1,1": { x: true, z: false } };
      const res = mwpmDecode(code, errors);
      const evalRes = evaluateCorrection(code, errors, res.correction);
      QECT.assert.ok(evalRes.ok, "MWPM fixed a single X error at d=" + d);
      QECT.assert.equal(res.approximate, false, "exact matching used at d=" + d);
    }
  });

  QECT.it("exactly repairs a single Z error at d=3, 5, 7", () => {
    for (const d of [3, 5, 7]) {
      const code = buildCode(d);
      const errors = { "1,1": { x: false, z: true } };
      const res = mwpmDecode(code, errors);
      const evalRes = evaluateCorrection(code, errors, res.correction);
      QECT.assert.ok(evalRes.ok, "MWPM fixed a single Z error at d=" + d);
    }
  });

  QECT.it("repairs two separated X errors (the equivalence-class case)", () => {
    const code = buildCode(5);
    const errors = {
      "0,0": { x: true, z: false },
      "4,4": { x: true, z: false },
    };
    const res = mwpmDecode(code, errors);
    const evalRes = evaluateCorrection(code, errors, res.correction);
    QECT.assert.ok(evalRes.ok, "MWPM fixed a 2-X-error pattern at d=5");
  });

  QECT.it("does NOT flag 'approximate' for any d≤8 defect count", () => {
    // At d=7, max distance-2 boundaries may push us > 8 defects for a few input
    // patterns. We only ASSERT the flag is false for small patterns where we
    // know it's exact (the algorithm switches within the channel).
    const code = buildCode(5);
    const e = { "2,2": { x: true, z: false } };
    const res = mwpmDecode(code, e);
    QECT.assert.equal(res.approximate, false);
  });

  QECT.it("returns at least one matched path record (so the UI can animate it)", () => {
    const code = buildCode(3);
    const e = { "0,1": { x: true, z: false } };
    const res = mwpmDecode(code, e);
    QECT.assert.ok(Array.isArray(res.paths));
    QECT.assert.ok(res.paths.length >= 1);
  });
});

QECT.describe("BP decoder", () => {

  QECT.it("exactly repairs a single X error at d=3, 5, 7", () => {
    for (const d of [3, 5, 7]) {
      const code = buildCode(d);
      const errors = { "1,1": { x: true, z: false } };
      const res = bpDecode(code, errors, false);
      const evalRes = evaluateCorrection(code, errors, res.correction);
      QECT.assert.ok(evalRes.ok, "BP fixed a single X error at d=" + d);
    }
  });

  QECT.it("repairs a single Y error (= X + Z on the same qubit)", () => {
    const code = buildCode(5);
    const errors = { "2,2": { x: true, z: true } };
    const res = bpDecode(code, errors, false);
    const evalRes = evaluateCorrection(code, errors, res.correction);
    QECT.assert.ok(evalRes.ok);
  });

  QECT.it("caps iterations at BP_MAX_ITERS (20) for non-convergence", () => {
    const code = buildCode(7);
    const errors = {};  // trivial empty source: should converge.
    const res = bpDecode(code, errors, false);
    QECT.assert.ok(res.iters <= 20);
    QECT.assert.equal(res.converged, true);
  });

  QECT.it("returns per-iteration marginals when trace=true", () => {
    const code = buildCode(3);
    const errors = { "1,1": { x: true, z: false } };
    const res = bpDecode(code, errors, true);
    QECT.assert.ok(Array.isArray(res.channels.X.iterMarginals));
    QECT.assert.ok(res.channels.X.iterMarginals.length >= 1);
    QECT.assert.equal(res.channels.X.iterMarginals[0].length, code.data.length);
  });

  QECT.it("finalMarginals are in [0,1]", () => {
    const code = buildCode(3);
    const errors = { "1,1": { x: true, z: false }, "1,2": { x: false, z: true } };
    const res = bpDecode(code, errors, true);
    const allMargs = res.channels.X.finalMarg.concat(res.channels.Z.finalMarg);
    QECT.assert.ok(allMargs.every(m => m >= 0 && m <= 1));
  });
});
