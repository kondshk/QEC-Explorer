/* ============================================================
   QEC EXPLORER - assets/bloch.js
   ------------------------------------------------------------
   A self-contained, dependency-free 3D Bloch sphere.

   Why this file exists
   --------------------
   The rest of QEC Explorer ships with zero build step and zero
   third-party JavaScript (only Google Fonts load over the wire).
   A real 3D Bloch sphere would normally pull in Three.js or a
   WebGL wrapper; both are off the table here. So this module draws
   a genuine 3D sphere by hand: it holds a real qubit state, applies
   real 2x2 unitary gates, computes the Bloch vector from the
   density matrix, and renders the sphere with a small isometric
   projection into inline SVG. No canvas, no WebGL, no CDN.

   The math is the standard one; the rendering approach (rotate a
   set of 3D points by a camera matrix, sort back-to-front, project)
   is the same idea the Python package cduck/bloch_sphere (MIT) uses
   with Cairo, reimplemented here for the browser.

   Public API
   ----------
     const b = Bloch.create(svgEl, { radius, interactive });
     b.setState(alpha, beta)   // alpha,beta are {re,im}; auto-normalized
     b.reset()                 // back to |0>
     b.applyGate(nameOrMatrix) // "X","Y","Z","H","S","T","Sdg","Tdg",
                               //   "Rx(90)", "Ry(45)", ... or a 2x2 matrix
     b.getVector()             // -> {x,y,z}
     b.getState()              // -> {alpha:{re,im}, beta:{re,im}}
     b.onChange(fn)            // fn({vector, state, label}) after each update
     b.measureZ()              // collapse along Z, returns 0 or 1
     b.label()                 // human string for the current state
     b.destroy()               // remove listeners

   Everything is plain data + SVG attribute mutation, so it honors
   prefers-reduced-motion and never allocates per-frame in a loop.
   ============================================================ */
(function (global) {
  "use strict";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const reduceMotion =
    global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* -------------------- complex helpers -------------------- */
  const c = (re, im) => ({ re: re || 0, im: im || 0 });
  const cadd = (a, b) => c(a.re + b.re, a.im + b.im);
  const cmul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  const cconj = (a) => c(a.re, -a.im);
  const cabs2 = (a) => a.re * a.re + a.im * a.im;

  /* Multiply a 2x2 complex matrix M by a 2-vector [a,b]. */
  function applyMatrix(M, a, b) {
    return [
      cadd(cmul(M[0][0], a), cmul(M[0][1], b)),
      cadd(cmul(M[1][0], a), cmul(M[1][1], b)),
    ];
  }

  /* -------------------- gate library ----------------------- */
  const INV_SQRT2 = 1 / Math.sqrt(2);
  const GATES = {
    I: [[c(1), c(0)], [c(0), c(1)]],
    X: [[c(0), c(1)], [c(1), c(0)]],
    Y: [[c(0), c(0, -1)], [c(0, 1), c(0)]],
    Z: [[c(1), c(0)], [c(0), c(-1)]],
    H: [[c(INV_SQRT2), c(INV_SQRT2)], [c(INV_SQRT2), c(-INV_SQRT2)]],
    S: [[c(1), c(0)], [c(0), c(0, 1)]],            // phase pi/2
    Sdg: [[c(1), c(0)], [c(0), c(0, -1)]],
    T: [[c(1), c(0)], [c(0), c(INV_SQRT2, INV_SQRT2)]], // phase pi/4
    Tdg: [[c(1), c(0)], [c(0), c(INV_SQRT2, -INV_SQRT2)]],
  };

  /* Rotation gates about x/y/z by theta (radians). */
  function Rx(t) {
    const c2 = Math.cos(t / 2), s2 = Math.sin(t / 2);
    return [[c(c2), c(0, -s2)], [c(0, -s2), c(c2)]];
  }
  function Ry(t) {
    const c2 = Math.cos(t / 2), s2 = Math.sin(t / 2);
    return [[c(c2), c(-s2)], [c(s2), c(c2)]];
  }
  function Rz(t) {
    const c2 = Math.cos(t / 2), s2 = Math.sin(t / 2);
    return [[c(c2, -s2), c(0)], [c(0), c(c2, s2)]];
  }

  /* Parse "Rx(90)" / "Ry(-45)" / "X" etc. into a 2x2 matrix. */
  function resolveGate(g) {
    if (Array.isArray(g)) return g;
    if (GATES[g]) return GATES[g];
    const m = /^R([xyz])\(\s*(-?\d+(?:\.\d+)?)\s*\)$/i.exec(g);
    if (m) {
      const axis = m[1].toLowerCase();
      const deg = parseFloat(m[2]);
      const rad = (deg * Math.PI) / 180;
      return axis === "x" ? Rx(rad) : axis === "y" ? Ry(rad) : Rz(rad);
    }
    throw new Error("Unknown gate: " + g);
  }

  /* -------------------- state -> Bloch vector -------------- */
  /* For |psi> = alpha|0> + beta|1>, the Bloch coordinates are
       x = 2 Re(alpha* beta)     (conj on alpha)
       y = 2 Im(alpha* beta)
       z = |alpha|^2 - |beta|^2
     Our axes: +z = |0>, -z = |1>, +x = |+>, +y = |+i>. */
  function stateToVector(alpha, beta) {
    const ab = cmul(cconj(alpha), beta);
    return { x: 2 * ab.re, y: 2 * ab.im, z: cabs2(alpha) - cabs2(beta) };
  }

  function normalize(alpha, beta) {
    const n = Math.sqrt(cabs2(alpha) + cabs2(beta)) || 1;
    return [c(alpha.re / n, alpha.im / n), c(beta.re / n, beta.im / n)];
  }

  /* -------------------- 3D projection ---------------------- */
  /* Camera: two angles (yaw about vertical y, pitch about x).
     We rotate world points into camera space and orthographically
     project. Screen y is flipped so +z (|0>) renders upward. */
  function rot(vec, yaw, pitch) {
    // Convention: world +z is the qubit's |0> pole and must render
    // near screen-up. `yaw` spins the sphere about that vertical +z
    // axis; `pitch` is how far we tilt to look down from above.
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    // Spin about z (yaw): mixes world x and y in the horizontal plane
    const hx = vec.x * cy - vec.y * sy;   // screen-horizontal component
    const hy = vec.x * sy + vec.y * cy;   // in-plane depth component
    // Tilt about the horizontal screen axis (pitch):
    //   screen-up  = z*cos - hy*sin   -> +z stays up for pitch in [0,pi/2)
    //   depth(out) = z*sin + hy*cos
    const up = vec.z * cp - hy * sp;
    const depth = vec.z * sp + hy * cp;
    return { x: hx, y: up, z: depth };
  }

  /* -------------------- the sphere object ------------------ */
  function create(svg, opts) {
    opts = opts || {};
    const R = opts.radius || 96;         // sphere radius in SVG units
    const CX = opts.cx || 130;           // fixed centre - never moves
    const CY = opts.cy || 130;
    const interactive = opts.interactive !== false;

    // viewBox is caller-controlled; we assume it contains (CX,CY,R).
    // Default 3/4 view: yaw spins the sphere a little; pitch tilts the
    // camera down so we look at the top hemisphere with |0> at the top.
    let yaw = opts.yaw != null ? opts.yaw : -0.5;
    let pitch = opts.pitch != null ? opts.pitch : 0.42;

    // current qubit state, starts at |0>
    let alpha = c(1, 0), beta = c(0, 0);
    let changeCb = null;

    // --- build static + dynamic SVG nodes once ---
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    function el(name, attrs) {
      const e = document.createElementNS(SVG_NS, name);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }

    // Group for the back half of the wireframe (drawn dimmer)
    const gBack = el("g", {});
    const gEquatorFill = el("g", {});
    const gFront = el("g", {});
    const gAxes = el("g", {});
    const gVec = el("g", {});
    svg.appendChild(gEquatorFill);
    svg.appendChild(gBack);
    svg.appendChild(gAxes);
    svg.appendChild(gFront);
    svg.appendChild(gVec);

    // outline circle (silhouette) - always the sphere's rim, fixed
    const rim = el("circle", {
      cx: CX, cy: CY, r: R, fill: "var(--surface-2)",
      "fill-opacity": "0.35",
      stroke: "var(--border-default)", "stroke-width": "1.5",
    });
    gEquatorFill.appendChild(rim);

    // Project a world point to screen coords.
    function project(v) {
      const rv = rot(v, yaw, pitch);
      return { x: CX + rv.x * R, y: CY - rv.y * R, depth: rv.z };
    }

    // Build a latitude/longitude wireframe as many small segments,
    // splitting each into front/back by depth so we can dim the back.
    const MERIDIANS = 6;   // vertical lines
    const PARALLELS = 5;   // horizontal rings (excluding poles)
    const SEG = 48;        // segments per ring

    const wire = []; // {a:world, b:world, node, isEquator}
    // meridians
    for (let m = 0; m < MERIDIANS; m++) {
      const lon = (Math.PI * m) / MERIDIANS;
      for (let s = 0; s < SEG; s++) {
        const t0 = (Math.PI * 2 * s) / SEG;
        const t1 = (Math.PI * 2 * (s + 1)) / SEG;
        wire.push(seg(meridianPt(lon, t0), meridianPt(lon, t1), false));
      }
    }
    // parallels
    for (let p = 1; p <= PARALLELS; p++) {
      const lat = (Math.PI * p) / (PARALLELS + 1) - Math.PI / 2;
      const isEq = Math.abs(lat) < 1e-6;
      for (let s = 0; s < SEG; s++) {
        const t0 = (Math.PI * 2 * s) / SEG;
        const t1 = (Math.PI * 2 * (s + 1)) / SEG;
        wire.push(seg(parallelPt(lat, t0), parallelPt(lat, t1), isEq));
      }
    }
    function meridianPt(lon, t) {
      // meridian at longitude `lon`, parameter t around the ring
      return { x: Math.sin(t) * Math.cos(lon), y: Math.sin(t) * Math.sin(lon), z: Math.cos(t) };
    }
    function parallelPt(lat, t) {
      const cl = Math.cos(lat);
      return { x: cl * Math.cos(t), y: cl * Math.sin(t), z: Math.sin(lat) };
    }
    function seg(a, b, isEq) {
      const node = el("line", { "stroke-width": isEq ? "1.4" : "1" });
      return { a, b, node, isEq };
    }

    // axis definitions: end world point, screen label, color, ket
    const AXES = [
      { v: { x: 0, y: 0, z: 1 }, ket: "|0⟩", col: "var(--pauli-z)", off: [0, -12] },
      { v: { x: 0, y: 0, z: -1 }, ket: "|1⟩", col: "var(--pauli-x)", off: [0, 16] },
      { v: { x: 1, y: 0, z: 0 }, ket: "|+⟩", col: "var(--text-tertiary)", off: [12, 4] },
      { v: { x: -1, y: 0, z: 0 }, ket: "|-⟩", col: "var(--text-tertiary)", off: [-12, 4] },
      { v: { x: 0, y: 1, z: 0 }, ket: "|i⟩", col: "var(--text-tertiary)", off: [10, -6] },
      { v: { x: 0, y: -1, z: 0 }, ket: "|-i⟩", col: "var(--text-tertiary)", off: [-12, -6] },
    ];
    const axisNodes = AXES.map((ax) => {
      const line = el("line", {
        stroke: ax.col, "stroke-width": "1.3", "stroke-opacity": "0.55",
        "stroke-dasharray": "3 3",
      });
      const label = el("text", {
        fill: ax.col, "font-family": "IBM Plex Mono, monospace",
        "font-size": "12", "text-anchor": "middle", "dominant-baseline": "central",
      });
      label.textContent = ax.ket;
      gAxes.appendChild(line);
      gAxes.appendChild(label);
      return { ax, line, label };
    });

    // state vector arrow (shaft + head + base dot + tip dot)
    const vecShaft = el("line", {
      stroke: "var(--warning)", "stroke-width": "3.5", "stroke-linecap": "round",
    });
    const vecHead = el("polygon", { fill: "var(--warning)" });
    const baseDot = el("circle", { cx: CX, cy: CY, r: "3.5", fill: "var(--text-secondary)" });
    const tipHalo = el("circle", { r: "6", fill: "var(--warning)", "fill-opacity": "0.9" });
    if (!reduceMotion) {
      vecShaft.style.transition = "all .45s cubic-bezier(.34,1.4,.5,1)";
      tipHalo.style.transition = "all .45s cubic-bezier(.34,1.4,.5,1)";
    }
    gVec.appendChild(vecShaft);
    gVec.appendChild(vecHead);
    gVec.appendChild(baseDot);
    gVec.appendChild(tipHalo);

    /* -------- render pass: reposition every dynamic node -------- */
    function render() {
      // wireframe: color by depth, sort so back draws first (dimmer)
      // We just reassign parents based on depth midpoint.
      for (const w of wire) {
        const pa = project(w.a), pb = project(w.b);
        const midDepth = (pa.depth + pb.depth) / 2;
        w.node.setAttribute("x1", pa.x); w.node.setAttribute("y1", pa.y);
        w.node.setAttribute("x2", pb.x); w.node.setAttribute("y2", pb.y);
        const front = midDepth >= 0;
        const baseCol = w.isEq ? "var(--stab-z)" : "var(--border-strong)";
        w.node.setAttribute("stroke", baseCol);
        w.node.setAttribute("stroke-opacity", front ? (w.isEq ? "0.7" : "0.5") : (w.isEq ? "0.28" : "0.16"));
        const targetGroup = front ? gFront : gBack;
        if (w.node.parentNode !== targetGroup) targetGroup.appendChild(w.node);
      }

      // axes
      for (const a of axisNodes) {
        const p = project(a.ax.v);
        a.line.setAttribute("x1", CX); a.line.setAttribute("y1", CY);
        a.line.setAttribute("x2", p.x); a.line.setAttribute("y2", p.y);
        a.line.setAttribute("stroke-opacity", p.depth >= 0 ? "0.6" : "0.28");
        const lx = CX + (p.x - CX) * 1.14 + a.ax.off[0];
        const ly = CY + (p.y - CY) * 1.14 + a.ax.off[1];
        a.label.setAttribute("x", lx);
        a.label.setAttribute("y", ly);
        a.label.setAttribute("fill-opacity", p.depth >= 0 ? "1" : "0.55");
      }

      // state vector
      const v = stateToVector(alpha, beta);
      const tip = project(v);
      vecShaft.setAttribute("x1", CX); vecShaft.setAttribute("y1", CY);
      vecShaft.setAttribute("x2", tip.x); vecShaft.setAttribute("y2", tip.y);
      tipHalo.setAttribute("cx", tip.x);
      tipHalo.setAttribute("cy", tip.y);

      // arrowhead: a small triangle pointing outward along the shaft
      const dx = tip.x - CX, dy = tip.y - CY;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const hl = 12, hw = 5;             // head length / half-width
      const bx = tip.x - ux * hl, by = tip.y - uy * hl;
      const px = -uy, py = ux;
      const pts = [
        [tip.x, tip.y],
        [bx + px * hw, by + py * hw],
        [bx - px * hw, by - py * hw],
      ].map((p) => p.join(",")).join(" ");
      vecHead.setAttribute("points", pts);

      // The arrow gets warmer when near a pole (pure state on axis)
      // purely cosmetic; keeps the "definitely 0/1" feel.
      if (changeCb) changeCb({ vector: v, state: getState(), label: label() });
    }

    /* -------------------- public methods -------------------- */
    function getState() {
      return { alpha: c(alpha.re, alpha.im), beta: c(beta.re, beta.im) };
    }
    function getVector() { return stateToVector(alpha, beta); }

    function setState(a, b) {
      const [na, nb] = normalize(
        typeof a === "number" ? c(a, 0) : a,
        typeof b === "number" ? c(b, 0) : b
      );
      alpha = na; beta = nb; render();
      return api;
    }
    function reset() { return setState(c(1, 0), c(0, 0)); }

    function applyGate(g) {
      const M = resolveGate(g);
      const [na, nb] = applyMatrix(M, alpha, beta);
      const [ra, rb] = normalize(na, nb);
      alpha = ra; beta = rb; render();
      return api;
    }

    function measureZ() {
      const p0 = cabs2(alpha);
      const r = Math.random() < p0 ? 0 : 1;
      if (r === 0) setState(c(1, 0), c(0, 0));
      else setState(c(0, 0), c(1, 0));
      return r;
    }

    /* Human-readable label for the current state (best-effort). */
    function label() {
      const v = stateToVector(alpha, beta);
      const near = (a, b) => Math.abs(a - b) < 0.02;
      if (near(v.z, 1)) return "|0⟩";
      if (near(v.z, -1)) return "|1⟩";
      if (near(v.x, 1)) return "|+⟩";
      if (near(v.x, -1)) return "|-⟩";
      if (near(v.y, 1)) return "|i⟩";
      if (near(v.y, -1)) return "|-i⟩";
      // general point on the sphere: give the polar readout
      const theta = Math.acos(Math.max(-1, Math.min(1, v.z))) * 180 / Math.PI;
      const phi = Math.atan2(v.y, v.x) * 180 / Math.PI;
      return "θ=" + theta.toFixed(0) + "°, φ=" + phi.toFixed(0) + "°";
    }

    function onChange(fn) { changeCb = fn; render(); return api; }

    /* -------------------- drag to rotate -------------------- */
    let dragging = false, lastX = 0, lastY = 0;
    function onDown(e) {
      dragging = true;
      const p = pointer(e);
      lastX = p.x; lastY = p.y;
      svg.style.cursor = "grabbing";
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      const p = pointer(e);
      yaw += (p.x - lastX) * 0.011;
      // Dragging up looks more from the top; keep |0> above the equator
      // by clamping pitch to a sensible top-view band.
      pitch -= (p.y - lastY) * 0.011;
      pitch = Math.max(0.06, Math.min(1.45, pitch));
      lastX = p.x; lastY = p.y;
      render();
    }
    function onUp() { dragging = false; svg.style.cursor = "grab"; }
    function pointer(e) {
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX, y: t.clientY };
    }

    if (interactive) {
      svg.style.cursor = "grab";
      svg.style.touchAction = "none";
      svg.addEventListener("mousedown", onDown);
      global.addEventListener("mousemove", onMove);
      global.addEventListener("mouseup", onUp);
      svg.addEventListener("touchstart", onDown, { passive: false });
      svg.addEventListener("touchmove", (e) => { onMove(e); e.preventDefault(); }, { passive: false });
      svg.addEventListener("touchend", onUp);
    }

    function destroy() {
      global.removeEventListener("mousemove", onMove);
      global.removeEventListener("mouseup", onUp);
    }

    const api = {
      setState, reset, applyGate, measureZ,
      getState, getVector, onChange, label, render, destroy,
      setView(y, p) { yaw = y; pitch = p; render(); return api; },
    };

    render();
    return api;
  }

  global.Bloch = { create, resolveGate, stateToVector, GATES, Rx, Ry, Rz };
})(window);
