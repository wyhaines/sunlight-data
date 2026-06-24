// Shared glossary + tooltip engine. One map of plain-language definitions, a
// term()/source() helper that marks up the visible text, and a delegated
// popover that works for both JS-rendered and static-HTML terms. ES5-safe and
// dual-exported so the pure contract (TERMS/defFor) is node --test'able.
(function (root) {
  "use strict";

  var TERMS = {
    insurer_negotiated: { label: "Insurer-negotiated rates", def: "What this hospital agreed to accept from insurance plans — shown as the lowest, middle, and highest across the plans it discloses. Usually far below the list price, and often below the cash price." },
    chargemaster: { label: "List price (chargemaster)", def: "The hospital's official list price — its full “sticker” price before any discount or insurer negotiation. Almost nobody actually pays this." },
    cash_price: { label: "Cash (self-pay) price", def: "The discounted price the hospital offers if you pay directly, without insurance." },
    medicare_reference: { label: "Medicare reference", def: "What Medicare pays a hospital for this service — a public, regulated benchmark to measure a price against." },
    x_medicare: { label: "×Medicare", def: "How many times higher the price is than Medicare's rate — e.g. 6× means six times what Medicare pays for the same service." },
    ccr: { label: "cost-to-charge ratio (CCR)", def: "A hospital-wide ratio from its Medicare cost report. Multiplying it by the list price gives a rough estimate of what a service actually costs the hospital to deliver." },
    bottom_up: { label: "estimated cost to deliver", def: "Our independent estimate of what a service costs to deliver, built up from staff time, equipment, and overhead." },
    technical_fee: { label: "facility (technical) fee", def: "The hospital's charge for the room, equipment, and staff. The doctor's separate fee for reading or performing the procedure is billed apart and isn't included here." },
    cah: { label: "Critical Access Hospital", def: "A small rural hospital that Medicare pays based on its costs, not standard rates. For these, the Medicare figure shown is a benchmark, not the literal payment." },
    opps: { label: "OPPS", def: "Medicare's Outpatient Prospective Payment System — the standard rates it pays hospitals for outpatient services." },
    clfs: { label: "CLFS", def: "Medicare's Clinical Laboratory Fee Schedule — its national rates for lab tests." },
    pfs: { label: "PFS", def: "Medicare's Physician Fee Schedule — used here for a few services Medicare doesn't pay under the hospital outpatient system." },
    cpt: { label: "CPT code", def: "The standard nationwide billing code for a specific medical service." }
  };

  function defFor(key) {
    return (TERMS[key] && TERMS[key].def) || null;
  }

  // Map a Medicare-reference basis to the glossary term key that explains it.
  function basisTermKey(basis) {
    if (basis === "clfs") return "clfs";
    if (basis === "pfs" || basis === "pfs_technical") return "pfs";
    if (basis === "cost_based") return "cah";
    return "opps"; // opps_technical / opps_facility / opps / unavailable
  }

  var API = { TERMS: TERMS, defFor: defFor, basisTermKey: basisTermKey };

  if (typeof document !== "undefined") {
    var pop = null;
    var lastTrigger = null;
    function ensurePop() {
      if (!pop) {
        pop = document.createElement("div");
        pop.className = "glossary-pop";
        document.body.appendChild(pop);
      }
      return pop;
    }
    function textFor(elm) {
      var k = elm.getAttribute("data-term");
      if (k != null) return defFor(k);
      return elm.getAttribute("data-src");
    }
    function show(elm) {
      var t = textFor(elm);
      if (!t) return;
      var p = ensurePop();
      p.textContent = t;
      p.classList.add("visible");
      lastTrigger = elm;
      var r = elm.getBoundingClientRect();
      var maxLeft = window.scrollX + document.documentElement.clientWidth - 296;
      p.style.left = Math.max(window.scrollX + 4, Math.min(r.left + window.scrollX, maxLeft)) + "px";
      var ph = p.getBoundingClientRect().height;
      var vh = document.documentElement.clientHeight;
      if (r.bottom + 6 + ph > vh && r.top - 6 - ph > 0) {
        p.style.top = (r.top + window.scrollY - ph - 6) + "px"; // flip above
      } else {
        p.style.top = (r.bottom + window.scrollY + 6) + "px";   // below (default)
      }
    }
    function hide() { if (pop) pop.classList.remove("visible"); lastTrigger = null; }
    function trigger(target) {
      return target && target.closest ? target.closest("[data-term],[data-src]") : null;
    }
    document.addEventListener("mouseover", function (ev) { var t = trigger(ev.target); if (t) show(t); });
    document.addEventListener("mouseout", function (ev) { if (trigger(ev.target)) hide(); });
    document.addEventListener("focusin", function (ev) { var t = trigger(ev.target); if (t) show(t); });
    document.addEventListener("focusout", function (ev) { if (trigger(ev.target)) hide(); });
    document.addEventListener("click", function (ev) {
      var t = trigger(ev.target);
      if (!t) { hide(); return; }
      ev.stopPropagation();
      if (pop && pop.classList.contains("visible") && lastTrigger === t) hide(); else show(t);
    });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") hide(); });

    API.term = function (key, text) {
      var d = defFor(key);
      var label = (text != null) ? text : ((TERMS[key] && TERMS[key].label) || key);
      if (!d) return document.createTextNode(String(label));
      var span = document.createElement("span");
      span.className = "term";
      span.setAttribute("data-term", key);
      span.setAttribute("tabindex", "0");
      span.setAttribute("title", d);
      span.appendChild(document.createTextNode(String(label)));
      return span;
    };
    API.source = function (text, marker) {
      var span = document.createElement("span");
      span.className = "src";
      span.setAttribute("tabindex", "0");
      if (text) { span.setAttribute("data-src", String(text)); span.setAttribute("title", String(text)); }
      span.appendChild(document.createTextNode(marker || "ⓘ"));
      return span;
    };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.STBGlossary = API;
})(typeof window !== "undefined" ? window : globalThis);
