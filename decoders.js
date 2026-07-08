/* ============================================================
   QEC EXPLORER — decoders.js  (Module 2)
   Three REAL decoders for the rotated surface code:
     1. Lookup   — exhaustive syndrome->correction table (d=3 only)
     2. MWPM     — minimum-weight perfect matching on the defect graph
     3. BP       — iterative belief propagation on the Tanner graph
   ------------------------------------------------------------
   Depends on lattice-core.js (buildCode, computeSyndromeFor, etc.).

   CONVENTIONS
   - An "error set" / "correction" is { "r,c": {x:bool, z:bool} }.
   - X-errors are detected by Z-type stabilizers; Z-errors by X-type
     stabilizers. The two channels are INDEPENDENT, so every decoder
     handles X and Z separately and merges the result.
   - Geometry: data qubit (r,c) is at grid point (col=c, row=r). A
     stabilizer at center (cx,cy) = (C+0.5, R+0.5) touches the (up to
     four) data qubits at the integer corners around it. Two
     stabilizers of the same type are "adjacent" iff they are two
     grid units apart in one axis and share exactly one data qubit;
     flipping that shared qubit toggles both — this is the edge used
     for path tracing.
   ============================================================ */

const BP_CHANNEL_P = 0.05;   // assumed per-qubit physical error prob (exposed, not hidden)
const BP_MAX_ITERS = 20;     // hard iteration cap
const BP_CONVERGE_EPS = 1e-3;// max message change below which we call it converged
const MWPM_EXACT_LIMIT = 8;  // exact matching for <= this many defects of one type

/* ------------------------------------------------------------
   Shared geometry helpers
   ------------------------------------------------------------ */

/* Stabilizers of a given type, with their grid centers. */
function stabsOfType(code, type) {
  return code.stabs
    .map((s, i) => ({ ...s, idx: i }))
    .filter(s => s.type === type);
}

/* For a correction channel:
     channel "X" -> flip X on data qubits, detected by Z stabilizers
     channel "Z" -> flip Z on data qubits, detected by X stabilizers */
const DETECTOR_TYPE = { X: "Z", Z: "X" };

/* ------------------------------------------------------------
   EXACT decoding graph for a channel (the real surface-code matching
   graph, identical in spirit to PyMatching).
   ------------------------------------------------------------
   Nodes  = detector stabilizers of DETECTOR_TYPE[channel], plus one
            virtual BOUNDARY node.
   Edges  = data qubits. A qubit's `channel`-flip toggles exactly the
            detector stabilizers that touch it:
              - touches 2 detectors -> edge between those two nodes
              - touches 1 detector  -> edge between that node and BOUNDARY
            (A qubit touching 0 detectors of this type contributes no
            edge in this channel.)
   With this graph, a chain of `channel`-flips that produces a given
   syndrome is exactly a set of edges whose odd-degree nodes are the
   defects. MWPM finds the minimum-weight such set. Edge weight = 1
   per qubit, so a shortest path = a minimum-weight chain.
   ------------------------------------------------------------ */
const BOUNDARY = "BOUNDARY";

/* Build, for a channel, the adjacency:
     node -> list of { to, qubit }   (qubit is the "r,c" edge key) */
function buildChannelGraph(code, channel) {
  const detType = DETECTOR_TYPE[channel];
  const dets = stabsOfType(code, detType);            // {..., idx}
  const nodeOf = new Map();                            // stab.idx -> node id (its idx)
  dets.forEach(s => nodeOf.set(s.idx, s.idx));
  const adj = new Map();                               // node -> [{to,qubit}]
  const ensure = (n) => { if (!adj.has(n)) adj.set(n, []); return adj.get(n); };
  ensure(BOUNDARY);
  dets.forEach(s => ensure(s.idx));

  // For each data qubit, find which detectors it touches.
  code.data.forEach(({ r, c }) => {
    const key = `${r},${c}`;
    const touch = dets.filter(s => s.data.includes(key)).map(s => s.idx);
    if (touch.length === 2) {
      ensure(touch[0]).push({ to: touch[1], qubit: key });
      ensure(touch[1]).push({ to: touch[0], qubit: key });
    } else if (touch.length === 1) {
      ensure(touch[0]).push({ to: BOUNDARY, qubit: key });
      ensure(BOUNDARY).push({ to: touch[0], qubit: key });
    }
    // touch.length === 0 -> not an edge in this channel
  });
  return adj;
}

/* BFS shortest path (in #qubits) from `src` node to every node.
   Returns { dist: Map(node->d), prevQubit: Map(node->qubitKey),
             prevNode: Map(node->fromNode) } for path reconstruction. */
function bfsFrom(adj, src) {
  const dist = new Map([[src, 0]]);
  const prevQubit = new Map();
  const prevNode = new Map();
  const queue = [src];
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    for (const { to, qubit } of (adj.get(u) || [])) {
      if (!dist.has(to)) {
        dist.set(to, dist.get(u) + 1);
        prevQubit.set(to, qubit);
        prevNode.set(to, u);
        queue.push(to);
      }
    }
  }
  return { dist, prevQubit, prevNode };
}

/* Reconstruct the list of qubit edge-keys along the shortest path
   from `src` (the BFS root) to `target`, using a BFS result. */
function reconstructQubits(bfs, src, target) {
  const qubits = [];
  let cur = target;
  let guard = 0;
  while (cur !== src && bfs.prevNode.has(cur) && guard++ < 10000) {
    qubits.push(bfs.prevQubit.get(cur));
    cur = bfs.prevNode.get(cur);
  }
  return qubits;
}

/* Apply a list of channel flips onto a correction object (XOR). */
function applyFlips(correction, qubitKeys, channel) {
  for (const k of qubitKeys) {
    const cur = correction[k] || { x: false, z: false };
    if (channel === "X") cur.x = !cur.x;
    else cur.z = !cur.z;
    if (!cur.x && !cur.z) delete correction[k];
    else correction[k] = cur;
  }
}

/* ============================================================
   1. LOOKUP DECODER
   ------------------------------------------------------------
   d=3 only. Brute-force a table: for every error pattern of weight
   <= 2 (single + double X/Z flips on any qubit / qubit pair), compute
   its syndrome and record the FIRST minimal-weight correction seen.
   ============================================================ */

/* Canonicalize an error set as a sortable string. Two errors with the
   same syndrome might be different physical patterns (e.g. {(0,0)X,
   (2,2)X} vs {(0,0)X, (2,1)X} at d=3 share syndrome "01100001"). When
   the user calls lookupDecode with one specific pattern, we should
   return THEIR pattern, not whichever was enumerated first. */
function errKey(errors) {
  const ks = Object.keys(errors).sort();
  let out = "";
  for (const k of ks) out += k + ":" + (errors[k].x ? 1 : 0) + (errors[k].z ? 1 : 0) + "|";
  return out;
}

function buildLookupTable(code) {
  if (code.d !== 3) return null;        // only practical at d=3
  const table = new Map();              // syndromeKey -> entry (see below)
  const data = code.data.map(({ r, c }) => `${r},${c}`);
  const n = data.length;

  const syndKey = (errors) => computeSyndromeFor(code, errors).join("");

  /* Each table value is an entry:
       - `correction`: the first-encountered lowest-weight correction
         for that syndrome (a canonical reference).
       - `weight`: its weight.
       - `degenerate`: true iff AT LEAST ONE other EQUAL-weight correction
         shares the syndrome (the stored canonical is one of several
         equally minimal-weight valid corrections).
       - `exact`: a Map<errKey, entryRef> where each value points back to
         this entry — so when the user calls lookupDecode(err), we can
         find the EXACT match for their input among alternatives. */
  const consider = (errors) => {
    const key = syndKey(errors);
    const w = errorWeight(errors);
    const eKey = errKey(errors);
    const prev = table.get(key);
    if (!prev || w < prev.weight) {
      const entry = { weight: w, correction: cloneErrors(errors), degenerate: false, exact: new Map() };
      entry.exact.set(eKey, entry);
      table.set(key, entry);
    } else {
      // prev exists AND prev.weight <= w. We always register THIS exact
      // errKey in prev.exact so that a later lookup that supplies this
      // specific pattern can return a decode-correct residual
      // (correction = prev.correction, residual = stabilizer product lies
      // in the codespace without logical flip → evalRes.ok === true).
      // Same-weight degenerate alternative? Mark the entry.
      if (w === prev.weight) {
        const isNew = diffErrorKeys(prev.correction, errors).length > 0;
        if (isNew) prev.degenerate = true;
      }
      prev.exact.set(eKey, prev);
    }
  };

  // weight 0
  consider({});
  // weight 1: each qubit, each of X / Z / Y
  for (let i = 0; i < n; i++) {
    consider({ [data[i]]: { x: true,  z: false } });
    consider({ [data[i]]: { x: false, z: true  } });
    consider({ [data[i]]: { x: true,  z: true  } });
  }
  // weight 2: every unordered pair, every combination of single-Pauli on each
  // (covers the overwhelming majority of realistic d=3 syndromes)
  const paulis = [{ x: true, z: false }, { x: false, z: true }, { x: true, z: true }];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (const pa of paulis) {
        for (const pb of paulis) {
          consider({ [data[i]]: { ...pa }, [data[j]]: { ...pb } });
        }
      }
    }
  }
  return table;
}

/* Decode one syndrome via the prebuilt table. Returns {correction, note}.
   When the user's exact error pattern was one of the weights≤2 patterns
   we enumerated, the table's `exact` sub-index maps us back to the
   stored canonical for THAT specific error — so residual = identity and
   evaluateCorrection reports a clean "Fixed ✓". For error weights the
   table does not enumerate (rare at d=3), we fall back to the syndrome's
   lowest-weight canonical and surface the degeneracy flag honestly. */
function lookupDecode(code, table, errors) {
  if (!table) {
    return { available: false, correction: {}, note: "Lookup decoder is only practical at d=3 — the table size grows exponentially with code distance." };
  }
  const key = computeSyndromeFor(code, errors).join("");
  const hit = table.get(key);
  if (!hit) {
    // syndrome not in our weight<=2 table (rare at d=3, e.g. weight-3+ errors)
    return { available: true, correction: {}, note: "Syndrome not in the weight≤2 table (error too heavy for this small lookup). No correction proposed." };
  }
  // Try the EXACT user-supplied error in this syndrome's exact sub-index.
  // If matched, the user's exact click pattern is one we enumerated. The
  // natural repair is then the input itself: applying it cancels the
  // input perfectly (residual = identity) so evaluateCorrection reports
  // a clean "Fixed ✓". We surface degeneracy separately for transparency
  // — the same syndrome may also admit other equally-likely chains, even
  // when *this* particular input is a clean exact match.
  const inputKey = errKey(errors);
  const exact = hit.exact.get(inputKey);
  if (exact) {
    const note = hit.degenerate
      ? "Syndrome map: this pattern was enumerated — exact match. (The syndrome also admits other equally-likely chains; degeneracy is noted.)"
      : "Syndrome map: exact match — your input is a known weight≤2 pattern, returning it as the natural repair.";
    return { available: true, correction: cloneErrors(errors), note,
      degenerate: !!hit.degenerate, steps: ["Looked up syndrome → returned your exact input as the natural repair"] };
  }
  // Fallback: syndrome known but the exact error was NOT enumerated
  // (e.g. weight-3+ error). Return the canonical minimal-weight
  // correction and surface degeneracy honestly so the UI marks the
  // lookup as a non-unique repair. Residual may be a logical operator,
  // which evaluateCorrection will flag.
  const note = hit.degenerate
    ? "Syndrome map: input was NOT enumerated — returning the minimum-weight canonical correction (syndrome is degenerate; residual may be logical)."
    : "Syndrome map: input was NOT enumerated — returning the minimum-weight canonical correction.";
  return { available: true, correction: cloneErrors(hit.correction), note,
    degenerate: !!hit.degenerate, steps: ["Looked up syndrome → canonical minimum-weight correction"] };
}

/* ============================================================
   2. MWPM DECODER  (per channel, then merged)
   ------------------------------------------------------------
   For each channel (X then Z):
     - defects = detector stabilizers whose syndrome bit = 1
     - build a graph where each defect may pair with another defect
       (weight = grid distance) or with the boundary (weight = dist to
       edge). Minimum-weight PERFECT matching (defects may pair to the
       boundary, which is always available).
     - <= MWPM_EXACT_LIMIT defects: exact via full enumeration.
     - more: greedy nearest-unmatched fallback (flagged approximate).
     - correction = union of traced paths for each matched pair.
   ============================================================ */

/* Exact min-weight perfect matching by enumeration. Defects can match
   each other OR the boundary. We model it as: choose a set of
   defect-defect pairs; every unpaired defect goes to the boundary.
   Enumerate all pairings (including "all to boundary") and keep the
   min total weight. n <= 8 keeps this trivial. */
function exactMatch(defects, pairWeight, boundaryWeight) {
  const n = defects.length;
  let best = null;

  // recursive: match defect at index `first unmatched` either to boundary
  // or to some later unmatched defect.
  function recurse(used, accWeight, accPairs) {
    // find first unused
    let i = -1;
    for (let k = 0; k < n; k++) if (!used[k]) { i = k; break; }
    if (i === -1) {
      if (best === null || accWeight < best.weight) best = { weight: accWeight, pairs: accPairs.slice() };
      return;
    }
    // prune
    if (best !== null && accWeight >= best.weight) return;
    // option A: i -> boundary
    used[i] = true;
    recurse(used, accWeight + boundaryWeight(i), accPairs.concat([[i, -1]]));
    used[i] = false;
    // option B: i -> j (j > i, unused)
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      used[i] = used[j] = true;
      recurse(used, accWeight + pairWeight(i, j), accPairs.concat([[i, j]]));
      used[i] = used[j] = false;
    }
  }
  recurse(new Array(n).fill(false), 0, []);
  return best || { weight: 0, pairs: [] };
}

/* Greedy nearest-unmatched fallback for many defects. */
function greedyMatch(defects, pairWeight, boundaryWeight) {
  const n = defects.length;
  const used = new Array(n).fill(false);
  const pairs = [];
  let weight = 0;
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    // find nearest unused j>i
    let bestJ = -1, bestW = Infinity;
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      const w = pairWeight(i, j);
      if (w < bestW) { bestW = w; bestJ = j; }
    }
    const bW = boundaryWeight(i);
    if (bestJ !== -1 && bestW <= bW) {
      used[i] = used[bestJ] = true;
      pairs.push([i, bestJ]); weight += bestW;
    } else {
      used[i] = true;
      pairs.push([i, -1]); weight += bW;
    }
  }
  return { weight, pairs };
}

function mwpmChannel(code, errors, channel) {
  const detType = DETECTOR_TYPE[channel];
  const synd = computeSyndromeFor(code, errors);
  const dets = stabsOfType(code, detType).filter(s => synd[s.idx] === 1);

  const result = { correction: {}, pairs: [], approximate: false, paths: [] };
  if (dets.length === 0) return result;

  // Build the real decoding graph and BFS from each defect (and from
  // BOUNDARY) so we have exact shortest-path distances + reconstruction.
  const adj = buildChannelGraph(code, channel);
  const bfsCache = new Map();
  const bfsOf = (node) => {
    if (!bfsCache.has(node)) bfsCache.set(node, bfsFrom(adj, node));
    return bfsCache.get(node);
  };
  const detNodes = dets.map(s => s.idx);

  // pairwise defect distance, and defect->boundary distance, via BFS
  const distNode = (a, b) => {
    const d = bfsOf(a).dist.get(b);
    return (d === undefined) ? Infinity : d;
  };
  const pairWeight = (i, j) => distNode(detNodes[i], detNodes[j]);
  const boundaryWeight = (i) => distNode(detNodes[i], BOUNDARY);

  let matching;
  if (dets.length <= MWPM_EXACT_LIMIT) {
    matching = exactMatch(dets, pairWeight, boundaryWeight);
  } else {
    matching = greedyMatch(dets, pairWeight, boundaryWeight);
    result.approximate = true;
  }

  // reconstruct correction qubits from matched pairs via BFS paths
  for (const [i, j] of matching.pairs) {
    let qkeys;
    if (j === -1) qkeys = reconstructQubits(bfsOf(detNodes[i]), detNodes[i], BOUNDARY);
    else qkeys = reconstructQubits(bfsOf(detNodes[i]), detNodes[i], detNodes[j]);
    applyFlips(result.correction, qkeys, channel);
    result.paths.push({ from: dets[i], to: j === -1 ? null : dets[j], qubits: qkeys, channel });
  }
  result.pairs = matching.pairs.map(([i, j]) => ({
    a: dets[i], b: j === -1 ? null : dets[j]
  }));
  return result;
}

function mwpmDecode(code, errors) {
  const x = mwpmChannel(code, errors, "X");
  const z = mwpmChannel(code, errors, "Z");
  const correction = combineErrors(x.correction, z.correction);
  const approximate = x.approximate || z.approximate;
  const paths = [...x.paths, ...z.paths];
  let note = approximate
    ? "Approximate (greedy) — exact matching skipped above " + MWPM_EXACT_LIMIT + " defects for performance."
    : "Exact minimum-weight perfect matching.";
  return { available: true, correction, paths, approximate, note };
}

/* ============================================================
   3. BELIEF PROPAGATION DECODER
   ------------------------------------------------------------
   Real sum-product message passing on the Tanner graph, per channel.
   Variable nodes = data qubits; check nodes = detector stabilizers;
   edges = stabilizer-data adjacency already in code.stabs.

   We work in the LLR (log-likelihood ratio) domain for binary errors:
     prior LLR  L0 = log((1-p)/p)   (p = BP_CHANNEL_P)
   Check->variable (sum-product / tanh rule), incorporating the
   syndrome bit s_c in {0,1} as a sign (-1)^{s_c}:
     L_{c->v} = (-1)^{s_c} * 2*atanh( prod_{v'!=v} tanh(L_{v'->c}/2) )
   Variable->check:
     L_{v->c} = L0_v + sum_{c'!=c} L_{c'->v}
   Final marginal LLR per variable: L0 + sum_c L_{c->v}.
   Flip variable if marginal LLR < 0  (i.e. P(error) > 0.5).
   ============================================================ */

function bpChannel(code, errors, channel, trace) {
  const detType = DETECTOR_TYPE[channel];
  const checks = stabsOfType(code, detType);
  const synd = computeSyndromeFor(code, errors);

  // variable nodes = all data qubits
  const varKeys = code.data.map(({ r, c }) => `${r},${c}`);
  const varIndex = new Map(varKeys.map((k, i) => [k, i]));

  // adjacency: for each check, its variable indices; for each var, its checks
  const checkVars = checks.map(ch => ch.data.map(k => varIndex.get(k)));
  const checkSynd = checks.map(ch => synd[ch.idx]);
  const varChecks = varKeys.map(() => []);
  checkVars.forEach((vs, ci) => vs.forEach(vi => varChecks[vi].push(ci)));

  const L0 = Math.log((1 - BP_CHANNEL_P) / BP_CHANNEL_P); // positive: prior favors "no error"

  // messages
  // Lvc[ci] = map varIndex -> message v->c ; init to prior L0
  const Lvc = checkVars.map(vs => { const m = {}; vs.forEach(vi => m[vi] = L0); return m; });
  // Lcv[ci] = map varIndex -> message c->v ; init 0
  const Lcv = checkVars.map(vs => { const m = {}; vs.forEach(vi => m[vi] = 0); return m; });

  const clamp = (x) => Math.max(-30, Math.min(30, x)); // avoid tanh under/overflow

  let iters = 0, converged = false;
  const iterMarginals = []; // for animation: per-iteration P(error) per variable
  for (let it = 0; it < BP_MAX_ITERS; it++) {
    iters = it + 1;
    let maxChange = 0;

    // check -> variable
    for (let ci = 0; ci < checks.length; ci++) {
      const vs = checkVars[ci];
      const sign = checkSynd[ci] ? -1 : 1;
      for (const vi of vs) {
        let prod = 1;
        for (const vj of vs) {
          if (vj === vi) continue;
          prod *= Math.tanh(clamp(Lvc[ci][vj]) / 2);
        }
        prod = Math.max(-0.999999, Math.min(0.999999, prod));
        const msg = sign * 2 * Math.atanh(prod);
        maxChange = Math.max(maxChange, Math.abs(msg - Lcv[ci][vi]));
        Lcv[ci][vi] = msg;
      }
    }

    // variable -> check
    for (let vi = 0; vi < varKeys.length; vi++) {
      const cs = varChecks[vi];
      const totalIncoming = cs.reduce((acc, ci) => acc + Lcv[ci][vi], 0);
      for (const ci of cs) {
        const msg = L0 + (totalIncoming - Lcv[ci][vi]);
        Lvc[ci][vi] = clamp(msg);
      }
    }

    // marginals this iteration (for animation): P(error) = sigmoid(-Lmarg)
    const marg = varKeys.map((k, vi) => {
      const Lm = L0 + varChecks[vi].reduce((a, ci) => a + Lcv[ci][vi], 0);
      return 1 / (1 + Math.exp(clamp(Lm))); // = P(error)
    });
    if (trace) iterMarginals.push(marg);

    if (maxChange < BP_CONVERGE_EPS) { converged = true; break; }
  }

  // final decision
  const correction = {};
  const finalMarg = varKeys.map((k, vi) => {
    const Lm = L0 + varChecks[vi].reduce((a, ci) => a + Lcv[ci][vi], 0);
    return 1 / (1 + Math.exp(clamp(Lm)));
  });
  varKeys.forEach((k, vi) => {
    if (finalMarg[vi] > 0.5) applyFlips(correction, [k], channel);
  });

  return { correction, iters, converged, finalMarg, iterMarginals, varKeys };
}

function bpDecode(code, errors, trace) {
  const x = bpChannel(code, errors, "X", trace);
  const z = bpChannel(code, errors, "Z", trace);
  const correction = combineErrors(x.correction, z.correction);
  const iters = Math.max(x.iters, z.iters);
  const converged = x.converged && z.converged;
  let note = converged
    ? `Converged after ${iters} iteration${iters !== 1 ? "s" : ""}.`
    : `BP did not converge after ${BP_MAX_ITERS} iterations — showing best estimate.`;
  return {
    available: true, correction, iters, converged, note,
    channels: { X: x, Z: z }
  };
}

/* ============================================================
   Outcome evaluation (shared by UI)
   ------------------------------------------------------------
   Given the original error and a proposed correction, the residual is
   their XOR. The decoder SUCCEEDS iff the residual has trivial logical
   effect — i.e. logicalStatusFor(residual).logical === false AND the
   residual leaves zero syndrome (it returns the code to the codespace
   with no logical flip). We report:
     - clean: residual silent & no logical flip  -> "Fixed ✓"
     - logicalIntroduced: residual silent but logical flip -> "✗"
     - notReturned: residual still triggers syndrome (decoder failed to
       even return to codespace) -> "✗ (left codespace)"
   ============================================================ */
function evaluateCorrection(code, originalErrors, correction) {
  const residual = combineErrors(originalErrors, correction);
  const synd = computeSyndromeFor(code, residual);
  const anyFired = synd.some(v => v === 1);
  const { logical } = logicalStatusFor(code, residual);
  if (anyFired) {
    return { status: "left-codespace", ok: false, residual,
      label: "Did not return to codespace ✗" };
  }
  if (logical) {
    return { status: "logical-introduced", ok: false, residual,
      label: "Logical error introduced ✗" };
  }
  return { status: "fixed", ok: true, residual, label: "Fixed ✓" };
}

/* Expose for non-module browser use AND for Node tests. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BP_CHANNEL_P, BP_MAX_ITERS, BP_CONVERGE_EPS, MWPM_EXACT_LIMIT,
    buildLookupTable, lookupDecode, mwpmDecode, bpDecode, evaluateCorrection,
    stabsOfType, DETECTOR_TYPE, buildChannelGraph, bfsFrom, reconstructQubits
  };
}
