/* ============================================================
   QEC EXPLORER — tests/openqasm.test.js
   ------------------------------------------------------------
   Pure-assertion tests for the OpenQASM 3 emitter in
   assets/qec-openqasm.js. Asserts that emitted text:
     - begins with the literal OPENQASM 3 header
     - declares the right number of data + ancilla qubits
     - emits gates whose data index matches r*D + c (row-major)
     - splits Y errors into X then Z on the same data index
     - emits an empty-state placeholder when there are no errors
     - emits exactly D^2 - 1 measure statements (= stabilizer count)
     - rejects invalid distances
     - emits a Python-shaped noise template that imports Qiskit
     - emits a labeled correction block when correction is provided
============================================================ */

QECT.describe("OpenQASM 3 emitter", () => {

  QECT.it("starts with OPENQASM 3.0 header and includes stdgates", () => {
    const out = QecOQ3.emit({ d: 3, errors: {} });
    QECT.assert.ok(out.startsWith("OPENQASM 3.0;"), "header begins with OPENQASM 3.0;");
    QECT.assert.ok(out.includes('include "stdgates.inc";'), "include stdgates.inc");
  });

  QECT.it("declares D^2 data qubits and D^2-1 ancillas for d in {3,5,7}", () => {
    for (const d of [3, 5, 7]) {
      const out = QecOQ3.emit({ d: d, errors: {} });
      const m = out.match(/qubit\[(\d+)\] data;\s*qubit\[(\d+)\]\s+anc/);
      QECT.assert.ok(m, "data + anc lines both present at d=" + d);
      QECT.assert.equal(Number(m[1]), d * d, "data count = D^2 at d=" + d);
      QECT.assert.equal(Number(m[2]), d * d - 1, "anc count = D^2 - 1 at d=" + d);
    }
  });

  QECT.it("emits data[r*D+c] for sorted error keys at d=3", () => {
    const out = QecOQ3.emit({
      d: 3,
      errors: {
        "2,0": { x: false, z: true },    // idx = 2*3+0 = 6
        "1,1": { x: true,  z: false },   // idx = 1*3+1 = 4
      },
    });
    const x4 = out.indexOf("x data[4];");
    const z6 = out.indexOf("z data[6];");
    QECT.assert.ok(x4 > 0, "x at idx 4 emitted");
    QECT.assert.ok(z6 > 0, "z at idx 6 emitted");
    QECT.assert.ok(x4 < z6, "x emitted before z (key-sorted alpha order)");
  });

  QECT.it("splits a Y error into x then z on the same data index", () => {
    const out = QecOQ3.emit({ d: 3, errors: { "0,0": { x: true, z: true } } });
    const x0 = out.indexOf("x data[0];");
    const z0 = out.indexOf("z data[0];");
    QECT.assert.ok(x0 > 0 && z0 > 0, "both x and z on idx 0 emitted");
    QECT.assert.ok(x0 < z0, "x emitted before z (Y emit order)");
  });

  QECT.it("empty errors produces an explicit '(none)' marker", () => {
    const out = QecOQ3.emit({ d: 3, errors: {} });
    QECT.assert.ok(out.includes("INJECTED ERRORS (none)"), "explicit (none) marker present");
  });

  QECT.it("syndrome-extraction emits exactly D^2-1 measure statements", () => {
    for (const d of [3, 5, 7]) {
      const out = QecOQ3.emit({ d: d, errors: {} });
      const nMeasure = (out.match(/synd\[\d+\] = measure/g) || []).length;
      QECT.assert.equal(nMeasure, d * d - 1, "D^2-1 measure emits at d=" + d);
    }
  });

  QECT.it("rejects invalid distances", () => {
    let threw = false;
    try { QecOQ3.emit({ d: 4, errors: {} }); }
    catch (e) { threw = true; }
    QECT.assert.ok(threw, "d=4 should throw");
  });

  QECT.it("noise template returns Python with Qiskit import and embedded OQ3", () => {
    const t = QecOQ3.noiseTemplate({ d: 3, model: "depolarizing", decoder: "MWPM", bias: 1 });
    QECT.assert.ok(t.includes("# QEC Explorer"), "Python header comment");
    QECT.assert.ok(t.includes("from qiskit import QuantumCircuit"), "Qiskit import line");
    QECT.assert.ok(t.includes("QEC_OQ3 = r'''"), "raw triple-quoted OQ3 block");
    QECT.assert.ok(t.includes("OPENQASM 3.0;"), "OQ3 string begins correctly");
    QECT.assert.ok(t.includes("build_qec_noisemodel"), "noise-model helper defined");
  });

  QECT.it("biased variant uses distinct p_x / p_z parameters", () => {
    const t = QecOQ3.noiseTemplate({ d: 3, model: "biased", decoder: "MWPM", bias: 30 });
    QECT.assert.ok(t.includes("p_x=") && t.includes("p_z="), "biased output names p_x and p_z");
    QECT.assert.ok(t.includes("bias 30"), "bias ratio written to header comment");
  });

  QECT.it("single-correction block is emitted with the supplied label and gates", () => {
    const out = QecOQ3.emit({
      d: 3,
      errors: {},
      correction: {
        "1,1": { x: true,  z: false },
        "2,0": { x: false, z: true  },
      },
      decoderLabel: "MWPM",
    });
    QECT.assert.ok(out.includes("DECODER CORRECTION (MWPM)"), "labeled divider");
    QECT.assert.ok(out.includes("x data[4];"), "correction x at idx 4 present");
    QECT.assert.ok(out.includes("z data[6];"), "correction z at idx 6 present");
  });

  QECT.it("multi-correction array emits one labeled block per correction", () => {
    const out = QecOQ3.emit({
      d: 3,
      errors: {},
      corrections: [
        { correction: { "1,1": { x: true,  z: false } }, decoderLabel: "lookup" },
        { correction: { "1,1": { x: true,  z: false } }, decoderLabel: "MWPM"   },
        { correction: { "2,0": { x: false, z: true  } }, decoderLabel: "BP"     },
      ],
    });
    QECT.assert.ok(out.includes("DECODER CORRECTION (lookup)"), "lookup label");
    QECT.assert.ok(out.includes("DECODER CORRECTION (MWPM)"),   "MWPM label");
    QECT.assert.ok(out.includes("DECODER CORRECTION (BP)"),     "BP label");
  });
});
