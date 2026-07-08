/* ============================================================
   QEC EXPLORER — assets/qec-openqasm.js
   ------------------------------------------------------------
   Pure emitter: turns a QEC Explorer state (errors injected on
   a rotated surface code) into an OpenQASM 3.0 string that can
   be parsed by `qiskit.QuantumCircuit.from_qasm3_str(...)`.

   Public API (attached to window.QecOQ3):
     .emit({
        d:               number,   // 3, 5, or 7
        source?:         string,   // header label
        errors?:         {"r,c": {x:bool, z:bool}, ...},
        includeSyndrome? boolean,  // default true
        correction?:     {"r,c": {x:bool,z:bool}},        // single
        corrections?:    [{correction, decoderLabel}, ...],  // plural
        decoderLabel?:   string,
     }) => string
     .noiseTemplate({
        d:       number,        // 3, 5, or 7
        model:   'depolarizing' | 'biased',
        bias:    number,        // Z:X ratio for biased model
        decoder: string,        // decoder used in source experiment
     }) => string                 // Python source code

   Loads `buildCode()` from lattice-core.js via the global IIFE.
   ============================================================ */

(function (global) {
  "use strict";

  // ---------- helpers ----------
  function isoTimestamp() {
    return new Date().toISOString().replace(/\.\d+Z$/, "Z");
  }
  function dataIndex(r, c, d) { return r * d + c; }

  // ---------- header ----------
  function makeHeader(opts) {
    const n = opts.errors ? Object.keys(opts.errors).length : 0;
    const src = opts.source || "QEC Explorer";
    const lines = [
      "OPENQASM 3.0;",
      'include "stdgates.inc";',
      "",
      "// ============================================================",
      "// QEC Explorer export",
      "// source:    " + src,
      "// code:      rotated-surface",
      "// distance:  D = " + opts.d,
      "// injected:  " + n + " error" + (n === 1 ? "" : "s"),
      opts.decoderLabel ? "// decoder:   " + opts.decoderLabel : null,
      "// generated: " + isoTimestamp(),
      "// ============================================================",
    ];
    return lines.filter(Boolean).join("\n");
  }

  // ---------- qubit / bit declarations ----------
  function makeRegistrations(d, nStabs) {
    return [
      "",
      "const int D      = " + d + ";",
      "const int N_DATA = " + (d * d) + ";",
      "const int N_ANC  = " + nStabs + ";",
      "",
    "qubit[" + (d * d) + "] data;",
    "qubit[" + nStabs  + "] anc;",
    "bit["   + nStabs  + "] synd;",
      "",
    ].join("\n");
  }

  // ---------- error-section ----------
  function makeErrorsBlock(errors, d) {
    if (!errors || !Object.keys(errors).length) {
      return "// --- INJECTED ERRORS (none) ---";
    }
    const lines = ["// --- INJECTED ERRORS ---"];
    const keys = Object.keys(errors).sort();
    for (const k of keys) {
      const e = errors[k];
      const [r, c] = k.split(",").map(Number);
      const idx = dataIndex(r, c, d);
      const coord = "(" + r + "," + c + ")";
      if (e.x && e.z) {
        lines.push("x data[" + idx + "];   // " + coord + "  -- Y = X then Z");
        lines.push("z data[" + idx + "];   // " + coord + "  -- Y = Z after X");
      } else if (e.x) {
        lines.push("x data[" + idx + "];   // " + coord);
      } else if (e.z) {
        lines.push("z data[" + idx + "];   // " + coord);
      }
    }
    return lines.join("\n");
  }

  // ---------- syndrome-extraction ----------
  function makeSyndromeBlock(stabs, d) {
    const lines = ["", "// --- SYNDROME EXTRACTION ---"];
    lines.push("// Z-type stabilizers detect X errors; X-type stabilizers detect Z errors.");
    lines.push("// X-type measure is performed via Hadamard conjugation on the ancilla");
    lines.push("// (h anc -> cx anc,data -> h anc, then measure).");
    lines.push("");
    for (let i = 0; i < stabs.length; i++) {
      const s = stabs[i];
      // Each stabilizer's `s.cy` hex coord (cx,cy) is at half-integer for the rotated code.
      const w = s.data.length;
      lines.push("// stabilizer " + i + "  type=" + s.type + "  weight=" + w + "  center=(" + s.cx + "," + s.cy + ")");
      if (s.type === "Z") {
        lines.push("reset anc[" + i + "];");
        for (const k of s.data) {
          const [r, c] = k.split(",").map(Number);
          const idx = dataIndex(r, c, d);
          lines.push("cx data[" + idx + "], anc[" + i + "];");
        }
        lines.push("synd[" + i + "] = measure anc[" + i + "];");
      } else {
        lines.push("reset anc[" + i + "];");
        lines.push("h anc[" + i + "];");
        for (const k of s.data) {
          const [r, c] = k.split(",").map(Number);
          const idx = dataIndex(r, c, d);
          lines.push("cx anc[" + i + "], data[" + idx + "];");
        }
        lines.push("h anc[" + i + "];");
        lines.push("synd[" + i + "] = measure anc[" + i + "];");
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  // ---------- single-decoder correction block ----------
  function makeCorrectionBlock(correction, d, label) {
    if (!correction || !Object.keys(correction).length) {
      return "\n// --- DECODER CORRECTION (" + (label || "decoder") + "): none ---";
    }
    const lines = ["", "// --- DECODER CORRECTION (" + (label || "decoder") + ") ---",
                   "// In real-time hardware this would be applied via a dynamic-circuit",
                   "// feed-forward round after syndrome read. Below is the algorithmic",
                   "// recovery the decoder chose for this run, written as if applied later."];
    const keys = Object.keys(correction).sort();
    for (const k of keys) {
      const c = correction[k];
      const [r, cc] = k.split(",").map(Number);
      const idx = dataIndex(r, cc, d);
      const coord = "(" + r + "," + cc + ")";
      if (c.x && c.z) {
        lines.push("x data[" + idx + "];   // " + coord + "  -- Y correction");
        lines.push("z data[" + idx + "];   // " + coord + "  -- Y correction (Z half)");
      } else if (c.x) {
        lines.push("x data[" + idx + "];   // " + coord);
      } else if (c.z) {
        lines.push("z data[" + idx + "];   // " + coord);
      }
    }
    return lines.join("\n");
  }

  // ---------- main emit ----------
  function emit(opts) {
    const d = opts.d;
    if (![3, 5, 7].includes(d)) {
      throw new Error("QecOQ3.emit: d must be 3, 5, or 7 (got " + d + ")");
    }
    if (typeof global.buildCode !== "function") {
      throw new Error("QecOQ3.emit: buildCode() not found — load lattice-core.js first");
    }
    const code = global.buildCode(d);
    const header = makeHeader({
      d: d,
      source: opts.source || "QEC Explorer",
      errors: opts.errors || {},
      decoderLabel: opts.decoderLabel || "",
    });
    const regs = makeRegistrations(d, code.stabs.length);
    const errs = makeErrorsBlock(opts.errors || {}, d);
    const synd = (opts.includeSyndrome !== false)
      ? makeSyndromeBlock(code.stabs, d)
      : "\n// (syndrome extraction omitted)";

    let out = header + "\n" + regs + errs + "\n" + synd;

    // Single correction (back-compat)
    if (opts.correction) {
      out += "\n" + makeCorrectionBlock(opts.correction, d, opts.decoderLabel);
    }
    // Multiple corrections (decoder race page)
    if (Array.isArray(opts.corrections)) {
      for (const c of opts.corrections) {
        out += "\n" + makeCorrectionBlock(c.correction, d, c.decoderLabel);
      }
    }
    if (!opts.correction && !Array.isArray(opts.corrections)) {
      out += "\n// --- DECODER CORRECTION (omitted) ---";
    }
    return out + "\n";
  }

  // ---------- Python noise-model template ----------
  function noiseTemplate(opts) {
    var OQ3 = emit({
      d: opts.d,
      source: "QEC Explorer noise-template",
      errors: {},
      includeSyndrome: true,
      decoderLabel: "n/a (clean syndrome extraction circuit)",
    });
    var isBiased = opts.model === "biased";
    var lines = [
      "# ============================================================",
      "# QEC Explorer — Noise-Model Template",
      "# ============================================================",
      "#  Distance D = " + opts.d,
      "#  Noise model = " + opts.model +
        (isBiased ? "  (Z:X bias " + opts.bias + ":1)" : "  (symmetric depolarizing)"),
      "#  Decoder (in source experiment) = " + opts.decoder,
      "#  Generated " + isoTimestamp(),
      "#",
      "#  The OpenQASM 3 string below imports cleanly into Qiskit via",
      "#     QuantumCircuit.from_qasm3_str(QEC_OQ3)",
      "#  The circuit contains only the syndrome-extraction round — errors",
      "#  are injected programmatically and a noise model is applied at run time.",
      "# ============================================================",
      "",
      "from qiskit import QuantumCircuit",
      "from qiskit_aer import AerSimulator",
      "from qiskit_aer.noise import NoiseModel, depolarizing_error",
      "",
      "QEC_OQ3 = r'''",
      OQ3,
      "'''",
      "",
      "def build_qec_circuit(error_x=None, error_z=None):",
      "    qc = QuantumCircuit.from_qasm3_str(QEC_OQ3)",
      "    if error_x:",
      "        for (r, c) in error_x:",
      "            qc.x(r * " + opts.d + " + c)",
      "    if error_z:",
      "        for (r, c) in error_z:",
      "            qc.z(r * " + opts.d + " + c)",
      "    return qc",
      "",
      "def build_qec_noisemodel(p_x=0.05, p_z=0.05):",
      "    nm = NoiseModel()",
      isBiased
        ? "    nm.add_all_qubit_quantum_error(depolarizing_error(p_x, 1), ['x'])\n"
        + "    nm.add_all_qubit_quantum_error(depolarizing_error(p_z, 1), ['z'])"
        : "    nm.add_all_qubit_quantum_error(depolarizing_error((p_x + 2*p_z) / 3.0, 1),\n"
        + "                                    ['id', 'rz', 'sx'])",
      "    return nm",
      "",
      "# ---- Example use ----",
      isBiased
        ? "# qc = build_qec_circuit(error_x=[(1, 1)], error_z=[(2, 0)])\n"
        + "# nm = build_qec_noisemodel(p_x=0.05, p_z=0.05 * " + opts.bias + ")\n"
        : "# qc = build_qec_circuit(error_x=[(1, 1)], error_z=[(2, 0)])\n"
        + "# nm = build_qec_noisemodel(p_x=0.05, p_z=0.05)\n",
      "# backend = AerSimulator(noise_model=nm)",
      "# counts = backend.run(qc, shots=1024).result().get_counts()",
      "# # syndrome bits appear as the high-(D^2-1) bits of the count keys;",
      "# # parse them per your D to recover the syndrome vector.",
    ];
    return lines.join("\n");
  }

  global.QecOQ3 = {
    emit: emit,
    noiseTemplate: noiseTemplate,
  };
})(typeof window !== "undefined" ? window : this);
