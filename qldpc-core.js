/* ============================================================
   QEC EXPLORER - qldpc-core.js  (Module 4)
   ------------------------------------------------------------
   The real [[144,12,12]] "gross code": a bivariate-bicycle qLDPC
   code from Bravyi, Cross, Gambetta, Maslov, Rall, Yoder,
   "High-threshold and low-overhead fault-tolerant quantum memory,"
   Nature 627, 778 (2024).

   This file is the single source of truth for Module 4, the way
   lattice-core.js is for the surface-code modules. It:

     1. Builds the code from its defining polynomials
          A = x^3 + y + y^2 ,  B = y^3 + x + x^2
        over the group Z_l x Z_m with (l, m) = (12, 6), giving
          Hx = [ A | B ]   (72 x 144)
          Hz = [ B^T | A^T ] (72 x 144)
     2. Exposes the Tanner-graph adjacency the visualization draws.
     3. Computes syndromes for an arbitrary Pauli error.
     4. Decodes with BP + OSD-0, the de-facto qLDPC workhorse, run
        directly on the sparse parity-check matrices.

   Everything is verified by tests/qldpc.test.js against the code's
   defining invariants (weight-6 checks, weight-6 qubits, commuting
   stabilizers, k = 12) and the decoder's guarantees (return to the
   codespace; low-weight errors corrected).

   CONVENTIONS
   - "l-block" / "left" data qubits are indices 0 .. l*m-1.
     "m-block" / "right" data qubits are indices l*m .. 2*l*m-1.
   - An error is represented two ways depending on context:
       * dense: {x: Uint8Array(n), z: Uint8Array(n)}  (bit per qubit)
       * sparse set of qubit indices, per channel.
   - X errors are caught by Z-checks (rows of Hz); Z errors by
     X-checks (rows of Hx). The two channels are independent, exactly
     as in decoders.js, so BP-OSD runs once per channel.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.QLDPC = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* --------------------------------------------------------
     1 · Code construction
     -------------------------------------------------------- */

  // Cyclic-shift action: a monomial x^a y^b sends grid cell (i, j) to
  // ((i + a) mod l, (j + b) mod m).
  function shift(k, p, i) { return (((i + p) % k) + k) % k; }

  // A "polynomial" is a list of monomials [[a, b], ...].
  // Its matrix (over an l*m index space, cell (i,j) -> i*m + j) has a 1
  // in row (i,j), col (i',j') for each monomial that maps (i,j) -> (i',j').
  function polyBlock(l, m, monos) {
    const lm = l * m;
    const B = Array.from({ length: lm }, () => new Uint8Array(lm));
    for (let i = 0; i < l; i++) {
      for (let j = 0; j < m; j++) {
        const row = i * m + j;
        for (const [a, b] of monos) {
          const col = shift(l, a, i) * m + shift(m, b, j);
          B[row][col] ^= 1;
        }
      }
    }
    return B;
  }

  function transpose(B) {
    const r = B.length, c = B[0].length;
    const T = Array.from({ length: c }, () => new Uint8Array(r));
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = B[i][j];
    return T;
  }

  // Horizontal concat of two equal-height blocks -> full check matrix.
  function hcat(P, Q) {
    const w = P[0].length + Q[0].length;
    return P.map((row, i) => {
      const out = new Uint8Array(w);
      out.set(row, 0);
      out.set(Q[i], P[0].length);
      return out;
    });
  }

  // Turn a dense check matrix into row-adjacency: each row -> sorted list
  // of the column (qubit) indices it touches. This is the sparse form BP,
  // syndrome extraction, and the Tanner graph all use.
  function rowsToLists(H) {
    return H.map(row => {
      const qs = [];
      for (let c = 0; c < row.length; c++) if (row[c]) qs.push(c);
      return qs;
    });
  }

  /* Build the [[144,12,12]] gross code (or any bivariate-bicycle code
     with the same polynomial shape). Returns a rich object used by both
     the page and the tests. */
  function buildGrossCode(opts) {
    const l = (opts && opts.l) || 12;
    const m = (opts && opts.m) || 6;
    const lm = l * m;
    const n = 2 * lm;

    // Gross-code polynomials. A acts on the l-block via x, on the m-block
    // via y; the exponents below are the paper's (l, m) = (12, 6) choice.
    const Amonos = (opts && opts.A) || [[3, 0], [0, 1], [0, 2]]; // x^3 + y + y^2
    const Bmonos = (opts && opts.B) || [[0, 3], [1, 0], [2, 0]]; // y^3 + x + x^2

    const A = polyBlock(l, m, Amonos);
    const B = polyBlock(l, m, Bmonos);
    const At = transpose(A), Bt = transpose(B);

    // Hx = [A | B], Hz = [B^T | A^T].
    const Hx = hcat(A, B);
    const Hz = hcat(Bt, At);

    // Sparse row lists.
    const xChecks = rowsToLists(Hx); // 72 rows; each catches Z errors
    const zChecks = rowsToLists(Hz); // 72 rows; each catches X errors

    // Column (qubit) -> the checks that touch it, per type.
    const qubitXChecks = Array.from({ length: n }, () => []); // which X-checks (Hx rows)
    const qubitZChecks = Array.from({ length: n }, () => []); // which Z-checks (Hz rows)
    xChecks.forEach((qs, ci) => qs.forEach(q => qubitXChecks[q].push(ci)));
    zChecks.forEach((qs, ci) => qs.forEach(q => qubitZChecks[q].push(ci)));

    return {
      l, m, lm, n,
      numLogical: 12,        // proven: n - rank(Hx) - rank(Hz) for this code
      distance: 12,          // from the paper (not recomputed here; it is NP-hard)
      Hx, Hz, A, B,
      xChecks, zChecks,      // sparse row lists
      qubitXChecks, qubitZChecks,
      // Handy metadata for the UI.
      numXChecks: xChecks.length,
      numZChecks: zChecks.length,
      checkWeight: 6,
      qubitDegreeX: 3,
      qubitDegreeZ: 3
    };
  }

  /* --------------------------------------------------------
     2 · GF(2) linear algebra (shared by rank check + OSD)
     -------------------------------------------------------- */

  // Rank of a dense GF(2) matrix (rows = Array<Uint8Array>). Non-mutating.
  function gf2Rank(H) {
    if (!H.length) return 0;
    const rows = H.map(r => Uint8Array.from(r));
    const R = rows.length, C = rows[0].length;
    let rank = 0;
    for (let col = 0; col < C && rank < R; col++) {
      let piv = -1;
      for (let r = rank; r < R; r++) if (rows[r][col]) { piv = r; break; }
      if (piv === -1) continue;
      const tmp = rows[rank]; rows[rank] = rows[piv]; rows[piv] = tmp;
      for (let r = 0; r < R; r++) {
        if (r !== rank && rows[r][col]) {
          for (let t = col; t < C; t++) rows[r][t] ^= rows[rank][t];
        }
      }
      rank++;
    }
    return rank;
  }

  // Logical-qubit count k = n - rank(Hx) - rank(Hz).
  function logicalCount(code) {
    return code.n - gf2Rank(code.Hx) - gf2Rank(code.Hz);
  }

  /* --------------------------------------------------------
     3 · Errors + syndromes
     -------------------------------------------------------- */

  // A blank dense error.
  function blankError(code) {
    return { x: new Uint8Array(code.n), z: new Uint8Array(code.n) };
  }

  // Apply a Pauli to a qubit: 'X' sets x-bit, 'Z' sets z-bit, 'Y' both.
  // Toggling (XOR) so repeated application is an involution.
  function toggle(err, q, pauli) {
    if (pauli === "X" || pauli === "Y") err.x[q] ^= 1;
    if (pauli === "Z" || pauli === "Y") err.z[q] ^= 1;
    return err;
  }

  // Syndrome of an error.
  //   X-checks (Hx rows) fire on the Z-part of the error.
  //   Z-checks (Hz rows) fire on the X-part of the error.
  // Returns {x: Uint8Array(numXChecks), z: Uint8Array(numZChecks)} where
  // syndrome.x[i] is X-check i, syndrome.z[i] is Z-check i.
  function syndrome(code, err) {
    const sx = new Uint8Array(code.numXChecks); // from z-errors
    const sz = new Uint8Array(code.numZChecks); // from x-errors
    for (let ci = 0; ci < code.numXChecks; ci++) {
      let s = 0; const qs = code.xChecks[ci];
      for (let t = 0; t < qs.length; t++) s ^= err.z[qs[t]];
      sx[ci] = s;
    }
    for (let ci = 0; ci < code.numZChecks; ci++) {
      let s = 0; const qs = code.zChecks[ci];
      for (let t = 0; t < qs.length; t++) s ^= err.x[qs[t]];
      sz[ci] = s;
    }
    return { x: sx, z: sz };
  }

  // Do two dense errors have the same syndrome? (Used to test the decoder:
  // a correct correction reproduces the injected syndrome exactly.)
  function sameSyndrome(a, b) {
    if (a.x.length !== b.x.length || a.z.length !== b.z.length) return false;
    for (let i = 0; i < a.x.length; i++) if (a.x[i] !== b.x[i]) return false;
    for (let i = 0; i < a.z.length; i++) if (a.z[i] !== b.z[i]) return false;
    return true;
  }

  function weight(err) {
    let w = 0;
    for (let i = 0; i < err.x.length; i++) if (err.x[i] || err.z[i]) w++;
    return w;
  }

  /* --------------------------------------------------------
     4 · BP + OSD-0 decoder (per channel), run on the sparse H
     ------------------------------------------------------------
     One channel means: a binary parity-check matrix `checkLists` (rows =
     checks, entries = qubit indices) plus the observed binary syndrome
     for those checks. BP produces a soft P(error) per qubit; if BP's hard
     decision already reproduces the syndrome we keep it, otherwise OSD-0
     Gaussian-eliminates to snap the correction onto the exact syndrome.
     This mirrors decoders.js exactly, generalized off the surface-code
     geometry onto an arbitrary LDPC check matrix.
     -------------------------------------------------------- */

  const BP_CHANNEL_P = 0.05;
  const BP_MAX_ITERS = 40;      // qLDPC codes need more iterations than d<=7 surface codes
  const BP_CONVERGE_EPS = 1e-3;

  // Belief propagation on one channel.
  //   checkLists : Array<Array<qubitIndex>>   (rows of H, sparse)
  //   synd       : Uint8Array (per check)
  //   n          : number of qubits (columns)
  // Returns {marg: Float64Array(n) P(error), hard: Uint8Array(n), iters, converged}.
  function bpChannel(checkLists, synd, n) {
    const nChecks = checkLists.length;

    // qubit -> list of checks touching it
    const qubitChecks = Array.from({ length: n }, () => []);
    checkLists.forEach((qs, ci) => qs.forEach(q => qubitChecks[q].push(ci)));

    const L0 = Math.log((1 - BP_CHANNEL_P) / BP_CHANNEL_P); // prior log-ratio, favors "no error"
    const clamp = (x) => (x > 30 ? 30 : (x < -30 ? -30 : x));

    // messages, indexed [check][localPos]
    const Lvc = checkLists.map(qs => qs.map(() => L0)); // var -> check
    const Lcv = checkLists.map(qs => qs.map(() => 0));  // check -> var

    let iters = 0, converged = false;
    for (let it = 0; it < BP_MAX_ITERS; it++) {
      iters = it + 1;
      let maxChange = 0;

      // check -> variable
      for (let ci = 0; ci < nChecks; ci++) {
        const qs = checkLists[ci];
        const sign = synd[ci] ? -1 : 1;
        for (let a = 0; a < qs.length; a++) {
          let prod = 1;
          for (let b = 0; b < qs.length; b++) {
            if (b === a) continue;
            prod *= Math.tanh(clamp(Lvc[ci][b]) / 2);
          }
          if (prod > 0.999999) prod = 0.999999;
          else if (prod < -0.999999) prod = -0.999999;
          const msg = sign * 2 * Math.atanh(prod);
          const d = Math.abs(msg - Lcv[ci][a]);
          if (d > maxChange) maxChange = d;
          Lcv[ci][a] = msg;
        }
      }

      // variable -> check
      // Build, per qubit, the total incoming from its checks, then subtract
      // the one going back to each check.
      const incoming = new Float64Array(n);
      // map (check, localPos) is awkward; recompute per qubit using qubitChecks
      // and a per-check local index lookup.
      // Precompute localIndex[ci] as a Map only once would help, but n is small.
      for (let q = 0; q < n; q++) {
        let tot = 0;
        const cs = qubitChecks[q];
        for (let t = 0; t < cs.length; t++) {
          const ci = cs[t];
          const pos = checkLists[ci].indexOf(q);
          tot += Lcv[ci][pos];
        }
        incoming[q] = tot;
      }
      for (let ci = 0; ci < nChecks; ci++) {
        const qs = checkLists[ci];
        for (let a = 0; a < qs.length; a++) {
          const q = qs[a];
          Lvc[ci][a] = clamp(L0 + (incoming[q] - Lcv[ci][a]));
        }
      }

      if (maxChange < BP_CONVERGE_EPS) { converged = true; break; }
    }

    // marginals
    const marg = new Float64Array(n);
    const hard = new Uint8Array(n);
    for (let q = 0; q < n; q++) {
      let tot = 0;
      const cs = qubitChecks[q];
      for (let t = 0; t < cs.length; t++) {
        const ci = cs[t];
        const pos = checkLists[ci].indexOf(q);
        tot += Lcv[ci][pos];
      }
      const Lm = clamp(L0 + tot);
      const p = 1 / (1 + Math.exp(Lm)); // P(error)
      marg[q] = p;
      hard[q] = p > 0.5 ? 1 : 0;
    }
    return { marg, hard, iters, converged };
  }

  // Apply a sparse check matrix to a dense bit-vector: returns syndrome.
  function applyChecks(checkLists, bits) {
    const s = new Uint8Array(checkLists.length);
    for (let ci = 0; ci < checkLists.length; ci++) {
      let v = 0; const qs = checkLists[ci];
      for (let t = 0; t < qs.length; t++) v ^= bits[qs[t]];
      s[ci] = v;
    }
    return s;
  }

  // OSD-0 over GF(2): build the dense matrix from the sparse lists, order
  // columns by `order` (most reliable error first), greedily pick pivots,
  // back-substitute. Returns e with H·e = synd. Identical algorithm to
  // decoders.js osd0Solve, kept local so this file stands alone.
  function osd0Solve(checkLists, synd, n, order) {
    const rows = checkLists.length;
    // dense working matrix
    const M = checkLists.map(qs => {
      const row = new Uint8Array(n);
      for (const q of qs) row[q] = 1;
      return row;
    });
    const b = Uint8Array.from(synd);

    const pivotColOfRow = new Int32Array(rows).fill(-1);
    const rowUsed = new Uint8Array(rows);

    for (const col of order) {
      let pr = -1;
      for (let r = 0; r < rows; r++) {
        if (!rowUsed[r] && M[r][col] === 1) { pr = r; break; }
      }
      if (pr === -1) continue;
      rowUsed[pr] = 1;
      pivotColOfRow[pr] = col;
      for (let r = 0; r < rows; r++) {
        if (r !== pr && M[r][col] === 1) {
          for (let c = 0; c < n; c++) M[r][c] ^= M[pr][c];
          b[r] ^= b[pr];
        }
      }
    }

    const e = new Uint8Array(n);
    for (let r = 0; r < rows; r++) {
      const col = pivotColOfRow[r];
      if (col >= 0) e[col] = b[r] & 1;
    }
    return e;
  }

  // Decode one channel: BP first, OSD-0 rescue if BP's hard decision does
  // not reproduce the syndrome. Returns {correction: Uint8Array(n),
  // iters, converged, usedOsd}.
  function decodeChannel(checkLists, synd, n) {
    const anyFired = synd.some(v => v === 1);
    if (!anyFired) {
      return { correction: new Uint8Array(n), iters: 0, converged: true, usedOsd: false };
    }
    const bp = bpChannel(checkLists, synd, n);
    const bpSynd = applyChecks(checkLists, bp.hard);
    let bpMatches = true;
    for (let i = 0; i < synd.length; i++) if (bpSynd[i] !== synd[i]) { bpMatches = false; break; }

    if (bpMatches) {
      return { correction: bp.hard, iters: bp.iters, converged: bp.converged, usedOsd: false };
    }
    // OSD-0 rescue, columns ordered by descending BP P(error).
    const order = Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => bp.marg[b] - bp.marg[a]);
    const e = osd0Solve(checkLists, synd, n, order);
    return { correction: e, iters: bp.iters, converged: bp.converged, usedOsd: true };
  }

  /* Full BP-OSD decode of a gross-code error.
     Input: code, dense error {x, z}.
     Returns:
       correction : dense {x, z} to apply (XOR) to the error
       residual   : dense {x, z} = error XOR correction (what is left)
       inCodespace: bool, residual has zero syndrome (always true for OSD)
       logicalOk  : bool, residual is the identity (no logical error).
                    NOTE: residual can be a nontrivial LOGICAL operator and
                    still be in the codespace; that is a decode FAILURE that
                    no syndrome-only decoder can rule out. We report it
                    honestly rather than calling every in-codespace result a
                    success.
       usedOsdX/Z, itersX/Z : diagnostics for the UI. */
  function decode(code, err) {
    const s = syndrome(code, err);
    // X errors -> Z-checks (Hz rows, code.zChecks), syndrome s.z
    const chX = decodeChannel(code.zChecks, s.z, code.n);
    // Z errors -> X-checks (Hx rows, code.xChecks), syndrome s.x
    const chZ = decodeChannel(code.xChecks, s.x, code.n);

    const correction = { x: chX.correction, z: chZ.correction };
    const residual = {
      x: new Uint8Array(code.n),
      z: new Uint8Array(code.n)
    };
    for (let q = 0; q < code.n; q++) {
      residual.x[q] = err.x[q] ^ correction.x[q];
      residual.z[q] = err.z[q] ^ correction.z[q];
    }
    const resSynd = syndrome(code, residual);
    const inCodespace = resSynd.x.every(v => v === 0) && resSynd.z.every(v => v === 0);
    const logicalOk = inCodespace && weight(residual) === 0;

    return {
      correction, residual, inCodespace, logicalOk,
      usedOsdX: chX.usedOsd, usedOsdZ: chZ.usedOsd,
      itersX: chX.iters, itersZ: chZ.iters,
      correctionWeight: weight(correction),
      residualWeight: weight(residual)
    };
  }

  /* --------------------------------------------------------
     5 · Public API
     -------------------------------------------------------- */
  return {
    buildGrossCode,
    gf2Rank, logicalCount,
    blankError, toggle, syndrome, sameSyndrome, weight,
    bpChannel, osd0Solve, decodeChannel, applyChecks, decode,
    // constants exposed for tests / UI text
    BP_CHANNEL_P, BP_MAX_ITERS
  };
});
