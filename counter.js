/* ============================================================
   QEC EXPLORER — counter.js  (Phase 3: community counter)
   ------------------------------------------------------------
   Anonymous, no-accounts aggregate counters for a STATIC site
   (deployed on Vercel, no backend). Uses an external counter
   service over HTTPS+CORS.

   DEPLOYMENT NOTE: this project is a static site, NOT a Claude
   React artifact, so the artifact `window.storage` API does not
   exist here. A backend-free static site needs an external
   service. We use Abacus (abacus.jasoncameron.dev) — a free,
   account-less, CORS-enabled counter with /hit and /get endpoints
   returning {value:N}. (The older CountAPI was verified DOWN, so
   it was replaced with this maintained service.) Cross-request
   persistence was verified server-side before shipping.

   GRACEFUL DEGRADATION: every network call is wrapped so that if
   the service is unreachable, blocked, offline, or running from
   file://, the counter UI is HIDDEN rather than showing a broken
   "0" or an error. Nothing here can break the host page.

   Two metrics:
     - qec_errors_explored : a data-qubit toggle in any module
     - qec_races_run       : a "Run race" click in Module 2
   Reads are via /get (no increment); a toggle/race calls /hit.
   Toggle increments are debounced so rapid painting -> one write.
   ============================================================ */
(function (global) {
  "use strict";

  // Namespace+keys keep our counters isolated. Abacus uses the same
  // /hit/<ns>/<key> and /get/<ns>/<key> -> {value:N} shape as CountAPI.
  var NS = "qec-explorer-kondshk";
  var KEY_ERRORS = "errors_explored";
  var KEY_RACES = "races_run";
  var BASE = "https://abacus.jasoncameron.dev";

  // Module-level guard: if the service ever fails, stop trying for this page
  // load (so a dead service doesn't spam failed requests), and keep the UI hidden.
  var serviceOk = true;

  function fmt(n) {
    if (typeof n !== "number" || !isFinite(n)) return null;
    return n.toLocaleString("en-US");
  }

  // Low-level call with a hard timeout; resolves null on ANY failure.
  function call(path) {
    if (!serviceOk) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 4000);
      try {
        fetch(BASE + path, { method: "GET", mode: "cors", cache: "no-store" })
          .then(function (r) { return r && r.ok ? r.json() : null; })
          .then(function (j) { if (!done) { done = true; clearTimeout(to); resolve(j && typeof j.value === "number" ? j.value : null); } })
          .catch(function () { if (!done) { done = true; clearTimeout(to); resolve(null); } });
      } catch (e) {
        if (!done) { done = true; clearTimeout(to); resolve(null); }
      }
    });
  }

  function get(key) { return call("/get/" + NS + "/" + key); }
  function hit(key) { return call("/hit/" + NS + "/" + key); }

  /* ---- public: increment helpers (fire-and-forget, debounced for errors) ---- */
  var pendingErrorBump = false;
  var errorDebounceTimer = null;
  function bumpErrorsExplored() {
    // Debounce: rapid toggling -> a single /hit after the user pauses.
    pendingErrorBump = true;
    clearTimeout(errorDebounceTimer);
    errorDebounceTimer = setTimeout(function () {
      if (!pendingErrorBump) return;
      pendingErrorBump = false;
      hit(KEY_ERRORS).then(function (v) {
        if (v === null) { serviceOk = false; return; }
        updateDisplay(null, null); // refresh both from latest if a display exists
        liveSet("errors", v);
      });
    }, 1200);
  }
  function bumpRacesRun() {
    hit(KEY_RACES).then(function (v) {
      if (v === null) { serviceOk = false; return; }
      liveSet("races", v);
    });
  }

  /* ---- display: render into an element with id="qecCounter" if present ---- */
  var lastErrors = null, lastRaces = null;
  function liveSet(which, v) {
    if (which === "errors") lastErrors = v;
    if (which === "races") lastRaces = v;
    render();
  }
  function render() {
    var el = global.document && document.getElementById("qecCounter");
    if (!el) return;
    // Hide entirely unless we have at least one real number.
    if (lastErrors === null && lastRaces === null) { el.style.display = "none"; return; }
    var parts = [];
    if (lastErrors !== null) parts.push("<b>" + fmt(lastErrors) + "</b> error patterns explored");
    if (lastRaces !== null) parts.push("<b>" + fmt(lastRaces) + "</b> decoder races run");
    el.innerHTML = parts.join(" · ");
    el.style.display = "";
  }

  // Read current totals (no increment) and display. If both fail -> stay hidden.
  function updateDisplay() {
    Promise.all([get(KEY_ERRORS), get(KEY_RACES)]).then(function (res) {
      var e = res[0], r = res[1];
      if (e === null && r === null) { serviceOk = false; render(); return; }
      if (e !== null) lastErrors = e;
      if (r !== null) lastRaces = r;
      render();
    });
  }

  /* ---- expose ---- */
  global.QECCounter = {
    init: updateDisplay,            // call on page load to populate the display
    bumpErrorsExplored: bumpErrorsExplored,
    bumpRacesRun: bumpRacesRun,
  };
})(typeof window !== "undefined" ? window : this);
