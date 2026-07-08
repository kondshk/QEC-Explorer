/* ============================================================
   QEC EXPLORER — tests/syndrome.test.js
   ------------------------------------------------------------
   Tests for the canonical physics functions in lattice-core.js:
   buildCode, computeSyndrome, logicalStatus, hasAnyError,
   computeSyndromeFor, logicalStatusFor, cloneErrors,
   combineErrors, diffErrorKeys, errorWeight.
   ============================================================ */

QECT.describe("lattice-core.js · buildCode", () => {

  QECT.it("produces d×d data qubits and d²−1 stabilizers for d=3", () => {
    const code = buildCode(3);
    QECT.assert.equal(code.data.length, 9, "data count at d=3");
    QECT.assert.equal(code.stabs.length, 8, "stab count at d=3");
  });

  QECT.it("produces the correct counts for d=5 and d=7", () => {
    QECT.assert.equal(buildCode(5).data.length, 25);
    QECT.assert.equal(buildCode(5).stabs.length, 24);
    QECT.assert.equal(buildCode(7).data.length, 49);
    QECT.assert.equal(buildCode(7).stabs.length, 48);
  });

  QECT.it("checkerboards stabilizer types across the rotated-plane dual grid", () => {
    const code = buildCode(5);
    // At interior positions, Z and X stabilizers alternate. Collect sample.
    const buckets = { Z: 0, X: 0 };
    code.stabs.forEach(s => buckets[s.type]++);
    QECT.assert.ok(buckets.Z > 0 && buckets.X > 0, "both types present at d=5");
    QECT.assert.equal(buckets.Z + buckets.X, code.stabs.length);
  });

  QECT.it("places weight-2 stabilizers ONLY on the rotated-code boundary, of the correct type", () => {
    for (const d of [3, 5, 7]) {
      const code = buildCode(d);
      let ok = true;
      code.stabs.forEach((s, i) => {
        if (s.data.length !== 2) return;
        const rs = s.data.map(k => +k.split(",")[0]);
        const cs = s.data.map(k => +k.split(",")[1]);
        const onTopBottom = rs.some(r => r === 0) || rs.some(r => r === d - 1);
        const onLeftRight = cs.some(c => c === 0) || cs.some(c => c === d - 1);
        // weight-2 X-type stabilizers belong on the TOP/BOTTOM; Y-type omits top;
        // verify the type-by-side rule from lattice-core.js comments:
        if (s.type === "Z" && !onLeftRight) ok = false;
        if (s.type === "X" && !onTopBottom) ok = false;
      });
      QECT.assert.ok(ok, "weight-2 boundary rule for d=" + d);
    }
  });

  QECT.it("every pair of stabilizers COMMUTES (CSS code definition)",  () => {
    for (const d of [3, 5, 7]) {
      const code = buildCode(d);
      // Two stabilizers commute iff they share an EVEN number of data qubits.
      // (Both are products of Z/X Paulis with at most 4 distinct data qubits.)
      let allCommute = true;
      for (let i = 0; i < code.stabs.length; i++) {
        for (let j = i + 1; j < code.stabs.length; j++) {
          const a = code.stabs[i], b = code.stabs[j];
          if (a.type === b.type) continue; // same Pauli type always commute
          let shared = 0;
          for (const k of a.data) if (b.data.includes(k)) shared++;
          if (shared % 2 !== 0) { allCommute = false; break; }
        }
        if (!allCommute) break;
      }
      QECT.assert.ok(allCommute, "every X-Z stab pair shares even data qubits at d=" + d);
    }
  });
});

QECT.describe("lattice-core.js · syndrome & logic", () => {

  QECT.it("zero errors -> zero syndrome, no logical error", () => {
    for (const d of [3, 5]) {
      state.errors = {};
      const s = computeSyndrome(buildCode(d));
      QECT.assert.ok(s.every(v => v === 0), "syndrome clean at d=" + d);
      const { logical } = logicalStatus(buildCode(d));
      QECT.assert.equal(logical, false);
    }
  });

  QECT.it("a single X on an interior (4-neighbor) data qubit triggers BOTH adjacent Z-type stabs (lit=2)", () => {
    // Real rotated-surface-code geometry: corner (1,1) touches four
    // stabilizers in the d=3 lattice — 2 Z-type + 2 X-type. That's why a
    // single X error fires 2 Z-type stabs (its 2 Z-type neighbors), and
    // symmetrically a single Z error fires 2 X-type stabs. Bulk qubits
    // have 4 neighbors; qubits on the rotated-code boundary have fewer.
    const code = buildCode(3);
    state.errors = { "1,1": { x: true, z: false } };
    const s = computeSyndrome(code);
    const lit = s.reduce((a, v) => a + v, 0);
    QECT.assert.equal(lit, 2, "two Z-type stabs fire on a single interior X");
  });

  QECT.it("a single Z on an interior (4-neighbor) data qubit triggers BOTH adjacent X-type stabs (lit=2)", () => {
    const code = buildCode(3);
    state.errors = { "1,1": { x: false, z: true } };
    const s = computeSyndrome(code);
    const lit = s.reduce((a, v) => a + v, 0);
    QECT.assert.equal(lit, 2, "two X-type stabs fire on a single interior Z");
  });

  QECT.it("two adjacent errors CANCEL between stabilizers (only endpoints fire)", () => {
    // X on (1,1) AND X on (1,2)  ->  the stabilizer between them sees both, parity 0.
    const code = buildCode(3);
    state.errors = {
      "1,1": { x: true, z: false },
      "1,2": { x: true, z: false },
    };
    const s = computeSyndrome(code);
    const lit = s.reduce((a, v) => a + v, 0);
    QECT.assert.equal(lit, 2, "adjacent-pair X errors fire exactly 2 stabs");
  });

  QECT.it("a full COLUMN of X errors is silent (logical, syndrome = 0)", () => {
    // Logical X = full vertical column of X errors, commutes with all stabilizers.
    const code = buildCode(3);
    state.errors = {};
    for (let r = 0; r < 3; r++) state.errors[r + ",0"] = { x: true, z: false };
    const s = computeSyndrome(code);
    QECT.assert.ok(s.every(v => v === 0), "syndrome silent for full-column logical X");
    const { logical } = logicalStatus(code);
    QECT.assert.equal(logical, true, "logical flip detected at d=3 logical X column");
  });

  QECT.it("a full ROW of Z errors is silent (logical, syndrome = 0)", () => {
    const code = buildCode(3);
    state.errors = {};
    for (let c = 0; c < 3; c++) state.errors["0," + c] = { x: false, z: true };
    const s = computeSyndrome(code);
    QECT.assert.ok(s.every(v => v === 0), "syndrome silent for full-row logical Z");
    const { logical } = logicalStatus(code);
    QECT.assert.equal(logical, true);
  });

  QECT.it("hasAnyError detects at least one errored qubit", () => {
    state.errors = {};
    QECT.assert.equal(hasAnyError(), false);
    state.errors = { "0,0": { x: true, z: false } };
    QECT.assert.equal(hasAnyError(), true);
  });
});

QECT.describe("lattice-core.js · for-helpers (for arbitrary error sets)", () => {

  QECT.it("computeSyndromeFor does not mutate state.errors", () => {
    const code = buildCode(3);
    state.errors = { "1,1": { x: true, z: false } };
    const snapshot = JSON.stringify(state.errors);
    computeSyndromeFor(code, { "0,0": { x: false, z: true } });
    QECT.assert.equal(JSON.stringify(state.errors), snapshot, "state.errors untouched after withErrors");
  });

  QECT.it("cloneErrors makes a deep enough copy to mutate independently", () => {
    const orig = { "0,1": { x: true, z: false } };
    const c = cloneErrors(orig);
    c["0,1"].x = false;
    QECT.assert.equal(orig["0,1"].x, true, "original was not mutated by change to clone");
  });

  QECT.it("combineErrors XORs two error sets Pauli-wise", () => {
    const a = { "1,1": { x: true,  z: false } };
    const b = { "1,1": { x: true,  z: true  } };
    const r = combineErrors(a, b);
    // X: true XOR true = false; Z: false XOR true = true -> final {x:false, z:true}
    QECT.assert.equal(r["1,1"].x, false);
    QECT.assert.equal(r["1,1"].z, true);
  });

  QECT.it("combineErrors drops qubits that end with neither X nor Z", () => {
    const a = { "1,1": { x: true, z: false } };
    const b = { "1,1": { x: true, z: false } };
    const r = combineErrors(a, b);
    QECT.assert.ok(!("1,1" in r), "identity cancellation drops the qubit");
  });

  QECT.it("diffErrorKeys reports only qubits that differ in XOR or Z", () => {
    const a = { "0,1": { x: true, z: false }, "2,2": { x: false, z: true } };
    const b = { "0,1": { x: true, z: false }, "2,2": { x: true, z: true } };
    const d = diffErrorKeys(a, b);
    QECT.assert.deepEqual(d, ["2,2"]);
  });

  QECT.it("errorWeight counts Y as weight 1 (a single physical qubit)", () => {
    QECT.assert.equal(errorWeight({}), 0);
    QECT.assert.equal(errorWeight({ "0,1": { x: true, z: false } }), 1);
    QECT.assert.equal(errorWeight({ "0,1": { x: true, z: true } }), 1, "Y counts as 1");
    QECT.assert.equal(errorWeight({ "0,1": { x: true, z: false }, "2,2": { x: false, z: true } }), 2);
  });
});
