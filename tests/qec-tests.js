/* ============================================================
   QEC EXPLORER - tests/qec-tests.js
   ------------------------------------------------------------
   Tiny vanilla-JS test framework. No dependencies. Designed so
   each test file attaches suites to a global `QECT` namespace
   that this runner aggregates and displays.

   Usage in test files:

     QECT.describe("group name", () => {
       QECT.it("name of test", () => {
         QECT.assert.equal(actual, expected);
       });
       QECT.it("async test", async () => { ... });
     });

   The runner attaches a click listener that calls runTests() and
   renders a DOM table of passes/fails.
   ============================================================ */

(function (global) {
  "use strict";

  const suites = [];   // [{name, fn, tests: [{name, fn}]}]

  function describe(name, fn) {
    const suite = { name, tests: [] };
    suites.push(suite);
    const common = { it: _setupIt(suite), describe: describe, name: "(nested describe in " + name + ") unsupported" };
    // We don't fully implement nested describes; flatten to a marker test instead.
    fn();
  }

  function _setupIt(suite) {
    return function it(name, fn) {
      suite.tests.push({ name, fn });
    };
  }

  function it(name, fn) {
    if (suites.length === 0) {
      suites.push({ name: "(default)", tests: [] });
    }
    suites[suites.length - 1].tests.push({ name, fn });
  }

  /* Assertions */
  const assert = {
    equal(a, b, msg) {
      if (!eq(a, b))
        throw new Error("equal: " + JSON.stringify({ actual: a, expected: b, msg }));
    },
    deepEqual(a, b, msg) {
      if (!deq(a, b))
        throw new Error("deepEqual: " + JSON.stringify({ actual: a, expected: b, msg }));
    },
    ok(v, msg) {
      if (!v) throw new Error("ok: " + (msg || "expected truthy, got " + JSON.stringify(v)));
    },
    throws(fn, msg) {
      let didThrow = false;
      try { fn(); } catch (_) { didThrow = true; }
      if (!didThrow) throw new Error("throws: " + (msg || "expected function to throw"));
    },
    truthySet(obj, missingKeys) {
      for (const k of missingKeys) {
        if (!(k in obj)) throw new Error("missing " + k);
      }
    },
  };

  function eq(a, b) {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!eq(a[k], b[k])) return false;
    return true;
  }
  function deq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* Render helpers */
  function escape(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  async function runTests() {
    var resultsEl = document.getElementById("results");
    var sumTotal = document.getElementById("sumTotal");
    var sumPass  = document.getElementById("sumPass");
    var sumFail  = document.getElementById("sumFail");
    var sumMs    = document.getElementById("sumMs");
    resultsEl.innerHTML = "";
    var total = 0, pass = 0, fail = 0;
    var t0 = performance.now();

    for (const suite of suites) {
      const head = document.createElement("div");
      head.className = "group";
      const headEl = document.createElement("div");
      headEl.className = "group-head";
      headEl.innerHTML = '<span>' + escape(suite.name) + '</span><span class="result-count" data-suite="' + escape(suite.name) + '"></span>';
      head.appendChild(headEl);
      const body = document.createElement("div");
      body.className = "group-body";
      head.appendChild(body);
      resultsEl.appendChild(head);

      let suiteCount = 0, suitePass = 0;
      for (const test of suite.tests) {
        total++; suiteCount++;
        const div = document.createElement("div");
        div.className = "test";
        const mark = document.createElement("span");
        mark.className = "mark";
        const name = document.createElement("div");
        name.className = "name";
        name.innerHTML = "<b>" + escape(test.name) + "</b>";
        div.appendChild(mark);
        div.appendChild(name);
        body.appendChild(div);

        try {
          const out = test.fn();
          if (out && typeof out.then === "function") await out;
          div.classList.add("pass");
          mark.textContent = "✓";
          pass++; suitePass++;
        } catch (err) {
          div.classList.add("fail");
          mark.textContent = "✗";
          fail++;
          const d = document.createElement("div");
          d.className = "failure-detail";
          d.textContent = (err && err.stack) ? err.stack : String(err);
          name.appendChild(d);
        }
      }
      const countEl = headEl.querySelector(".result-count");
      if (countEl) countEl.textContent = suitePass + " / " + suiteCount + " passed";
    }

    var t1 = performance.now();
    sumTotal.textContent = total;
    sumPass.textContent = pass;
    sumFail.textContent = fail;
    sumMs.textContent = Math.round(t1 - t0);
  }

  /* Expose */
  global.QECT = { describe: describe, it: it, assert: assert, run: runTests };
})(typeof window !== "undefined" ? window : this);
