(function () {
  const { el, fmtUSD, medicareShort } = window.STB;

  let built = false;
  // Module-scoped handles so activate() can update the picker + hospital list
  // on re-entry without rebuilding the form (which would wipe entered amounts
  // and any itemized lines held in the verdict).
  let currentCpt = null;
  let pickerHost = null;     // stable wrapper the picker re-renders into
  let hospSelect = null;
  let refreshHospitals = null;

  // Activate the bill view: build it once into #bill-view, then on every entry
  // update the route's cpt as the selected procedure. Idempotent w.r.t. user
  // input — never clears entered amounts or itemized lines.
  function activate(state) {
    if (!window.STB.doc) return;
    if (!built) { build(state); built = true; return; }
    const cpt = state && state.cpt;
    if (cpt && window.STB.doc.procedures[cpt] && cpt !== currentCpt) {
      currentCpt = cpt;
      renderPicker();
      if (refreshHospitals) refreshHospitals();
    }
  }

  let renderPicker = null;   // assigned in build(); re-renders the picker in place

  function build(state) {
    const container = document.getElementById("bill-view");
    if (!window.STB.doc) return;
    const doc = window.STB.doc;

    // Initial procedure: the route's cpt if valid, else the default.
    const initial = (state && state.cpt && doc.procedures[state.cpt]) ? state.cpt : window.STB.cpt;
    currentCpt = doc.procedures[initial] ? initial : null;

    hospSelect = el("select", { id: "chk-hosp" });
    function fillHospitals() {
      const p = currentCpt ? doc.procedures[currentCpt] : null;
      if (!p) { hospSelect.replaceChildren(); return; }
      hospSelect.replaceChildren(
        ...p.hospitals.map((h) => el("option", { value: h.key }, h.name)),
        el("option", { value: "__other__" }, "My hospital isn't listed"),
      );
    }
    refreshHospitals = fillHospitals;

    // The picker lives in a stable host; selecting re-renders just the picker
    // (and the hospital list), leaving the amounts and verdict untouched.
    pickerHost = el("div", { class: "chk-picker-host" });
    renderPicker = function () {
      pickerHost.replaceChildren(window.STB.buildProcedurePicker({
        selectedCpt: currentCpt, onSelect: selectProc, mode: "bill",
      }));
    };
    function selectProc(cpt) {
      if (!doc.procedures[cpt]) return;
      currentCpt = cpt;
      renderPicker();
      fillHospitals();           // preserves hospSelect default; amounts/verdict untouched
      Router.go({ mode: "bill", cpt });   // bookmarkable; re-fires stb:bill-mode (activate is idempotent)
    }
    renderPicker();
    fillHospitals();

    // Two amounts: what you were quoted (optional) and what you were charged.
    const quotedInput = el("input", { id: "chk-quoted", type: "number", min: "0", step: "0.01", placeholder: "optional" });
    const chargedInput = el("input", { id: "chk-charged", type: "number", min: "0", step: "0.01", placeholder: "e.g. 1300" });
    const goBtn = el("button", { type: "button", class: "chk-go" }, "Check it");
    const verdict = el("div", { id: "chk-verdict" });

    goBtn.addEventListener("click", () => {
      const charged = parseFloat(chargedInput.value);
      const quoted = parseFloat(quotedInput.value);   // may be NaN (optional)
      if (!currentCpt) {
        verdict.replaceChildren(el("p", { class: "warn" }, "Pick the procedure you think it was."));
        return;
      }
      if (!(charged > 0)) {
        verdict.replaceChildren(el("p", { class: "warn" }, "Enter the dollar amount you were charged."));
        return;
      }
      renderVerdict(verdict, doc.procedures[currentCpt], hospSelect.value, charged, quoted);
      // Gate-1 usage signal: count that A verdict was rendered — no amount, no
      // hospital, no PII; just the event (spec §5). No-op until GoatCounter exists.
      if (window.goatcounter && window.goatcounter.count) {
        window.goatcounter.count({ path: "checker-verdict", title: "Bill checker used", event: true });
      }
    });

    container.replaceChildren(el("div", { class: "checker" },
      el("h3", null, "Check a bill you received"),
      el("p", { class: "dim" },
        "Tell us the procedure you think it was, the hospital, and what you were charged " +
        "(and what you were quoted, if you have it). We compare it to that hospital's own published " +
        "prices and what Medicare pays — and if the charge is far above the procedure alone, we help you " +
        "find the extra codes hiding on your bill."),
      el("div", { class: "chk-form" },
        el("div", { class: "chk-field chk-field-proc" }, el("span", { class: "chk-field-label" }, "Procedure"), pickerHost),
        el("label", null, "Hospital ", hospSelect),
        el("label", null, "You were quoted ($) ", quotedInput),
        el("label", null, "You were charged ($) ", chargedInput),
        goBtn,
      ),
      el("p", { class: "micro dim" },
        "Everything you enter stays in your browser — this site has no server to send it to."),
      verdict,
    ));
  }

  function refs(h, tier2) {
    const costs = tier2 ? [] : [h.estimated_cost.bottom_up, h.estimated_cost.ccr_check].filter((v) => v != null);
    return {
      gross: h.gross_charge,
      cash: h.cash_price,
      medicare: h.medicare_reference.amount,
      costLow: costs.length ? Math.min(...costs) : null,
      costHigh: costs.length ? Math.max(...costs) : null,
    };
  }

  // Ordered comparison against pipeline-shipped reference values; no derived
  // judgment beyond "is the amount above this published/estimated number".
  function classify(amount, r) {
    if (r.gross != null && amount > r.gross) return "above_gross";
    if (r.cash != null && amount > r.cash) return "above_cash";
    if (r.costHigh != null && amount > r.costHigh) return "above_cost";
    if (r.medicare != null && amount > r.medicare) return "above_medicare";
    return "at_or_below";
  }

  // Verdict copy is tier/category-aware: labs are "tests" not "scans", and the
  // Tier-2 above_medicare line must NOT claim an estimated cost range (Tier-2
  // has no cost-to-deliver estimate — that would contradict the "not a cost
  // estimate" stance).
  function verdictCopy(band, p) {
    const noun = p.category === "lab" ? "test"
      : p.category === "imaging" ? "scan"
      : p.category === "em" ? "visit"
      : "procedure";
    switch (band) {
      case "above_gross": return `is higher than this hospital's own full chargemaster price for this ${noun}.`;
      case "above_cash": return "is higher than this hospital's posted cash (self-pay) price.";
      case "above_cost": return `is above the range both public-data methods estimate this ${noun} costs to deliver here.`;
      case "above_medicare": return p.tier === 2
        ? `is above what Medicare pays for the same ${noun}.`
        : `is above what Medicare pays for the same ${noun}, though within the estimated cost range.`;
      case "at_or_below": return `is at or below the lowest reference we have for this ${noun} here.`;
      default: return "";
    }
  }

  // Representative posted price for the base code at a hospital: cash preferred
  // (what a self-pay patient is offered), else the chargemaster gross.
  function basePostedPrice(r) {
    return r.cash != null ? r.cash : r.gross;
  }

  function renderVerdict(target, p, hospKey, charged, quoted) {
    if (hospKey === "__other__") {
      renderUnlisted(target, p, charged, quoted);
      return;
    }
    const h = p.hospitals.find((x) => x.key === hospKey);
    const tier2 = p.tier === 2;
    const r = refs(h, tier2);
    const band = classify(charged, r);

    const medLabel = tier2 ? `Medicare reference (${medicareShort(h.medicare_reference.basis)})` : "Medicare reference";
    const rows = tier2
      ? [
          ["Posted chargemaster price", r.gross, h.provenance.prices],
          ["Posted cash (self-pay) price", r.cash, h.provenance.prices],
          [medLabel, r.medicare, h.provenance.medicare],
        ]
      : [
          ["Posted chargemaster price", r.gross, h.provenance.prices],
          ["Posted cash (self-pay) price", r.cash, h.provenance.prices],
          ["Estimated cost to deliver (two methods)",
            null, h.provenance.bottom_up,
            r.costLow != null ? `${fmtUSD(r.costLow)} – ${fmtUSD(r.costHigh)}` : "-"],
          [medLabel, r.medicare, h.provenance.medicare],
        ];

    // Gap analysis: a charge clearly above the whole chargemaster price for this
    // one code almost always means a second code was billed alongside it.
    const grossOrCash = r.gross != null ? r.gross : r.cash;
    const culprit = (charged != null && grossOrCash != null && charged > grossOrCash * 1.25);

    target.replaceChildren(...[
      // Quoted-vs-charged framing (the real-world "I was told one number, billed another").
      (quoted > 0 && charged > quoted * 1.1)
        ? el("p", { class: "chk-quoted-line" },
            `You were quoted ${fmtUSD(quoted)} but charged ${fmtUSD(charged)} — a `,
            el("strong", null, fmtUSD(charged - quoted)),
            " difference.")
        : null,
      el("p", { class: "chk-verdict-line" },
        el("strong", null, fmtUSD(charged)),
        ` ${verdictCopy(band, p)}`),
      tier2 ? el("p", { class: "micro dim" },
        r.medicare == null
          ? "Medicare publishes no comparable facility rate for this code; compared against posted prices only."
          : `Tier 2: compared against posted prices and Medicare's ${medicareShort(h.medicare_reference.basis)} rate only — no cost-to-deliver estimate.`) : null,
      ...rows.map(([label, val, source, custom]) =>
        el("div", { class: "detail-row" },
          el("div", { class: "detail-label" }, label),
          el("div", { class: "detail-amount" }, custom != null ? custom : fmtUSD(val)),
          el("div", { class: "detail-source dim micro" }, source),
        )),
      culprit ? culpritFlag(p, charged, grossOrCash, hospKey) : null,
      itemizedSection(p, hospKey, charged, quoted),
      guidance(),
      el("p", { class: "micro dim" },
        "These are estimates from public data, compared for context — not a determination that any " +
        "bill is correct or incorrect, and not medical, legal, or financial advice."),
    ].filter((c) => c != null));
  }

  // Layer-2 culprit flag. Phase 3 names the specific likely add-on from the
  // curated base→add-on map (p.addons) and prices it at THIS hospital. Only
  // kind:"addon" codes (billed ALONGSIDE the base) are named — a variant is a
  // substitution and never pushes a bill above the base. `baseRef` is the SAME
  // posted price the gate used (gross-preferred), so the displayed multiple
  // matches what triggered the flag. Copy stays hedged ("usually"/"most often")
  // — it describes what commonly happens, never asserts what this bill contains.
  // The precise base+add-on reconciliation is the Layer-3 itemized checker's job.
  function culpritFlag(p, charged, baseRef, hospKey) {
    const n = (charged / baseRef).toFixed(1);
    const doc = window.STB.doc;
    const likely = (p.addons || []).filter((a) => a.kind === "addon").map((a) => {
      const ap = doc.procedures[a.cpt];
      const ah = ap && ap.hospitals ? ap.hospitals.find((x) => x.key === hospKey) : null;
      const price = ah ? (ah.cash_price != null ? ah.cash_price : ah.gross_charge) : null;
      return { label: a.label, cpt: a.cpt, price };
    });
    const withPrice = likely.find((a) => a.price != null);

    const parts = [
      el("p", null,
        `Your charge of `, el("strong", null, fmtUSD(charged)), ` is `,
        el("strong", null, `${n}×`),
        ` the posted price for ${p.label} alone (`, el("strong", null, fmtUSD(baseRef)), `). `,
        "A charge that far above one code's price usually means ",
        el("strong", null, "a second code was billed separately"), "."),
    ];

    if (withPrice) {
      parts.push(el("p", null,
        `For ${p.label.toLowerCase()}, that is most often `,
        el("strong", null, `${withPrice.label} (CPT ${withPrice.cpt})`),
        `, which this hospital posts at `, el("strong", null, fmtUSD(withPrice.price)), `.`));
    } else if (likely.length) {
      parts.push(el("p", null,
        `For ${p.label.toLowerCase()}, that is most often `,
        el("strong", null, `${likely[0].label} (CPT ${likely[0].cpt})`),
        ` — though this hospital doesn't post a separate price for it.`));
    } else {
      parts.push(el("p", null,
        "Common culprits include an add-on like color Doppler on an ultrasound, contrast on a scan, " +
        "or a separate facility fee."));
    }

    parts.push(el("p", null,
      el("strong", null, "Ask for your itemized bill"),
      " and enter the line items below to see exactly what you were charged for."));

    return el("div", { class: "chk-culprit" }, ...parts);
  }

  // ---- Layer 3: itemized line checker -------------------------------------
  // Wraps the line checker in a labeled section. Always offered (pre-seeded with
  // the base code) so the user can reconcile the gap line by line.
  function itemizedSection(p, hospKey, charged, quoted) {
    return el("div", { class: "itemized-section" },
      el("h4", null, "Itemized check"),
      el("p", { class: "dim micro" },
        "Enter each CPT code and its charge from your itemized bill. We price each against this hospital's " +
        "posted prices and Medicare. Codes other than the one you expected are flagged as likely add-ons."),
      itemizedChecker(p, hospKey, charged, quoted),
    );
  }

  // The interactive line checker. State is a local array of {cpt, charge}; it
  // never leaves the browser. Pre-seeded with one row = the base CPT.
  function itemizedChecker(p, hospKey, charged, quoted) {
    const doc = window.STB.doc;
    const lines = [{ cpt: p.cpt, charge: "" }];

    const rowsWrap = el("div", { class: "itemized" });
    const resultsWrap = el("div", { class: "iresults" });

    function syncFromInputs() {
      // Pull current input values into state (so re-render preserves edits).
      const rowEls = rowsWrap.querySelectorAll(".iline");
      rowEls.forEach((rowEl, i) => {
        if (!lines[i]) return;
        const cptEl = rowEl.querySelector(".icpt");
        const chgEl = rowEl.querySelector(".icharge");
        if (cptEl) lines[i].cpt = cptEl.value.trim();
        if (chgEl) lines[i].charge = chgEl.value;
      });
    }

    function renderRows() {
      rowsWrap.replaceChildren(...lines.map((ln, i) => {
        const cptInput = el("input", { class: "icpt", type: "text", inputmode: "numeric",
          placeholder: "CPT", value: ln.cpt || "" });
        const chargeInput = el("input", { class: "icharge", type: "number", min: "0", step: "0.01",
          placeholder: "charge ($)", value: ln.charge || "" });
        cptInput.addEventListener("input", () => { syncFromInputs(); renderResults(); });
        chargeInput.addEventListener("input", () => { syncFromInputs(); renderResults(); });
        const rm = el("button", { type: "button", class: "irm", title: "Remove line" }, "×");
        rm.addEventListener("click", () => {
          syncFromInputs();
          lines.splice(i, 1);
          if (lines.length === 0) lines.push({ cpt: "", charge: "" });
          renderRows();
          renderResults();
        });
        return el("div", { class: "iline" }, cptInput, chargeInput, rm);
      }));
    }

    // Price one entered CPT line against the selected hospital. Honest fallbacks:
    // unknown code → no benchmark; known code with no price here → say so. Never
    // invents a number.
    function priceLine(cpt, charge, isBase) {
      const verdict = el("div", { class: "iline-verdict" });
      const cls = ["iline-result"];
      if (!isBase) cls.push("addon");

      if (!cpt) {
        verdict.appendChild(el("span", { class: "dim" }, "Enter a CPT code."));
        return el("div", { class: cls.join(" ") }, lineHead(cpt, charge, isBase, null), verdict);
      }
      const proc = doc.procedures[cpt];
      if (!proc) {
        verdict.appendChild(el("span", { class: "dim" },
          "We don't have a benchmark for this code (it's not in our dataset) — still worth questioning on your itemized bill."));
        return el("div", { class: cls.join(" ") }, lineHead(cpt, charge, isBase, null), verdict);
      }
      if (hospKey === "__other__") {
        // No specific hospital — give the regional cash range + national Medicare
        // we do have, rather than implying any one hospital's price.
        const ranges = Object.values(proc.regional || {})
          .map((rr) => rr.cash_median).filter((v) => v != null);
        const parts = [];
        if (ranges.length) parts.push(`regional cash median ${fmtUSD(Math.min(...ranges))}–${fmtUSD(Math.max(...ranges))}`);
        if (proc.medicare_national_usd != null) parts.push(`Medicare national ${fmtUSD(proc.medicare_national_usd)}`);
        verdict.appendChild(el("span", { class: "dim" },
          parts.length ? `In our catalog as ${proc.label} — ${parts.join(" · ")}.`
            : `In our catalog as ${proc.label}, but we have no regional benchmark for it.`));
        return el("div", { class: cls.join(" ") }, lineHead(cpt, charge, isBase, null, proc.label), verdict);
      }
      const h = proc.hospitals.find((x) => x.key === hospKey);
      if (!h || (h.gross_charge == null && h.cash_price == null)) {
        verdict.appendChild(el("span", { class: "dim" },
          `In our catalog as ${proc.label}, but this hospital posts no price for it.`));
        const ref = h ? { gross: h.gross_charge, cash: h.cash_price, medicare: h.medicare_reference.amount,
          basis: h.medicare_reference.basis } : null;
        return el("div", { class: cls.join(" ") }, lineHead(cpt, charge, isBase, ref, proc.label), verdict);
      }
      const tier2 = proc.tier === 2;
      const r = refs(h, tier2);
      const ref = { gross: r.gross, cash: r.cash, medicare: r.medicare, basis: h.medicare_reference.basis };
      const amt = parseFloat(charge);
      if (amt > 0) {
        const band = classify(amt, r);
        verdict.appendChild(el("span", { class: "iline-band " + band }, lineBandCopy(band, r)));
      } else {
        verdict.appendChild(el("span", { class: "dim" }, "Enter the charge to compare."));
      }
      return el("div", { class: cls.join(" ") }, lineHead(cpt, charge, isBase, ref, proc.label), verdict);
    }

    function renderResults() {
      const priced = [];
      let sum = 0;
      lines.forEach((ln, i) => {
        const amt = parseFloat(ln.charge);
        if (amt > 0) sum += amt;
        priced.push(priceLine(ln.cpt, ln.charge, i === 0 && ln.cpt === p.cpt));
      });

      // Base-code posted price at this hospital (for the takeaway math).
      const baseH = p.hospitals.find((x) => x.key === hospKey);
      const baseR = (baseH) ? refs(baseH, p.tier === 2) : null;
      const basePosted = baseR ? basePostedPrice(baseR) : null;
      const otherCount = lines.filter((ln, i) => ln.cpt && !(i === 0 && ln.cpt === p.cpt)).length;

      const takeaway = el("div", { class: "itotal" });
      if (sum > 0) {
        const bits = [
          "Your entered charges total ", el("strong", null, fmtUSD(sum)), ". ",
        ];
        if (basePosted != null) {
          bits.push(`The procedure you expected (${p.label}) posts at `, el("strong", null, fmtUSD(basePosted)), " here");
          if (otherCount > 0 && sum > basePosted) {
            bits.push("; the rest is ", el("strong", null, fmtUSD(sum - basePosted)),
              ` across ${otherCount} other code${otherCount === 1 ? "" : "s"} — the add-ons that explain the gap.`);
          } else {
            bits.push(".");
          }
        } else {
          bits.push("This hospital posts no price for the expected procedure, so we can't size the gap here.");
        }
        takeaway.replaceChildren(el("p", null, ...bits));
      }

      resultsWrap.replaceChildren(...priced, takeaway);
    }

    const addBtn = el("button", { type: "button", class: "iadd" }, "+ Add line");
    addBtn.addEventListener("click", () => {
      syncFromInputs();
      lines.push({ cpt: "", charge: "" });
      renderRows();
      renderResults();
    });

    // Layer-3 quick-add: one-click "likely add-on" lines for this procedure.
    // Only kind:"addon" codes (billed ALONGSIDE the base); a variant is a
    // substitution, not an extra line, so it isn't offered as a quick-add.
    const likely = (p.addons || []).filter((a) => a.kind === "addon");
    const quickAdd = likely.length ? el("div", { class: "iaddons" },
      el("span", { class: "iaddons-label dim micro" }, `Likely add-ons for ${p.label}:`),
      ...likely.map((a) => {
        const chip = el("button", { type: "button", class: "iaddon-chip" }, `+ ${a.label} (${a.cpt})`);
        chip.addEventListener("click", () => {
          syncFromInputs();
          if (!lines.some((ln) => ln.cpt === a.cpt)) lines.push({ cpt: a.cpt, charge: "" });
          renderRows();
          renderResults();
        });
        return chip;
      }),
    ) : null;

    // Phase 4: build an editable dispute letter from the current itemized state.
    // Each line is resolved to {cpt,label,charge,postedCash,postedGross,medicare,
    // isAddon,inCatalog} so disputeLetterText can quote sourced prices and fall
    // back honestly for codes we don't have.
    function letterLine(ln, isBase) {
      const cpt = (ln.cpt || "").trim();
      const charge = parseFloat(ln.charge);
      const proc = doc.procedures[cpt];
      let label = null, postedCash = null, postedGross = null, medicare = null;
      if (proc) {
        label = proc.label;
        const hh = hospKey !== "__other__" ? proc.hospitals.find((x) => x.key === hospKey) : null;
        if (hh) { postedCash = hh.cash_price; postedGross = hh.gross_charge; medicare = hh.medicare_reference.amount; }
      }
      return { cpt, label, charge: Number.isFinite(charge) ? charge : null,
        postedCash, postedGross, medicare, isAddon: !isBase, inCatalog: !!proc };
    }

    const letterWrap = el("div", { class: "letter-wrap" });
    const genBtn = el("button", { type: "button", class: "letter-gen" }, "Generate a dispute letter");
    genBtn.addEventListener("click", () => {
      syncFromInputs();
      const hospitalName = hospKey === "__other__"
        ? "[Hospital name]"
        : ((p.hospitals.find((x) => x.key === hospKey) || {}).name || "[Hospital name]");
      const letterLines = lines
        .filter((ln) => (ln.cpt || "").trim())
        .map((ln, i) => letterLine(ln, i === 0 && (ln.cpt || "").trim() === p.cpt));
      const text = disputeLetterText({ hospitalName, procedureLabel: p.label, baseCpt: p.cpt,
        lines: letterLines, quoted, charged });
      const body = el("textarea", { class: "letter-body", rows: "20", spellcheck: "false" }, text);
      const copyBtn = el("button", { type: "button" }, "Copy");
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(body.value).then(() => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
        });
      });
      const dlBtn = el("button", { type: "button" }, "Download (.txt)");
      dlBtn.addEventListener("click", () => {
        const blob = new Blob([body.value], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = el("a", { href: url, download: "dispute-letter.txt" });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
      letterWrap.replaceChildren(
        el("p", { class: "dim micro" },
          "Fill in the bracketed placeholders, then copy or download. Nothing leaves your browser."),
        body,
        el("div", { class: "letter-actions" }, copyBtn, dlBtn),
      );
      body.focus();
    });

    renderRows();
    renderResults();
    return el("div", { class: "itemized-wrap" },
      el("div", { class: "iline ihead dim micro" },
        el("span", null, "CPT code"), el("span", null, "Charge ($)"), el("span", null, "")),
      rowsWrap,
      addBtn,
      quickAdd,
      resultsWrap,
      genBtn,
      letterWrap,
    );
  }

  // Phase 4: assemble a plain-text dispute/inquiry letter from the checker state.
  // Factual, not legal: it quotes the sourced posted/Medicare numbers and the
  // standard patient-rights asks, requests review/itemization — never asserts a
  // bill is "illegal" or guarantees an outcome. For codes we have no benchmark
  // for, it asks for an explanation rather than inventing a reference price.
  function disputeLetterText({ hospitalName, procedureLabel, baseCpt, lines, quoted, charged }) {
    const money = (n) => n == null ? null
      : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const L = [];
    L.push(`To the Billing Department, ${hospitalName}:`);
    L.push("");
    L.push("Date: [date]");
    L.push("Account #: [account number]");
    L.push("Patient: [patient name]");
    L.push("");
    L.push(`I am writing to request an itemized review of the charges for ${procedureLabel} (CPT ${baseCpt}).`);
    if (quoted > 0 && charged > 0) {
      L.push(`I was quoted ${money(quoted)} for this service but was billed ${money(charged)} — a difference of ${money(charged - quoted)}.`);
    }
    L.push("");
    L.push("The charges I am questioning:");
    L.push("");
    lines.forEach((ln) => {
      const chg = ln.charge != null ? `charged ${money(ln.charge)}` : "charge not listed";
      let line;
      if (ln.inCatalog && ln.postedCash != null) {
        const med = ln.medicare != null ? `, and Medicare pays ${money(ln.medicare)} for the same service` : "";
        line = `  - CPT ${ln.cpt} (${ln.label}) — ${chg}; this hospital's posted cash (self-pay) price is ${money(ln.postedCash)}${med}.`;
      } else if (ln.inCatalog) {
        line = `  - CPT ${ln.cpt} (${ln.label}) — ${chg}; this hospital publishes no separate price for this code, so I request a written explanation of it.`;
      } else {
        line = `  - CPT ${ln.cpt} — ${chg}; I request a written explanation of this charge and the service it represents.`;
      }
      if (ln.isAddon) line += ` This code was not part of the ${procedureLabel} I was quoted.`;
      L.push(line);
    });
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
    L.push("Prepared with publicly posted hospital prices and Medicare reference rates, plus standard patient-rights provisions. This is a template to help you ask questions — not legal advice, and not a determination that any charge is incorrect.");
    return L.join("\n");
  }

  // One result line's header: the code/label + the posted/Medicare references we
  // have for it at this hospital (so the per-line judgment is auditable).
  function lineHead(cpt, charge, isBase, ref, label) {
    const tag = isBase ? el("span", { class: "iline-tag base" }, "expected") : el("span", { class: "iline-tag addon" }, "possible add-on");
    const refBits = [];
    if (ref) {
      if (ref.cash != null || ref.gross != null) {
        refBits.push(`posted cash ${fmtUSD(ref.cash)} · gross ${fmtUSD(ref.gross)}`);
      }
      if (ref.medicare != null) {
        refBits.push(`Medicare ${fmtUSD(ref.medicare)}${ref.basis ? " (" + medicareShort(ref.basis) + ")" : ""}`);
      }
    }
    return el("div", { class: "iline-head" },
      el("span", { class: "iline-code" }, `CPT ${cpt || "—"}`),
      label ? el("span", { class: "iline-label dim" }, label) : null,
      tag,
      refBits.length ? el("span", { class: "iline-refs dim micro" }, refBits.join(" · ")) : null,
    );
  }

  // Per-line band copy: the same ordered judgment as the headline verdict, in a
  // compact form for each line.
  function lineBandCopy(band, r) {
    switch (band) {
      case "above_gross": return "above this hospital's chargemaster price";
      case "above_cash": return "above the posted cash price";
      case "above_cost": return "above the estimated cost to deliver";
      case "above_medicare": return "above what Medicare pays";
      case "at_or_below": return "at or below the lowest reference here";
      default: return "";
    }
  }

  function renderUnlisted(target, p, charged, quoted) {
    const regionRows = Object.entries(p.regional).map(([key, r]) =>
      el("div", { class: "detail-row" },
        el("div", { class: "detail-label" }, key === "dfw" ? "Dallas–Fort Worth cash range" : "SE WY / NE Panhandle cash range"),
        el("div", { class: "detail-amount" }, `${fmtUSD(r.cash_min)} – ${fmtUSD(r.cash_max)} (median ${fmtUSD(r.cash_median)})`),
        el("div", { class: "detail-source dim micro" }, "Hospital MRFs, 10 facilities"),
      ));
    // Use the regional cash median as the base reference for the gap heuristic
    // when the hospital itself isn't in our set.
    const medians = Object.values(p.regional).map((r) => r.cash_median).filter((v) => v != null);
    const basePosted = medians.length ? Math.min(...medians) : null;
    const culprit = (basePosted != null && charged > basePosted * 1.25);

    target.replaceChildren(...[
      (quoted > 0 && charged > quoted * 1.1)
        ? el("p", { class: "chk-quoted-line" },
            `You were quoted ${fmtUSD(quoted)} but charged ${fmtUSD(charged)} — a `,
            el("strong", null, fmtUSD(charged - quoted)),
            " difference.")
        : null,
      el("p", { class: "chk-verdict-line" },
        el("strong", null, fmtUSD(charged)),
        " — your hospital isn't in our 10-facility dataset, so here is the context we can offer:"),
      ...regionRows,
      p.medicare_national_usd != null
        ? el("div", { class: "detail-row" },
            el("div", { class: "detail-label" }, "Medicare national rate (unadjusted)"),
            el("div", { class: "detail-amount" }, fmtUSD(p.medicare_national_usd)),
            el("div", { class: "detail-source dim micro" }, p.tier === 2 ? "CY2026 Medicare " + medicareShort(window.STB.tier2Basis(p)) : "CY2026 OPPS Addendum B"))
        : el("p", { class: "dim micro" }, "Medicare reference unavailable for this code."),
      culprit ? el("div", { class: "chk-culprit" },
        el("p", null,
          `Your charge of `, el("strong", null, fmtUSD(charged)),
          ` is well above the regional cash price for ${p.label} alone (`,
          el("strong", null, fmtUSD(basePosted)), " median). ",
          "A charge that far above one code's price usually means ",
          el("strong", null, "a second code was billed separately"),
          " — for example an add-on like color Doppler on an ultrasound, contrast on a scan, or a separate facility fee."),
        el("p", null,
          el("strong", null, "Ask for your itemized bill"),
          " and enter the line items below to check each code against the hospitals we do have."),
      ) : null,
      itemizedSection(p, "__other__", charged, quoted),
      guidance(),
      el("p", { class: "micro dim" },
        "Our data covers 10 hospitals in two regions. Prices elsewhere vary, but the same public files " +
        "exist for every US hospital — that's the point."),
    ].filter((c) => c != null));
  }

  function guidance() {
    return el("div", { class: "chk-guidance" },
      el("h4", null, "What you can do next"),
      el("ul", null,
        el("li", null, "Ask for an itemized bill — billing errors are common, and you're entitled to one. Enter each line above to see exactly what you were charged for."),
        el("li", null, "Ask for the self-pay or prompt-pay rate; hospitals often discount when asked directly."),
        el("li", null, "Nonprofit hospitals must have financial-assistance (charity care) policies — ask whether you qualify; many patients do without knowing it."),
        el("li", null, "If you were uninsured or self-pay, you may have been entitled to a Good Faith Estimate; bills far above it can be disputed under the No Surprises Act."),
      ),
      el("p", { class: "micro dim" }, "The dispute-letter generator is live — use the “Generate a dispute letter” button above to create an editable letter, pre-filled from your entries with the standard patient-rights requests. Copy or download it; nothing leaves your browser."),
    );
  }

  document.addEventListener("stb:bill-mode", (e) => activate(e.detail));
})();
