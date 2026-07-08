/* ============================================================
   QEC EXPLORER — tests/lookup.test.js
   ------------------------------------------------------------
   Tests for the syndrome-table decoder at d=3 and its
   explicit unavailability at d != 3.
   ============================================================ */

QECT.describe("Lookup decoder", () => {

  QECT.it("is available ONLY at d=3", () => {
    QECT.assert.ok(buildLookupTable(buildCode(3)) != null);
    QECT.assert.equal(buildLookupTable(buildCode(5)), null);
    QECT.assert.equal(buildLookupTable(buildCode(7)), null);
  });

  QECT.it("exactly repairs every single-qubit X, Y, Z at d=3", () => {
    const code = buildCode(3);
    const table = buildLookupTable(code);
    const species = [
      ["X", { x: true,  z: false }],
      ["Z", { x: false, z: true  }],
      ["Y", { x: true,  z: true  }],
    ];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        for (const [name, e] of species) {
          const err = { [r + "," + c]: e };
          const res = lookupDecode(code, table, err);
          const evalRes = evaluateCorrection(code, err, res.correction);
          QECT.assert.ok(evalRes.ok, "single " + name + " on (" + r + "," + c + ") was fixed");
        }
      }
    }
  });

  QECT.it("returns symmetric behavior for weight-2 X-error pairs", () => {
    const code = buildCode(3);
    const table = buildLookupTable(code);
    const err = {
      "0,0": { x: true, z: false },
      "2,2": { x: true, z: false },
    };
    const res = lookupDecode(code, table, err);
    const evalRes = evaluateCorrection(code, err, res.correction);
    QECT.assert.ok(evalRes.ok, "weight-2 separated X pair at d=3 was fixed by lookup");
  });

  QECT.it("marks degenerate syndromes when an equally-weighted alternative exists", () => {
    // Syndromes with multiple equally-likely minimal-weight corrections are
    // marked degenerate. Build the table, then check that for at least one
    // syndrome we encounter a recorded correction whose `degenerate` flag
    // is exposed.
    const code = buildCode(3);
    const table = buildLookupTable(code);
    let sawDegenerate = false;
    table.forEach((entry) => { if (entry.degenerate) sawDegenerate = true; });
    QECT.assert.ok(sawDegenerate, "at least one syndrome has a documented equal-weight alternative");
  });

  QECT.it("the syndrome key deterministically round-trips", () => {
    const code = buildCode(3);
    const k1 = computeSyndromeFor(code, { "1,1": { x: true, z: false } }).join("");
    const k2 = computeSyndromeFor(code, { "1,1": { x: true, z: false } }).join("");
    QECT.assert.equal(k1, k2);
  });
});
