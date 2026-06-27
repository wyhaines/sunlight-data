// web/letter.js — pure dispute-letter text assembly. Given resolved itemized
// line data (codes/descriptions plus the sourced posted / insurer-negotiated /
// Medicare prices the checker looked up), produce the plain-text letter. No DOM,
// no data lookup — checker.js resolves the prices and hands them in. Dual-exported
// like sections.js / relevance.js so the pure contract is node --test'able.
(function (root) {
  "use strict";

  function money(n) {
    return n == null ? null
      : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Insurer-negotiated clause: median headline, with the min–max range when both
  // are present and distinct. Returns "" when there is no negotiated data — the
  // letter never invents a number.
  function negClause(neg) {
    if (!neg) return "";
    var med = neg.median, lo = neg.min, hi = neg.max;
    if (med == null && lo == null && hi == null) return "";
    if (med != null && lo != null && hi != null && lo !== hi) {
      return ", insurers negotiate about " + money(med) + " (" + money(lo) + "–" + money(hi) + ") for it";
    }
    if (med != null) return ", insurers negotiate about " + money(med) + " for it";
    if (lo != null && hi != null && lo !== hi) return ", insurers negotiate " + money(lo) + "–" + money(hi) + " for it";
    if (lo != null) return ", insurers negotiate " + money(lo) + " for it";
    return "";
  }

  // One questioned-charge bullet. Four cases, each honest about what we know:
  // matched+priced (quote posted cash + negotiated + Medicare), matched but the
  // hospital posts no price (ask for an explanation), matched code with no
  // catalog record, and a raw bill line with no code at all (quote it verbatim).
  function lineText(ln, procedureLabel) {
    var chg = ln.charge != null ? "charged " + money(ln.charge) : "charge not listed";
    var line;
    if (ln.cpt && ln.inCatalog && ln.postedCash != null) {
      var neg = negClause(ln.negotiated);
      var med = ln.medicare != null ? ", and Medicare pays " + money(ln.medicare) + " for the same service" : "";
      line = "  - CPT " + ln.cpt + " (" + ln.label + ") — " + chg +
        "; this hospital's posted cash (self-pay) price is " + money(ln.postedCash) + neg + med + ".";
    } else if (ln.cpt && ln.inCatalog) {
      line = "  - CPT " + ln.cpt + " (" + ln.label + ") — " + chg +
        "; this hospital publishes no separate price for this code, so I request a written explanation of it.";
    } else if (ln.cpt) {
      line = "  - CPT " + ln.cpt + " — " + chg +
        "; I request a written explanation of this charge and the service it represents.";
    } else {
      var desc = String(ln.text == null ? "this charge" : ln.text).trim() || "this charge";
      line = "  - \"" + desc + "\" — " + chg +
        "; this line appears on my bill without a billing code. I request the CPT/HCPCS code for it " +
        "and a written explanation of the service it represents.";
    }
    if (ln.isAddon && ln.cpt) line += " This code was not part of the " + procedureLabel + " I was quoted.";
    return line;
  }

  // Assemble the full plain-text dispute/inquiry letter. Factual, not legal: it
  // quotes the sourced numbers and the standard patient-rights asks, requests
  // review/itemization — never asserts a bill is "illegal" or guarantees outcome.
  function disputeLetterText(opts) {
    var hospitalName = opts.hospitalName, procedureLabel = opts.procedureLabel, baseCpt = opts.baseCpt;
    var lines = opts.lines || [], quoted = opts.quoted, charged = opts.charged;
    var L = [];
    L.push("To the Billing Department, " + hospitalName + ":");
    L.push("");
    L.push("Date: [date]");
    L.push("Account #: [account number]");
    L.push("Patient: [patient name]");
    L.push("");
    L.push("I am writing to request an itemized review of the charges for " + procedureLabel + " (CPT " + baseCpt + ").");
    if (quoted > 0 && charged > 0) {
      L.push("I was quoted " + money(quoted) + " for this service but was billed " + money(charged) +
        " — a difference of " + money(charged - quoted) + ".");
    }
    L.push("");
    L.push("The charges I am questioning:");
    L.push("");
    lines.forEach(function (ln) { L.push(lineText(ln, procedureLabel)); });
    L.push("");
    L.push("I request the following:");
    L.push("");
    L.push("  1. A fully itemized bill listing every code, its charge, and a plain-language description.");
    L.push("  2. Review and correction of any charge above this hospital's own posted price for the same code.");
    L.push("  3. The self-pay / prompt-pay rate, and any discount available if I pay directly.");
    L.push("  4. Your financial-assistance (charity care) policy and an application — nonprofit hospitals are required to have one, and many patients qualify without realizing it.");
    L.push("  5. If I was uninsured or self-pay, a Good Faith Estimate under the federal No Surprises Act; a bill substantially above that estimate may be disputed.");
    L.push("");
    L.push("Please respond in writing. Thank you for your attention to this matter.");
    L.push("");
    L.push("[Your name]");
    L.push("[Your contact information]");
    L.push("");
    L.push("---");
    L.push("Prepared with publicly posted hospital prices, insurer-negotiated rates, and Medicare reference rates, " +
      "plus standard patient-rights provisions. This is a template to help you ask questions — not legal advice, " +
      "and not a determination that any charge is incorrect.");
    return L.join("\n");
  }

  var API = { disputeLetterText: disputeLetterText, negClause: negClause };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.STBLetter = API;
})(typeof window !== "undefined" ? window : globalThis);
