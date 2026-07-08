/* ============================================================
   QEC EXPLORER — assets/qec-shared.js
   ------------------------------------------------------------
   Tiny vanilla-JS helpers used by every page:

     - toToast(textOrHTML)   : show a transient bottom toast
     - announce(text)        : mirror a message into the SR live
                               region (multiple regions auto-merged)
     - modal(key, opts)      : open / close a modal by id
     - shortcuts(reg)        : register a per-page shortcut map;
                               press "?" to open a cheat-sheet
                               overlay listing the shortcuts
     - encodeHash(obj)       : encode key=value pairs to a URL hash
     - decodeHash(str)       : decode key=value pairs from a hash

   No external dependencies. Optional to use — pages may also
   handle their own state. Designed to be progressively enhanced.

   License: same MIT as the rest of this project.
   ============================================================ */

(function (global) {
  "use strict";

  /* ---------- toast ---------- */
  function ensureToastEl() {
    var el = document.getElementById("qecToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "qecToast";
      el.className = "toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    return el;
  }
  function toToast(html, ms) {
    var el = ensureToastEl();
    el.innerHTML = html;
    el.classList.add("show");
    announce(el.textContent || "");
    clearTimeout(el._tm);
    el._tm = setTimeout(function () { el.classList.remove("show"); }, ms || 3200);
  }

  /* ---------- screen-reader announce ---------- */
  function announce(text) {
    var el = document.getElementById("qecSrLive");
    if (!el) {
      el = document.createElement("div");
      el.id = "qecSrLive";
      el.className = "sr-only";
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-atomic", "true");
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  /* ---------- modal helpers ---------- */
  function modal(id, open) {
    var el = document.getElementById(id);
    if (!el) return false;
    el.classList.toggle("show", !!open);
    el.setAttribute("aria-hidden", open ? "false" : "true");
    return true;
  }
  function closeAllModals() {
    document.querySelectorAll(".qec-modal.show").forEach(function (el) {
      el.classList.remove("show");
      el.setAttribute("aria-hidden", "true");
    });
  }

  /* ---------- shortcut cheat sheet ---------- */
  var SHORTCUTS = []; // [{combo, label, page?}]
  function shortcuts(reg) {
    if (Array.isArray(reg)) SHORTCUTS.push.apply(SHORTCUTS, reg);
    ensureCheatSheet();
  }
  function ensureCheatSheet() {
    var el = document.getElementById("qecCheat");
    if (el) return el;
    el = document.createElement("div");
    el.id = "qecCheat";
    el.className = "qec-modal";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "qecCheatTitle");
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<div class="qec-modal-card">' +
        '<h3 id="qecCheatTitle">Keyboard shortcuts</h3>' +
        '<div id="qecCheatList"></div>' +
        '<p class="hint">Press <kbd>ESC</kbd> or <kbd>?</kbd> again to dismiss.</p>' +
      '</div>';
    document.body.appendChild(el);
    renderCheatSheet();
    // Click backdrop = close
    el.addEventListener("click", function (e) {
      if (e.target === el) el.classList.remove("show");
    });
    return el;
  }
  function renderCheatSheet() {
    var list = document.getElementById("qecCheatList");
    var inner = SHORTCUTS.map(function (s) {
      return '<div class="row"><kbd>' + escapeHTML(s.combo) + '</kbd><span>' +
             escapeHTML(s.label) + '</span></div>';
    }).join("");
    list.innerHTML = inner || '<p class="hint">No shortcuts registered.</p>';
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Treat a target as "typing" if it's a form field or a contentEditable node —
  // we don't want the cheat-sheet keybinding to hijack an actual "?" character.
  function _isTypingTarget(target) {
    if (!target) return false;
    var tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (target.isContentEditable) return true;
    return false;
  }
  // Global key handler: '?' toggles the cheat sheet; ESC closes any modal.
  document.addEventListener("keydown", function (e) {
    if (e.key === "?" && !_isTypingTarget(e.target)) {
      var sheet = ensureCheatSheet();
      sheet.classList.toggle("show");
      sheet.setAttribute("aria-hidden", sheet.classList.contains("show") ? "false" : "true");
      e.preventDefault();
      return;
    }
    // ESC closes modals even from inside an input — Escape is never typed, so safe to handle.
    if (e.key === "Escape") closeAllModals();
  });

  /* ---------- URL hash codec ---------- */
  function encodeHash(obj) {
    return Object.keys(obj).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]);
    }).join("&");
  }
  function decodeHash(s) {
    var out = {};
    if (!s) return out;
    s.replace(/^#/, "").split("&").forEach(function (pair) {
      var i = pair.indexOf("=");
      if (i < 0) return;
      var k = decodeURIComponent(pair.slice(0, i));
      var v = decodeURIComponent(pair.slice(i + 1));
      out[k] = v;
    });
    return out;
  }

  /* ---------- debounce ---------- */
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  /* ---------- export ---------- */
  global.QEC = {
    toast: toToast,
    announce: announce,
    modal: modal,
    closeAllModals: closeAllModals,
    shortcuts: shortcuts,
    encodeHash: encodeHash,
    decodeHash: decodeHash,
    debounce: debounce,
  };
})(typeof window !== "undefined" ? window : this);
