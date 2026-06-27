// web/sections.js — pure procedure-section model for the Shop/Check-a-bill picker.
// Sections are derived from the CPT number range / HCPCS structure ONLY (never
// from descriptor text), with our own plain-language labels. Dual-exported like
// glossary.js / relevance.js so the pure contract is node --test'able.
(function (root) {
  "use strict";

  var SECTIONS = [
    { key: "imaging", label: "Imaging" },
    { key: "lab", label: "Lab & pathology" },
    { key: "visits", label: "Visits & medical services" },
    { key: "procedures", label: "Procedures & surgery" },
    { key: "other", label: "Supplies, drugs & other" },
  ];

  // Cold-start "common procedures" row: each is a pre-filled search fed to the
  // breadth matcher (NOT one hand-picked code).
  var COMMON_PROCEDURES = [
    { label: "Mammogram", query: "mammogram" },
    { label: "MRI", query: "mri" },
    { label: "CT scan", query: "ct scan" },
    { label: "Ultrasound", query: "ultrasound" },
    { label: "X-ray", query: "x-ray" },
    { label: "Blood panels", query: "panel" },
    { label: "Colonoscopy", query: "colonoscopy" },
    { label: "Office visit", query: "office visit" },
  ];

  // CPT/HCPCS structure → section key. Leading letter (HCPCS Level II) and
  // trailing T (Category III) are "other"; otherwise bucket by numeric range.
  function sectionOf(code) {
    var c = String(code == null ? "" : code).toUpperCase();
    if (/^[A-Z]/.test(c)) return "other";
    if (/T$/.test(c)) return "other";
    var n = parseInt(c, 10);
    if (!isFinite(n)) return "other";
    if (n >= 70010 && n <= 79999) return "imaging";
    if (n >= 80047 && n <= 89398) return "lab";
    if (n >= 90000 && n <= 99607) return "visits";
    if ((n >= 10004 && n <= 69999) || (n >= 100 && n <= 1999)) return "procedures";
    return "other";
  }

  function sectionCounts(procIndex) {
    var codes = (procIndex && procIndex.codes) || {};
    var counts = {};
    SECTIONS.forEach(function (s) { counts[s.key] = 0; });
    Object.keys(codes).forEach(function (code) {
      var k = sectionOf(code);
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }

  // Codes in one section whose name or code contains the query (case-insensitive),
  // sorted by code, capped at limit. Returns {total, items}; empty query → whole
  // section (still capped). total is the full match count for the "N of M" note.
  function filterSection(procIndex, sectionKey, query, limit) {
    var codes = (procIndex && procIndex.codes) || {};
    var q = String(query == null ? "" : query).trim().toLowerCase();
    var lim = limit == null ? 50 : limit;
    var matches = [];
    Object.keys(codes).forEach(function (code) {
      if (sectionOf(code) !== sectionKey) return;
      var e = codes[code];
      if (q && String(e.name).toLowerCase().indexOf(q) < 0 && code.toLowerCase().indexOf(q) < 0) return;
      matches.push({ cpt: code, name: e.name, needs_curation: !!e.needs_curation });
    });
    matches.sort(function (a, b) { return a.cpt < b.cpt ? -1 : a.cpt > b.cpt ? 1 : 0; });
    return { total: matches.length, items: matches.slice(0, lim) };
  }

  var API = {
    SECTIONS: SECTIONS, COMMON_PROCEDURES: COMMON_PROCEDURES,
    sectionOf: sectionOf, sectionCounts: sectionCounts, filterSection: filterSection,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.STBSections = API;
})(typeof window !== "undefined" ? window : globalThis);
