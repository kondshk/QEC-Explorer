/* ============================================================
   QEC EXPLORER — lattice-core.js
   Shared physics for the rotated surface code.
   ------------------------------------------------------------
   This file is the SINGLE SOURCE OF TRUTH for the code's physics.
   It is loaded as a plain <script src="lattice-core.js"> by both
   index.html (Module 1 — detection) and decoder.html (Module 2 —
   decoder race). No bundler, no modules, no build step.

   The four functions below — buildCode, computeSyndrome,
   logicalStatus, hasAnyError — were EXTRACTED VERBATIM from
   index.html. Their logic is unchanged byte-for-byte; only their
   location moved. They read the global `state.errors`, exactly as
   before, so Module 1 behaves identically.

   For Module 2, which must reason about ARBITRARY error sets
   (the original error, a decoder's proposed correction, and the
   two XOR-combined), thin NEW helpers are provided at the bottom
   (computeSyndromeFor / logicalStatusFor / ...). These do NOT
   modify the originals — they temporarily swap state.errors,
   delegate to the untouched original, then restore. This keeps the
   verified physics canonical while letting decoders run on any set.
   ============================================================ */

/* `state` is provided here as a shared global so the extracted
   functions keep working unchanged. Each page may add its own
   fields (paint, d, ...); only `errors` is read by the physics. */
var state = (typeof state !== "undefined" && state) ? state : { errors: {} };
if (!state.errors) state.errors = {};

/* ============================================================
   BELOW: extracted byte-for-byte from index.html (do not edit)
   ============================================================ */

/* ---- Build the code structure for a given distance ---- */
function buildCode(d) {
  // Data qubits on a d×d grid. (r,c) with r,c in [0..d-1].
  const data = [];
  for (let r = 0; r < d; r++)
    for (let c = 0; c < d; c++)
      data.push({ r, c });

  // Stabilizers sit on the "dual" grid, at half-integer positions.
  // A plaquette at center (R+0.5, C+0.5) touches up to 4 data qubits:
  //   (R,C),(R,C+1),(R+1,C),(R+1,C+1).
  // Bulk plaquettes are full weight-4. Boundary stabilizers are the
  // weight-2 "half" plaquettes on the top/bottom (one type) and
  // left/right (other type) edges, giving the rotated code its shape.
  // Coloring follows the checkerboard: (R+C) even = Z-type, odd = X-type.
  const stabs = [];
  for (let R = -1; R < d; R++) {
    for (let C = -1; C < d; C++) {
      const type = ((R + C) % 2 === 0) ? "Z" : "X"; // Z detects X, X detects Z
      // candidate data sites
      const cand = [
        [R, C], [R, C + 1], [R + 1, C], [R + 1, C + 1]
      ].filter(([rr, cc]) => rr >= 0 && rr < d && cc >= 0 && cc < d);
      if (cand.length === 0) continue;

      // Rotated-code boundary rule:
      //  - Z-type (even) plaquettes only exist as weight-2 on the
      //    LEFT/RIGHT boundaries (and weight-4 in bulk).
      //  - X-type (odd) plaquettes only exist as weight-2 on the
      //    TOP/BOTTOM boundaries (and weight-4 in bulk).
      // Weight-1 or 3 candidate sets are not valid stabilizers; skip
      // the boundary plaquettes that don't belong to that type.
      const onTopBottom = (R === -1 || R === d - 1);
      const onLeftRight = (C === -1 || C === d - 1);
      if (cand.length === 2) {
        if (type === "Z" && !onLeftRight) continue;
        if (type === "X" && !onTopBottom) continue;
      }
      if (cand.length !== 2 && cand.length !== 4) continue;

      stabs.push({
        type,
        cx: C + 0.5,
        cy: R + 0.5,
        data: cand.map(([rr, cc]) => `${rr},${cc}`)
      });
    }
  }
  return { d, data, stabs };
}

/* ---- Compute which stabilizers fire from current errors ---- */
function computeSyndrome(code) {
  return code.stabs.map(s => {
    let parity = 0;
    for (const key of s.data) {
      const e = state.errors[key];
      if (!e) continue;
      // Z-type stabilizer anticommutes with X errors -> sensitive to X
      // X-type stabilizer anticommutes with Z errors -> sensitive to Z
      if (s.type === "Z" && e.x) parity ^= 1;
      if (s.type === "X" && e.z) parity ^= 1;
    }
    return parity; // 1 = fired
  });
}

/* ---- Detect logical error: an error chain spanning the code ---- */
/* Verified against the rotated surface code (see commit notes):
     - Logical X = a VERTICAL column of X errors (commutes with every
       stabilizer -> fires zero syndromes).
     - Logical Z = a HORIZONTAL row of Z errors (likewise silent).
   A logical flip has occurred iff the syndrome is fully clear AND the
   net error commutes with all stabilizers while ANTIcommuting with a
   logical observable. We measure that by parity against representative
   observables:
     - logical-Z observable = X-parity along any single column. We use
       column 0; for a syndrome-free X configuration this parity is a
       homology invariant, so column 0 is a valid representative.
     - logical-X observable = Z-parity along row 0. */
function logicalStatus(code) {
  const synd = computeSyndrome(code);
  const anyFired = synd.some(v => v === 1);
  if (anyFired) return { logical: false, hasErr: hasAnyError() };

  // Zero syndrome -> the error is a product of stabilizers and/or a
  // logical operator. Read the two logical observables.
  const d = code.d;
  let xObsCol0 = 0;  // X-parity down column 0  -> flips logical Z
  let zObsRow0 = 0;  // Z-parity across row 0   -> flips logical X
  for (let r = 0; r < d; r++) {
    const e = state.errors[`${r},0`];
    if (e && e.x) xObsCol0 ^= 1;
  }
  for (let c = 0; c < d; c++) {
    const e = state.errors[`0,${c}`];
    if (e && e.z) zObsRow0 ^= 1;
  }
  const logical = (xObsCol0 === 1 || zObsRow0 === 1);
  return { logical, hasErr: hasAnyError() };
}

function hasAnyError() {
  return Object.values(state.errors).some(e => e && (e.x || e.z));
}

/* ============================================================
   NEW helpers (Module 2). These do not alter the functions above.
   They let callers evaluate the SAME physics on an arbitrary error
   set without disturbing the page's global `state.errors`.
   ------------------------------------------------------------
   An "error set" here uses the identical shape the originals expect:
     { "r,c": { x:bool, z:bool }, ... }
   ============================================================ */

/* Run a function with state.errors temporarily set to `errors`,
   then restore. Synchronous only. Returns the function's result. */
function withErrors(errors, fn) {
  const saved = state.errors;
  state.errors = errors || {};
  try {
    return fn();
  } finally {
    state.errors = saved;
  }
}

/* Syndrome for an arbitrary error set (does not touch global state). */
function computeSyndromeFor(code, errors) {
  return withErrors(errors, () => computeSyndrome(code));
}

/* Logical status for an arbitrary error set. */
function logicalStatusFor(code, errors) {
  return withErrors(errors, () => logicalStatus(code));
}

/* Deep-ish clone of an error set (plain data, no nested refs beyond {x,z}). */
function cloneErrors(errors) {
  const out = {};
  for (const k in errors) {
    const e = errors[k];
    if (e && (e.x || e.z)) out[k] = { x: !!e.x, z: !!e.z };
  }
  return out;
}

/* XOR-combine two error sets per Pauli component.
   This is exactly how a correction composes with the real error:
   applying a correction means XOR-ing its X/Z flips onto the error.
   A qubit that ends with neither X nor Z is dropped from the set. */
function combineErrors(a, b) {
  const out = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const ea = (a && a[k]) || { x: false, z: false };
    const eb = (b && b[k]) || { x: false, z: false };
    const x = (!!ea.x) !== (!!eb.x);
    const z = (!!ea.z) !== (!!eb.z);
    if (x || z) out[k] = { x, z };
  }
  return out;
}

/* List the data-qubit keys where two corrections differ (either
   component differs). Returns a sorted array of "r,c" strings. */
function diffErrorKeys(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out = [];
  for (const k of keys) {
    const ea = (a && a[k]) || { x: false, z: false };
    const eb = (b && b[k]) || { x: false, z: false };
    if ((!!ea.x) !== (!!eb.x) || (!!ea.z) !== (!!eb.z)) out.push(k);
  }
  return out.sort((p, q) => {
    const [pr, pc] = p.split(",").map(Number), [qr, qc] = q.split(",").map(Number);
    return pr - qr || pc - qc;
  });
}

/* Total Pauli weight of an error set (count of non-identity qubits;
   a Y counts as weight 1 since it's one physical qubit). */
function errorWeight(errors) {
  let w = 0;
  for (const k in errors) {
    const e = errors[k];
    if (e && (e.x || e.z)) w++;
  }
  return w;
}
