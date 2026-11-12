/* Benchprep wireframe: section comments.
   Adds a "Comment" button to every <section data-section> and saves comments
   to a Google Sheet through a Google Apps Script web app.
   Set COMMENTS_ENDPOINT to the web app URL from Deploy > Manage deployments. */
(function () {
  "use strict";

  var COMMENTS_ENDPOINT = "PASTE_WEB_APP_URL_HERE";
  var NAME_KEY = "bp-wf-commenter-name";

  var sections = document.querySelectorAll("section[data-section]");
  if (!sections.length) { return; }

  var configured = /^https:\/\/script\.google\.com\//.test(COMMENTS_ENDPOINT);
  var pageName = sections[0].getAttribute("data-page") || document.title.split("|")[0].trim();
  var byKey = {};      // "3" -> [comments]
  var buttons = {};    // "3" -> button

  /* ---------- styles (plain, to match the wireframe) ---------- */
  var css = [
    ".bpc-btn{position:absolute;top:2px;right:8px;z-index:5;font:12px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
    "background:#fff;color:#000;border:1px solid #000;padding:4px 8px;cursor:pointer}",
    ".bpc-btn:hover,.bpc-btn:focus-visible{background:#000;color:#fff;outline:none}",
    ".bpc-btn[data-count]:not([data-count='0'])::after{content:' (' attr(data-count) ')'}",
    ".bpc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1000;display:flex;align-items:flex-start;justify-content:center;",
    "padding:max(24px,env(safe-area-inset-top,0px)) 16px 24px;overflow-y:auto}",
    ".bpc-panel{background:#fff;color:#000;border:2px solid #000;width:100%;max-width:520px;padding:20px;",
    "font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
    ".bpc-panel h2{font-size:17px;margin:0 0 4px}",
    ".bpc-panel .bpc-sub{font-size:13px;margin:0 0 16px}",
    ".bpc-list{list-style:none;margin:0 0 16px;padding:0;max-height:40vh;overflow-y:auto;border-top:1px solid #000}",
    ".bpc-list li{border-bottom:1px solid #000;padding:10px 0}",
    ".bpc-meta{font-size:12px;margin-bottom:4px}",
    ".bpc-text{white-space:pre-wrap;overflow-wrap:anywhere}",
    ".bpc-empty{font-size:13px;margin:0 0 16px}",
    ".bpc-panel label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}",
    ".bpc-panel input,.bpc-panel textarea{width:100%;box-sizing:border-box;border:1px solid #000;padding:8px;font:inherit;background:#fff;color:#000;border-radius:0}",
    ".bpc-panel textarea{min-height:110px;resize:vertical}",
    ".bpc-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}",
    ".bpc-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}",
    ".bpc-actions button{font:inherit;font-size:14px;padding:8px 16px;background:#fff;color:#000;border:1px solid #000;cursor:pointer}",
    ".bpc-actions .bpc-primary{border-width:2px;font-weight:600}",
    ".bpc-status{font-size:13px;margin-top:10px;min-height:1em}"
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
  function sectionHeading(sec) {
    var h = sec.querySelector("h1,h2,h3");
    return h ? h.textContent.trim() : "";
  }

  /* ---------- buttons ---------- */
  Array.prototype.forEach.call(sections, function (sec) {
    var n = sec.getAttribute("data-section");
    var b = el("button", "bpc-btn", "Comment");
    b.type = "button";
    b.setAttribute("data-count", "0");
    b.setAttribute("aria-label", "Comment on " + pageName + ", Section " + n);
    b.addEventListener("click", function () { openPanel(sec, n); });
    sec.appendChild(b);
    buttons[n] = b;
  });

  function refreshCounts() {
    Object.keys(buttons).forEach(function (n) {
      buttons[n].setAttribute("data-count", String((byKey[n] || []).length));
    });
  }

  /* ---------- load existing comments ---------- */
  function load() {
    if (!configured) { return Promise.resolve(); }
    var url = COMMENTS_ENDPOINT + "?page=" + encodeURIComponent(pageName) + "&t=" + Date.now();
    return fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      byKey = {};
      (data.comments || []).forEach(function (c) {
        var k = String(c.section);
        (byKey[k] = byKey[k] || []).push(c);
      });
      refreshCounts();
    }).catch(function () { /* comments stay hidden if the sheet cannot be reached */ });
  }

  /* ---------- panel ---------- */
  var overlay = null;
  function closePanel() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") { closePanel(); } }

  function openPanel(sec, n) {
    closePanel();
    overlay = el("div", "bpc-overlay");
    overlay.addEventListener("click", function (e) { if (e.target === overlay) { closePanel(); } });
    var panel = el("div", "bpc-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Comments on " + pageName + ", Section " + n);

    panel.appendChild(el("h2", null, pageName + " · Section " + n));
    var head = sectionHeading(sec);
    panel.appendChild(el("p", "bpc-sub", head ? "“" + head + "”" : ""));

    var existing = byKey[n] || [];
    if (existing.length) {
      var list = el("ul", "bpc-list");
      existing.forEach(function (c) {
        var li = el("li");
        li.appendChild(el("div", "bpc-meta", (c.name || "Anonymous") + (c.timestamp ? " · " + fmtDate(c.timestamp) : "")));
        li.appendChild(el("div", "bpc-text", c.comment));
        list.appendChild(li);
      });
      panel.appendChild(list);
    } else {
      panel.appendChild(el("p", "bpc-empty", configured ? "No comments on this section yet." : "Comments are not connected yet."));
    }

    var form = el("form");
    var nameId = "bpc-name", textId = "bpc-text";
    var lName = el("label", null, "Your name"); lName.htmlFor = nameId;
    var iName = el("input"); iName.id = nameId; iName.type = "text"; iName.required = true; iName.maxLength = 80; iName.value = getName(); iName.autocomplete = "name";
    var lText = el("label", null, "Comment"); lText.htmlFor = textId;
    var iText = el("textarea"); iText.id = textId; iText.required = true; iText.maxLength = 4000;
    var hp = el("input", "bpc-hp"); hp.type = "text"; hp.tabIndex = -1; hp.autocomplete = "off"; hp.setAttribute("aria-hidden", "true"); hp.name = "website";
    var actions = el("div", "bpc-actions");
    var cancel = el("button", null, "Cancel"); cancel.type = "button"; cancel.addEventListener("click", closePanel);
    var send = el("button", "bpc-primary", "Post comment"); send.type = "submit";
    var status = el("div", "bpc-status"); status.setAttribute("role", "status");
    actions.appendChild(cancel); actions.appendChild(send);
    [lName, iName, lText, iText, hp, actions, status].forEach(function (x) { form.appendChild(x); });
    panel.appendChild(form);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!configured) { status.textContent = "Comments are not connected yet."; return; }
      var name = iName.value.trim(), text = iText.value.trim();
      if (!name || !text) { return; }
      setName(name);
      send.disabled = true;
      status.textContent = "Posting…";
      var payload = {
        page: pageName,
        section: n,
        heading: head,
        name: name,
        comment: text,
        url: location.href.split("#")[0],
        website: hp.value
      };
      fetch(COMMENTS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (!res || !res.ok) { throw new Error((res && res.error) || "failed"); }
        status.textContent = "Posted. Thank you.";
        return load().then(function () { setTimeout(function () { openPanel(sec, n); }, 600); });
      }).catch(function () {
        send.disabled = false;
        status.textContent = "That did not go through. Please try again in a moment.";
      });
    });

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    (iName.value ? iText : iName).focus();
  }

  load();
})();
