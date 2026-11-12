/* Benchprep wireframe: section comments with replies.
   Adds a "Comment" button to every <section data-section>, a page-level
   "Comments" list, and saves everything to a Google Sheet through a
   Google Apps Script web app. */
(function () {
  "use strict";

  var COMMENTS_ENDPOINT = "https://script.google.com/macros/s/AKfycbxKyElr5fLI2WT25DcY5C6DLJ4_aGDqtgvrlsDc3Iph1dtsYwc_XR_6uNPT6BQ5JNr2MQ/exec";
  var NAME_KEY = "bp-wf-commenter-name";
  var REFRESH_MS = 60000;

  var sections = document.querySelectorAll("section[data-section]");
  if (!sections.length) { return; }

  var configured = /^https:\/\/script\.google\.com\//.test(COMMENTS_ENDPOINT);
  var pageName = sections[0].getAttribute("data-page") || document.title.split("|")[0].trim();
  var all = [];         // every comment on this page
  var buttons = {};     // section -> button
  var sectionEls = {};  // section -> element
  var openState = null; // {kind: "section", n} or {kind: "page"}

  /* ---------- styles (plain, to match the wireframe) ---------- */
  var F = "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  var css = [
    ".bpc-btn{position:absolute;top:2px;right:8px;z-index:5;font:12px/1.2 " + F + ";background:#fff;color:#000;border:1px solid #000;padding:4px 8px;cursor:pointer}",
    ".bpc-btn:hover,.bpc-btn:focus-visible{background:#000;color:#fff;outline:none}",
    ".bpc-btn.bpc-has{background:#000;color:#fff;font-weight:600}",
    ".bpc-fab{position:fixed;right:max(24px,env(safe-area-inset-right,0px));bottom:max(24px,env(safe-area-inset-bottom,0px));z-index:900;font:14px/1.2 " + F + ";background:#fff;color:#000;border:2px solid #000;padding:12px 18px;cursor:pointer}",
    ".bpc-fab:hover,.bpc-fab:focus-visible{background:#000;color:#fff;outline:none}",
    ".bpc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:max(24px,env(safe-area-inset-top,0px)) 16px 24px;overflow-y:auto}",
    ".bpc-panel{background:#fff;color:#000;border:2px solid #000;width:100%;max-width:560px;padding:20px;font:15px/1.45 " + F + "}",
    ".bpc-panel h2{font-size:17px;margin:0 0 4px;border:0;padding:0}",
    ".bpc-sub{font-size:13px;margin:0 0 16px}",
    ".bpc-close{float:right;font:inherit;font-size:13px;background:#fff;border:1px solid #000;padding:4px 10px;cursor:pointer;margin-left:12px}",
    ".bpc-list{list-style:none;margin:0 0 16px;padding:0;max-height:48vh;overflow-y:auto;border-top:1px solid #000}",
    ".bpc-item{border-bottom:1px solid #000;padding:10px 0}",
    ".bpc-replies{list-style:none;margin:8px 0 0 16px;padding:0 0 0 12px;border-left:2px solid #000}",
    ".bpc-replies .bpc-item{border-bottom:0;padding:6px 0}",
    ".bpc-meta{font-size:12px;margin-bottom:4px}",
    ".bpc-meta b{font-weight:600}",
    ".bpc-text{white-space:pre-wrap;overflow-wrap:anywhere}",
    ".bpc-link{font:inherit;font-size:12px;background:none;border:0;padding:0;margin-top:6px;text-decoration:underline;cursor:pointer;color:#000}",
    ".bpc-group{font-size:13px;font-weight:600;margin:14px 0 4px}",
    ".bpc-empty{font-size:13px;margin:0 0 16px}",
    ".bpc-form label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}",
    ".bpc-form input,.bpc-form textarea{width:100%;box-sizing:border-box;border:1px solid #000;padding:8px;font:inherit;background:#fff;color:#000;border-radius:0}",
    ".bpc-form textarea{min-height:90px;resize:vertical}",
    ".bpc-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}",
    ".bpc-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}",
    ".bpc-actions button{font:inherit;font-size:14px;padding:8px 16px;background:#fff;color:#000;border:1px solid #000;cursor:pointer}",
    ".bpc-actions .bpc-primary{border-width:2px;font-weight:600}",
    ".bpc-status{font-size:13px;margin-top:8px;min-height:1em}"
  ].join("");
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text != null) { n.textContent = text; }
    return n;
  }
  function getName() { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } }
  function setName(v) { try { localStorage.setItem(NAME_KEY, v); } catch (e) {} }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) { return ""; }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " +
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function heading(n) {
    var h = sectionEls[n] && sectionEls[n].querySelector("h1,h2,h3");
    return h ? h.textContent.trim() : "";
  }
  function topLevel(n) {
    return all.filter(function (c) { return !c.parent && (n == null || String(c.section) === String(n)); });
  }
  function repliesTo(id) { return all.filter(function (c) { return c.parent === id; }); }
  function countFor(n) {
    var tops = topLevel(n), k = tops.length;
    tops.forEach(function (c) { k += repliesTo(c.id).length; });
    return k;
  }

  /* ---------- section buttons and page button ---------- */
  Array.prototype.forEach.call(sections, function (sec) {
    var n = sec.getAttribute("data-section");
    sectionEls[n] = sec;
    var b = el("button", "bpc-btn", "Comment");
    b.type = "button";
    b.setAttribute("aria-label", "Comment on " + pageName + ", Section " + n);
    b.addEventListener("click", function () { openSection(n); });
    sec.appendChild(b);
    buttons[n] = b;
  });
  var fab = el("button", "bpc-fab", "Comments");
  fab.type = "button";
  fab.addEventListener("click", openPage);
  document.body.appendChild(fab);

  function refreshCounts() {
    Object.keys(buttons).forEach(function (n) {
      var k = countFor(n);
      buttons[n].textContent = k ? k + (k === 1 ? " comment" : " comments") : "Comment";
      buttons[n].classList.toggle("bpc-has", k > 0);
    });
    var total = all.length;
    fab.textContent = total ? "Comments (" + total + ")" : "Comments";
  }

  /* ---------- data ---------- */
  function load() {
    if (!configured) { return Promise.resolve(); }
    var url = COMMENTS_ENDPOINT + "?page=" + encodeURIComponent(pageName) + "&t=" + Date.now();
    return fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      all = (data && data.comments) || [];
      refreshCounts();
    }).catch(function () { /* the page still works if the sheet cannot be reached */ });
  }
  function post(payload) {
    return fetch(COMMENTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.ok) { throw new Error((res && res.error) || "failed"); }
      return res;
    });
  }

  /* ---------- panel ---------- */
  var overlay = null;
  function closePanel() {
    if (overlay) { overlay.remove(); overlay = null; }
    openState = null;
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") { closePanel(); } }
  function shell(title, sub) {
    if (overlay) { overlay.remove(); }
    overlay = el("div", "bpc-overlay");
    overlay.addEventListener("click", function (e) { if (e.target === overlay) { closePanel(); } });
    var panel = el("div", "bpc-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", title);
    var x = el("button", "bpc-close", "Close"); x.type = "button"; x.addEventListener("click", closePanel);
    panel.appendChild(x);
    panel.appendChild(el("h2", null, title));
    if (sub) { panel.appendChild(el("p", "bpc-sub", sub)); }
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    return panel;
  }

  function form(opts) {
    // opts: {section, parent, submitLabel, onDone}
    var f = el("form", "bpc-form");
    var uid = "bpc" + Math.random().toString(36).slice(2, 8);
    var lName = el("label", null, "Your name"); lName.htmlFor = uid + "n";
    var iName = el("input"); iName.id = uid + "n"; iName.type = "text"; iName.required = true; iName.maxLength = 80; iName.value = getName(); iName.autocomplete = "name";
    var lText = el("label", null, opts.parent ? "Reply" : "Comment"); lText.htmlFor = uid + "t";
    var iText = el("textarea"); iText.id = uid + "t"; iText.required = true; iText.maxLength = 4000;
    var hp = el("input", "bpc-hp"); hp.type = "text"; hp.tabIndex = -1; hp.autocomplete = "off"; hp.setAttribute("aria-hidden", "true");
    var actions = el("div", "bpc-actions");
    if (opts.onCancel) {
      var c = el("button", null, "Cancel"); c.type = "button"; c.addEventListener("click", opts.onCancel); actions.appendChild(c);
    }
    var send = el("button", "bpc-primary", opts.submitLabel); send.type = "submit";
    actions.appendChild(send);
    var status = el("div", "bpc-status"); status.setAttribute("role", "status");
    [lName, iName, lText, iText, hp, actions, status].forEach(function (x) { f.appendChild(x); });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!configured) { status.textContent = "Comments are not connected yet."; return; }
      var name = iName.value.trim(), text = iText.value.trim();
      if (!name || !text) { return; }
      setName(name);
      send.disabled = true;
      status.textContent = "Posting…";
      post({
        page: pageName, section: opts.section, heading: heading(opts.section), parent: opts.parent || "",
        name: name, comment: text, url: location.href.split("#")[0], website: hp.value
      }).then(function () {
        status.textContent = "Posted. Thank you.";
        return load();
      }).then(function () {
        opts.onDone();
      }).catch(function () {
        send.disabled = false;
        status.textContent = "That did not go through. Please try again in a moment.";
      });
    });
    setTimeout(function () { (iName.value ? iText : iName).focus(); }, 0);
    return f;
  }

  function renderThread(list, c, rerender) {
    var li = el("li", "bpc-item");
    li.appendChild(metaLine(c));
    li.appendChild(el("div", "bpc-text", c.comment));
    var reps = repliesTo(c.id);
    if (reps.length) {
      var ul = el("ul", "bpc-replies");
      reps.forEach(function (r) {
        var rl = el("li", "bpc-item");
        rl.appendChild(metaLine(r));
        rl.appendChild(el("div", "bpc-text", r.comment));
        ul.appendChild(rl);
      });
      li.appendChild(ul);
    }
    var rb = el("button", "bpc-link", "Reply"); rb.type = "button";
    rb.addEventListener("click", function () {
      rb.remove();
      li.appendChild(form({
        section: c.section, parent: c.id, submitLabel: "Post reply",
        onCancel: rerender, onDone: rerender
      }));
    });
    li.appendChild(rb);
    list.appendChild(li);
  }
  function metaLine(c) {
    var m = el("div", "bpc-meta");
    var b = el("b", null, c.name || "Anonymous");
    m.appendChild(b);
    if (c.timestamp) { m.appendChild(document.createTextNode(" · " + fmtDate(c.timestamp))); }
    return m;
  }

  function openSection(n) {
    openState = { kind: "section", n: n };
    var h = heading(n);
    var panel = shell(pageName + " · Section " + n, h ? "“" + h + "”" : "");
    var tops = topLevel(n);
    if (tops.length) {
      var list = el("ul", "bpc-list");
      tops.forEach(function (c) { renderThread(list, c, function () { openSection(n); }); });
      panel.appendChild(list);
    } else {
      panel.appendChild(el("p", "bpc-empty", configured ? "No comments on this section yet." : "Comments are not connected yet."));
    }
    panel.appendChild(form({ section: n, submitLabel: "Post comment", onDone: function () { openSection(n); } }));
  }

  function openPage() {
    openState = { kind: "page" };
    var panel = shell("Comments on " + pageName, all.length ? "" : "");
    var tops = topLevel(null);
    if (!tops.length) {
      panel.appendChild(el("p", "bpc-empty", configured
        ? "No comments on this page yet. Use the Comment button on any section to add one."
        : "Comments are not connected yet."));
      return;
    }
    var list = el("ul", "bpc-list");
    Object.keys(sectionEls).forEach(function (n) {
      var group = topLevel(n);
      if (!group.length) { return; }
      var g = el("li", "bpc-group");
      var jump = el("button", "bpc-link", "Section " + n + (heading(n) ? ": " + heading(n) : ""));
      jump.type = "button";
      jump.addEventListener("click", function () {
        closePanel();
        sectionEls[n].scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(function () { openSection(n); }, 450);
      });
      g.appendChild(jump);
      list.appendChild(g);
      group.forEach(function (c) { renderThread(list, c, openPage); });
    });
    panel.appendChild(list);
  }

  load();
  setInterval(function () { if (!openState && !document.hidden) { load(); } }, REFRESH_MS);
})();
