(function () {
  const { el, fmtUSD, medicareShort } = window.STB;
  const G = () => window.STBGlossary;

  let built = false;
  // Module-scoped handles so activate() can update the picker + hospital list
  // on re-entry without rebuilding the form (which would wipe entered amounts
  // and any itemized lines held in the verdict).
  let currentCpt = null;
  let pickerHost = null;     // stable wrapper the picker re-renders into
  let hospPickerHost = null; // stable wrapper the hospital search picker re-renders into
  let selectedHospitalKey = null; // chosen hospital key, or "__other__", or null (unpicked)
  let refreshHospitals = null;
  let stepHost = null;       // the 3-step progress indicator, updated by setStep()

  // Activate the bill view: build it once into #bill-view, then on every entry
  // update the route's cpt as the selected procedure. Idempotent w.r.t. user
  // input — never clears entered amounts or itemized lines.
  function activate(state) {
    if (!window.STB.doc) return;
    if (!built) { build(state); built = true; return; }
    const cpt = state && state.cpt;
    if (cpt && cpt !== currentCpt) {
      currentCpt = cpt;
      renderPicker();
      if (refreshHospitals) refreshHospitals();
    }
  }

  // Resolve the selected/entered CPT to a renderable record (curated from
  // data.json or a lazy-loaded breadth shard) via the shared resolver. onLoad is
  // re-invoked when a breadth shard finishes loading. Status: ok|loading|error|none.
  function resolveProc(cpt, onLoad) {
    if (window.STBBreadth) return window.STBBreadth.resolveRecord(cpt, window.STB.doc, onLoad || function () {});
    if (!cpt) return { status: "none" };
    const d = window.STB.doc;
    return d.procedures[cpt] ? { status: "ok", p: d.procedures[cpt] } : { status: "none" };
  }

  let renderPicker = null;   // assigned in build(); re-renders the picker in place

  function build(state) {
    const container = document.getElementById("bill-view");
    if (!window.STB.doc) return;
    const doc = window.STB.doc;

    // Initial procedure: the route's cpt if valid, else the default.
    const initial = (state && state.cpt) ? state.cpt : window.STB.cpt;
    currentCpt = initial || null;
    selectedHospitalKey = null;   // start unpicked — the user must choose their hospital

    // The hospital field is a search-pick-chip widget (the same pattern as Shop's
    // location anchor): type to filter THIS procedure's hospitals by name / city /
    // state, click to choose, then it collapses to a compact chip. Scales past a
    // flat <select> as more states are added. "My hospital isn't listed" stays a
    // persistent action driving the honest-fallback verdict (the "__other__" key).
    hospPickerHost = el("div", { class: "chk-hosp-host" });
    function locLabel(h) {
      const loc = [h.city, h.state].filter(Boolean).join(", ");
      return loc ? `${h.name} — ${loc}` : h.name;
    }
    function renderHospitalPicker() {
      const res = resolveProc(currentCpt, renderHospitalPicker);
      const p = res.status === "ok" ? res.p : null;
      if (!p) {
        hospPickerHost.replaceChildren(el("p", { class: "micro dim" },
          res.status === "loading" ? "Loading this procedure…" : "Pick a procedure first."));
        return;
      }
      const hosps = p.hospitals;

      // Drop a stale pick if the chosen hospital doesn't price the new procedure
      // ("__other__" is procedure-independent, so it survives).
      if (selectedHospitalKey && selectedHospitalKey !== "__other__" &&
          !hosps.some((h) => h.key === selectedHospitalKey)) {
        selectedHospitalKey = null;
      }

      // SELECTED → compact chip with a Change affordance.
      if (selectedHospitalKey) {
        const h = selectedHospitalKey === "__other__"
          ? null : hosps.find((x) => x.key === selectedHospitalKey);
        const label = selectedHospitalKey === "__other__"
          ? "My hospital isn't listed" : (h ? locLabel(h) : selectedHospitalKey);
        const change = el("button", { class: "anchor-change", type: "button" }, "Change");
        change.addEventListener("click", () => { selectedHospitalKey = null; renderHospitalPicker(); });
        hospPickerHost.replaceChildren(el("div", { class: "anchor-control chk-hosp-chip" },
          el("span", { class: "anchor-pin" }, "🏥"),
          el("span", { class: "anchor-current" }, label),
          change,
        ));
        return;
      }

      // EMPTY / TYPING → search input + filtered results + persistent escape hatch.
      const input = el("input", {
        class: "picker-input", type: "search", autocomplete: "off",
        placeholder: "Search your hospital by name, city, or state", "aria-label": "Your hospital",
      });
      const results = el("ul", { class: "picker-results", hidden: "" });
      function choose(key) { selectedHospitalKey = key; renderHospitalPicker(); }
      function renderResults() {
        const q = input.value.trim();
        if (!q) { results.hidden = true; results.replaceChildren(); return; }
        const r = window.STBRelevance.searchAnchorCandidates(q, { hospitals: hosps, places: {} });
        const items = r.hospitals.map((h) => {
          const li = el("li", { class: "picker-result" }, locLabel(h));
          li.addEventListener("click", () => choose(h.key));
          return li;
        });
        if (!items.length) {
          items.push(el("li", { class: "picker-empty dim" },
            "No match — check the spelling, or use “My hospital isn’t listed” below."));
        }
        results.hidden = false;
        results.replaceChildren(...items);
      }
      input.addEventListener("input", renderResults);

      const notListed = el("button", { type: "button", class: "chk-hosp-notlisted" }, "My hospital isn't listed");
      notListed.addEventListener("click", () => choose("__other__"));

      hospPickerHost.replaceChildren(
        el("div", { class: "picker-search" }, input, results),
        notListed,
      );
    }
    refreshHospitals = renderHospitalPicker;

    // The picker lives in a stable host; selecting re-renders just the picker
    // (and the hospital list), leaving the amounts and verdict untouched.
    pickerHost = el("div", { class: "chk-picker-host" });
    renderPicker = function () {
      pickerHost.replaceChildren(window.STB.buildProcedurePicker({
        selectedCpt: currentCpt, onSelect: selectProc, mode: "bill",
      }));
    };
    function selectProc(cpt) {
      if (resolveProc(cpt, () => { renderPicker(); renderHospitalPicker(); }).status === "none") return;
      currentCpt = cpt;
      renderPicker();
      renderHospitalPicker();    // re-scopes hospital search; re-renders via onLoad when a breadth shard lands
      Router.go({ mode: "bill", cpt });   // bookmarkable; re-fires stb:bill-mode (activate is idempotent)
    }
    renderPicker();
    renderHospitalPicker();

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
      if (!selectedHospitalKey) {
        verdict.replaceChildren(el("p", { class: "warn" },
          "Pick the hospital that sent you the bill (or “My hospital isn't listed”)."));
        return;
      }
      if (!(charged > 0)) {
        verdict.replaceChildren(el("p", { class: "warn" }, "Enter the dollar amount you were charged."));
        return;
      }
      function runVerdict() {
        const res = resolveProc(currentCpt, runVerdict);
        if (res.status !== "ok") {
          verdict.replaceChildren(el("p", { class: res.status === "error" ? "warn" : "dim" },
            res.status === "loading" ? "Loading this procedure…" : "Pick the procedure you think it was."));
          return;
        }
        renderVerdict(verdict, res.p, selectedHospitalKey, charged, quoted);
      }
      runVerdict();
      // Gate-1 usage signal: count that A verdict was rendered — no amount, no
      // hospital, no PII; just the event (spec §5). No-op until GoatCounter exists.
      if (window.goatcounter && window.goatcounter.count) {
        window.goatcounter.count({ path: "checker-verdict", title: "Bill checker used", event: true });
      }
    });

    stepHost = el("div", { class: "chk-stepper-host" }, stepper(1));
    container.replaceChildren(el("div", { class: "checker" },
      el("h3", null, "Check a bill you received"),
      el("p", { class: "dim" },
        "Tell us the procedure you think it was, the hospital, and what you were charged " +
        "(and what you were quoted, if you have it). We compare it to that hospital's own published " +
        "prices and what Medicare pays — and if the charge is far above the procedure alone, we help you " +
        "find the extra codes hiding on your bill."),
      stepHost,
      el("div", { class: "chk-form" },
        el("div", { class: "chk-field chk-field-proc" }, el("span", { class: "chk-field-label" }, "Procedure"), pickerHost),
        el("div", { class: "chk-field chk-field-hosp" }, el("span", { class: "chk-field-label" }, "Hospital"), hospPickerHost),
        el("label", null, "You were quoted ($) ", quotedInput),
        el("label", null, "You were charged ($) ", chargedInput),
        goBtn,
      ),
      el("p", { class: "micro dim" },
        "Everything you enter stays in your browser — this site has no server to send it to."),
      verdict,
    ));
  }

  // Progress indicator across the three steps; setStep re-renders it in place.
  function stepper(active) {
    const steps = [[1, "What you were billed"], [2, "The gut-check"], [3, "Break it down"]];
    return el("div", { class: "chk-stepper" }, ...steps.map(([n, label]) =>
      el("span", { class: "chk-step" + (n === active ? " active" : (n < active ? " done" : "")) }, `${n} · ${label}`)));
  }
  function setStep(n) { if (stepHost) stepHost.replaceChildren(stepper(n)); }

  function refs(h, tier2) {
    // breadth-only Tier-1: no bottom-up, only ccr_check (may be null)
    const breadthImaging = !tier2 && h.cost_breakdown == null;
    let costs;
    if (tier2) {
      costs = [];
    } else if (breadthImaging) {
      costs = [h.estimated_cost && h.estimated_cost.ccr_check].filter((v) => v != null);
    } else {
      costs = [h.estimated_cost.bottom_up, h.estimated_cost.ccr_check].filter((v) => v != null);
    }
    return {
      gross: h.gross_charge,
      cash: h.cash_price,
      medicare: h.medicare_reference.amount,
      costLow: costs.length ? Math.min(...costs) : null,
      costHigh: costs.length ? Math.max(...costs) : null,
      breadthImaging,
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
  // estimate" stance). `breadthImaging` changes above_cost copy to singular method.
  function verdictCopy(band, p, breadthImaging) {
    const noun = p.category === "lab" ? "test"
      : p.category === "imaging" ? "scan"
      : p.category === "em" ? "visit"
      : "procedure";
    switch (band) {
      case "above_gross": return `is higher than this hospital's own full chargemaster price for this ${noun}.`;
      case "above_cash": return "is higher than this hospital's posted cash (self-pay) price.";
      case "above_cost": return breadthImaging
        ? `is above the CCR-based estimate of what this ${noun} costs to deliver here.`
        : `is above the range both public-data methods estimate this ${noun} costs to deliver here.`;
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
    if (hospKey === "__other__") { renderUnlisted(target, p, charged, quoted); return; }
    setStep(2);
    const h = p.hospitals.find((x) => x.key === hospKey);
    const tier2 = p.tier === 2;
    const r = refs(h, tier2);
    const { breadthImaging } = r;
    const band = classify(charged, r);
    const basePosted = basePostedPrice(r);
    const mult = (basePosted != null && basePosted > 0) ? charged / basePosted : null;

    // Step 3 is built lazily and revealed by the CTA (prominent when a far-above
    // charge implies a second billed code).
    const grossOrCash = r.gross != null ? r.gross : r.cash;
    const culprit = (charged != null && grossOrCash != null && charged > grossOrCash * 1.25);
    const step3 = el("div", { class: "chk-step3", hidden: "" });
    const reveal = el("button", { class: "chk-reveal", type: "button" },
      culprit ? "→ Break down your itemized bill" : "Break it down line by line");
    let built3 = false;
    reveal.addEventListener("click", () => {
      if (!built3) {
        step3.replaceChildren(...[
          culprit ? culpritFlag(p, charged, grossOrCash, hospKey) : null,
          itemizedSection(p, hospKey, charged, quoted),
          guidance(),
        ].filter(Boolean));
        built3 = true;
      }
      const show = step3.hidden;
      step3.hidden = !show;
      reveal.textContent = show ? "Hide the breakdown"
        : (culprit ? "→ Break down your itemized bill" : "Break it down line by line");
      setStep(show ? 3 : 2);
    });

    target.replaceChildren(
      verdictCard(p, h, r, charged, quoted, band, breadthImaging, mult),
      el("div", { class: "chk-reveal-wrap" + (culprit ? " culprit" : "") },
        culprit ? el("p", { class: "chk-reveal-lead" },
          "A charge this far above one code's price usually means extra codes were billed alongside it.") : null,
        reveal),
      step3,
      el("p", { class: "micro dim" },
        "These are estimates from public data, compared for context — not a determination that any " +
        "bill is correct or incorrect, and not medical, legal, or financial advice."),
    );
  }

  // Step-2 gut-check card: charge + magnitude + posted/Medicare comparison + bar.
  function verdictCard(p, h, r, charged, quoted, band, breadthImaging, mult) {
    const compareRef = r.cash != null ? "posted cash price" : (r.gross != null ? "posted list price" : "Medicare rate");
    const medBasis = h.medicare_reference.basis;
    const medLabel = el("span", null, G().term("medicare_reference", "Medicare"),
      medBasis && medBasis !== "unavailable" ? el("span", { class: "dim" }, ` (${medicareShort(medBasis)})`) : "");
    const comp = el("div", { class: "chk-card-compare" }, ...[
      el("div", { class: "chk-card-cmp-row" }, el("span", { class: "dim" }, "Posted cash (self-pay)"), el("span", null, fmtUSD(r.cash))),
      el("div", { class: "chk-card-cmp-row" }, el("span", { class: "dim" }, "Posted list (chargemaster)"), el("span", null, fmtUSD(r.gross))),
      r.costLow != null ? el("div", { class: "chk-card-cmp-row" }, el("span", { class: "dim" }, "Est. cost to deliver"),
        el("span", null, `${fmtUSD(r.costLow)} – ${fmtUSD(r.costHigh)}`)) : null,
      el("div", { class: "chk-card-cmp-row" }, el("span", { class: "dim" }, medLabel), el("span", null, fmtUSD(r.medicare))),
    ].filter(Boolean));

    return el("div", { class: "chk-card band-" + band },
      (quoted > 0 && charged > quoted * 1.1)
        ? el("p", { class: "chk-quoted-line" },
            `You were quoted ${fmtUSD(quoted)} but charged ${fmtUSD(charged)} — a `,
            el("strong", null, fmtUSD(charged - quoted)), " difference.")
        : null,
      el("div", { class: "chk-card-label dim" }, "You were charged"),
      el("div", { class: "chk-card-amount" }, fmtUSD(charged)),
      el("p", { class: "chk-card-verdict" }, "This ", verdictCopy(band, p, breadthImaging)),
      mult != null && mult >= 1.1 ? el("p", { class: "chk-card-mult dim" }, `That's about ${mult.toFixed(1)}× the ${compareRef}.`) : null,
      comp,
      magnitudeBar(r, charged),
      (p.tier === 2 || p.breadth) ? el("p", { class: "micro dim" },
        r.medicare == null
          ? "Medicare publishes no comparable facility rate for this code; compared against posted prices only."
          : `Compared against posted prices and Medicare's ${medicareShort(medBasis)} rate only — no cost-to-deliver estimate.`) : null,
    );
  }

  // Medicare → posted → charge scale, normalized to the largest value (the charge).
  function magnitudeBar(r, charged) {
    const stops = [];
    if (r.medicare != null) stops.push({ v: r.medicare, cls: "mb-medicare", label: "Medicare" });
    const posted = r.cash != null ? r.cash : r.gross;
    if (posted != null) stops.push({ v: posted, cls: "mb-posted", label: "posted" });
    stops.push({ v: charged, cls: "mb-charge", label: "your charge" });
    const max = Math.max(...stops.map((s) => s.v)) || 1;
    return el("div", { class: "chk-bar" },
      el("div", { class: "chk-bar-track" }, ...stops.map((s) =>
        el("span", { class: "chk-bar-mark " + s.cls, style: `left:${Math.min(100, Math.round(100 * s.v / max))}%`,
          title: `${s.label}: ${fmtUSD(s.v)}` }))),
      el("div", { class: "chk-bar-legend dim micro" }, "Medicare → posted → your charge"));
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
        "Enter each line from your bill — its description (or a code, if it has one) and the charge. Real bills " +
        "often list a department name, not a code: type what you see and pick the match, or keep it as written. " +
        "We price each against this hospital's posted prices, insurer-negotiated rates, and Medicare. Codes other " +
        "than the one you expected are flagged as likely add-ons."),
      itemizedChecker(p, hospKey, charged, quoted),
    );
  }

  // The interactive line checker. State is a local array of {cpt, charge}; it
  // never leaves the browser. Pre-seeded with one row = the base CPT.
  function itemizedChecker(p, hospKey, charged, quoted) {
    const doc = window.STB.doc;
    // A line is {text, cpt, label, charge}: text = what's on the bill (kept for
    // un-coded lines), cpt/label = the code the user matched it to (null = raw
    // text), charge = the dollar amount. Seeded with the expected procedure,
    // pre-matched to its code.
    const emptyLine = () => ({ text: "", cpt: null, label: null, charge: "" });
    const lines = [{ text: p.label, cpt: p.cpt, label: p.label, charge: "" }];

    const rowsWrap = el("div", { class: "itemized" });
    const resultsWrap = el("div", { class: "iresults" });

    // Search the 12,369-code index (reusing the breadth matcher); fall back to the
    // curated catalog when breadth isn't loaded. Returns [{cpt, name, needs_curation}].
    function lineMatches(q) {
      const B = window.STBBreadth;
      if (B && B.searchReady()) {
        return B.match(q).map((m) => ({ cpt: m.cpt, name: m.name, needs_curation: m.needs_curation }));
      }
      const ql = q.toLowerCase();
      return Object.values(doc.procedures)
        .filter((pp) => pp.cpt.indexOf(q) >= 0 || pp.label.toLowerCase().indexOf(ql) >= 0)
        .slice(0, 10).map((pp) => ({ cpt: pp.cpt, name: pp.label, needs_curation: false }));
    }

    // One dropdown row. mousedown (not click) fires before the input's blur, so a
    // pick lands before the dropdown auto-closes.
    function rowResult(label, tag, onPick, extraCls) {
      const li = el("li", { class: "picker-result" + (extraCls ? " " + extraCls : "") },
        el("span", { class: "picker-result-label" }, label),
        el("span", { class: "picker-result-tag dim micro" }, tag));
      li.addEventListener("mousedown", (e) => { e.preventDefault(); onPick(); });
      return li;
    }

    // One editable row: a free-text description/code search-select + a charge.
    // Typing searches the index; picking attaches a CPT (so we can price it), or
    // "use as written" keeps the raw bill text as an un-coded line.
    function buildRow(ln, i) {
      const descInput = el("input", { class: "idesc", type: "text", autocomplete: "off",
        placeholder: "Description or code — e.g. ultrasound, 76830",
        value: ln.cpt ? (ln.label || ln.cpt) : (ln.text || "") });
      const dropdown = el("ul", { class: "picker-results iline-results", hidden: "" });
      const chargeInput = el("input", { class: "icharge", type: "number", min: "0", step: "0.01",
        placeholder: "charge ($)", value: ln.charge || "" });
      const rm = el("button", { type: "button", class: "irm", title: "Remove line" }, "×");

      function closeDropdown() { dropdown.hidden = true; dropdown.replaceChildren(); }
      function resolveMatch(cpt, name) {
        ln.cpt = cpt; ln.label = name; ln.text = name;
        descInput.value = name; closeDropdown(); renderResults();
      }
      function keepAsWritten() {
        ln.cpt = null; ln.label = null; ln.text = descInput.value.trim();
        closeDropdown(); renderResults();
      }
      function renderDropdown() {
        const q = descInput.value.trim();
        if (!q) { closeDropdown(); return; }
        const items = lineMatches(q).map((m) =>
          rowResult(`${m.name} (CPT ${m.cpt})`, m.needs_curation ? "as the hospital describes it" : "",
            () => resolveMatch(m.cpt, m.name)));
        items.push(rowResult(`Use “${q}” as written`, "no code match", keepAsWritten, "iline-keep"));
        dropdown.replaceChildren(...items);
        dropdown.hidden = false;
      }

      descInput.addEventListener("input", () => {
        ln.text = descInput.value; ln.cpt = null; ln.label = null;   // editing invalidates a prior match
        const B = window.STBBreadth;
        if (B && !B.searchReady()) B.ensureSearch().then(() => { if (!dropdown.hidden) renderDropdown(); }, () => {});
        renderDropdown(); renderResults();
      });
      descInput.addEventListener("focus", () => {
        const B = window.STBBreadth;
        if (B && !B.searchReady()) B.ensureSearch().then(() => { if (document.activeElement === descInput) renderDropdown(); }, () => {});
        if (descInput.value.trim() && !ln.cpt) renderDropdown();
      });
      descInput.addEventListener("blur", () => { setTimeout(closeDropdown, 150); });
      chargeInput.addEventListener("input", () => { ln.charge = chargeInput.value; renderResults(); });
      rm.addEventListener("click", () => {
        lines.splice(i, 1);
        if (lines.length === 0) lines.push(emptyLine());
        renderRows(); renderResults();
      });

      return el("div", { class: "iline" },
        el("div", { class: "idesc-wrap" }, descInput, dropdown),
        chargeInput, rm);
    }

    function renderRows() { rowsWrap.replaceChildren(...lines.map((ln, i) => buildRow(ln, i))); }

    // Price one line against the selected hospital. Honest fallbacks: raw text →
    // no code, ask the hospital to identify it; unknown code → no benchmark; known
    // code with no price here → say so. Never invents a number.
    function priceLine(ln, isBase) {
      const cpt = ln.cpt;
      const charge = ln.charge;
      const verdict = el("div", { class: "iline-verdict" });
      const cls = ["iline-result"];
      if (!isBase) cls.push("addon");

      if (!cpt) {
        const txt = (ln.text || "").trim();
        verdict.appendChild(el("span", { class: "dim" }, txt
          ? "Not matched to a billing code — we can't benchmark it, but it's worth asking the hospital to identify and explain this charge."
          : "Type the line's description (or a code), then the charge."));
        return el("div", { class: cls.join(" ") }, lineHead(ln, isBase, null), verdict);
      }
      const res = resolveProc(cpt, renderResults);
      if (res.status === "loading") {
        verdict.appendChild(el("span", { class: "dim" }, `Looking up CPT ${cpt}…`));
        return el("div", { class: cls.join(" ") }, lineHead(ln, isBase, null), verdict);
      }
      if (res.status !== "ok") {
        verdict.appendChild(el("span", { class: "dim" },
          "We don't have a benchmark for this code (it's not in our dataset) — still worth questioning on your itemized bill."));
        return el("div", { class: cls.join(" ") }, lineHead(ln, isBase, null), verdict);
      }
      const proc = res.p;
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
        return el("div", { class: cls.join(" ") }, lineHead(ln, isBase, null, proc.label), verdict);
      }
      const h = proc.hospitals.find((x) => x.key === hospKey);
      if (!h || (h.gross_charge == null && h.cash_price == null)) {
        verdict.appendChild(el("span", { class: "dim" },
          `In our catalog as ${proc.label}, but this hospital posts no price for it.`));
        const ref = h ? { gross: h.gross_charge, cash: h.cash_price, medicare: h.medicare_reference.amount,
          basis: h.medicare_reference.basis, negotiated: h.negotiated } : null;
        return el("div", { class: cls.join(" ") }, lineHead(ln, isBase, ref, proc.label), verdict);
      }
      const tier2 = proc.tier === 2;
      const r = refs(h, tier2);
      const ref = { gross: r.gross, cash: r.cash, medicare: r.medicare, basis: h.medicare_reference.basis, negotiated: h.negotiated };
      const amt = parseFloat(charge);
      if (amt > 0) {
        const band = classify(amt, r);
        verdict.appendChild(el("span", { class: "iline-band " + band }, lineBandCopy(band, r)));
      } else {
        verdict.appendChild(el("span", { class: "dim" }, "Enter the charge to compare."));
      }
      return el("div", { class: cls.join(" ") }, lineHead(ln, isBase, ref, proc.label), verdict);
    }

    function renderResults() {
      const priced = [];
      let sum = 0;
      lines.forEach((ln, i) => {
        const amt = parseFloat(ln.charge);
        if (amt > 0) sum += amt;
        priced.push(priceLine(ln, i === 0 && ln.cpt === p.cpt));
      });

      // Base-code posted price at this hospital (for the takeaway math).
      const baseH = p.hospitals.find((x) => x.key === hospKey);
      const baseR = (baseH) ? refs(baseH, p.tier === 2) : null;
      const basePosted = baseR ? basePostedPrice(baseR) : null;
      // Non-base lines carrying a charge — coded add-ons OR un-coded bill lines —
      // together make up the gap above the expected procedure's posted price.
      const otherCount = lines.filter((ln, i) => !(i === 0 && ln.cpt === p.cpt) && parseFloat(ln.charge) > 0).length;

      const takeaway = el("div", { class: "itotal" });
      if (sum > 0) {
        const bits = [
          "Your entered charges total ", el("strong", null, fmtUSD(sum)), ". ",
        ];
        if (basePosted != null) {
          bits.push(`The procedure you expected (${p.label}) posts at `, el("strong", null, fmtUSD(basePosted)), " here");
          if (otherCount > 0 && sum > basePosted) {
            bits.push("; the rest is ", el("strong", null, fmtUSD(sum - basePosted)),
              ` across ${otherCount} other line${otherCount === 1 ? "" : "s"} — the add-ons that explain the gap.`);
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
    addBtn.addEventListener("click", () => { lines.push(emptyLine()); renderRows(); renderResults(); });

    // Layer-3 quick-add: one-click "likely add-on" lines for this procedure.
    // Only kind:"addon" codes (billed ALONGSIDE the base); a variant is a
    // substitution, not an extra line, so it isn't offered as a quick-add.
    const likely = (p.addons || []).filter((a) => a.kind === "addon");
    const quickAdd = likely.length ? el("div", { class: "iaddons" },
      el("span", { class: "iaddons-label dim micro" }, `Likely add-ons for ${p.label}:`),
      ...likely.map((a) => {
        const chip = el("button", { type: "button", class: "iaddon-chip" }, `+ ${a.label} (${a.cpt})`);
        chip.addEventListener("click", () => {
          if (!lines.some((ln) => ln.cpt === a.cpt)) lines.push({ text: a.label, cpt: a.cpt, label: a.label, charge: "" });
          renderRows();
          renderResults();
        });
        return chip;
      }),
    ) : null;

    // Resolve each line to the structured shape window.STBLetter.disputeLetterText
    // consumes: the code/description + the sourced posted / insurer-negotiated /
    // Medicare prices for this hospital (null for raw-text or un-priced lines — the
    // letter then asks for an explanation rather than inventing a number).
    function letterLine(ln, isBase) {
      const charge = parseFloat(ln.charge);
      const out = { cpt: ln.cpt || null, text: (ln.text || "").trim() || null, label: ln.label || null,
        charge: Number.isFinite(charge) ? charge : null, isAddon: !isBase,
        postedCash: null, postedGross: null, medicare: null, negotiated: null, inCatalog: false };
      if (!ln.cpt) return out;
      const res = resolveProc(ln.cpt, () => {});
      const proc = res.status === "ok" ? res.p : null;
      if (!proc) return out;
      out.inCatalog = true;
      out.label = proc.label;
      const hh = hospKey !== "__other__" ? proc.hospitals.find((x) => x.key === hospKey) : null;
      if (hh) {
        out.postedCash = hh.cash_price; out.postedGross = hh.gross_charge;
        out.medicare = hh.medicare_reference.amount; out.negotiated = hh.negotiated || null;
      }
      return out;
    }

    const letterWrap = el("div", { class: "letter-wrap" });
    const genBtn = el("button", { type: "button", class: "letter-gen" }, "Generate a dispute letter");
    genBtn.addEventListener("click", () => {
      const hospitalName = hospKey === "__other__"
        ? "[Hospital name]"
        : ((p.hospitals.find((x) => x.key === hospKey) || {}).name || "[Hospital name]");
      const letterLines = lines
        .filter((ln) => ln.cpt || (ln.text || "").trim())
        .map((ln, i) => letterLine(ln, i === 0 && ln.cpt === p.cpt));
      const text = window.STBLetter.disputeLetterText({ hospitalName, procedureLabel: p.label, baseCpt: p.cpt,
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
        el("span", null, "Description or code"), el("span", null, "Charge ($)"), el("span", null, "")),
      rowsWrap,
      addBtn,
      quickAdd,
      resultsWrap,
      genBtn,
      letterWrap,
    );
  }

  // The dispute-letter text builder lives in web/letter.js (window.STBLetter) —
  // pure and node-tested; checker.js resolves prices (letterLine) and hands it
  // structured line data.

  // One result line's header: the code (or the raw bill text) + the posted /
  // insurer-negotiated / Medicare references we have for it at this hospital (so
  // the per-line judgment is auditable).
  function lineHead(ln, isBase, ref, label) {
    const tag = isBase ? el("span", { class: "iline-tag base" }, "expected") : el("span", { class: "iline-tag addon" }, "possible add-on");
    const refBits = [];
    if (ref) {
      if (ref.cash != null || ref.gross != null) {
        refBits.push(`posted cash ${fmtUSD(ref.cash)} · gross ${fmtUSD(ref.gross)}`);
      }
      if (ref.negotiated && ref.negotiated.median != null) {
        refBits.push(`insurers ${fmtUSD(ref.negotiated.median)}`);
      }
      if (ref.medicare != null) {
        refBits.push(`Medicare ${fmtUSD(ref.medicare)}${ref.basis ? " (" + medicareShort(ref.basis) + ")" : ""}`);
      }
    }
    // Code slot: the CPT when matched, else the raw bill text in quotes.
    const codeText = ln.cpt ? `CPT ${ln.cpt}` : ((ln.text || "").trim() ? `"${ln.text.trim()}"` : "—");
    return el("div", { class: "iline-head" },
      el("span", { class: "iline-code" }, codeText),
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

  const REGION_LABEL = { dfw: "Dallas–Fort Worth, TX", wyoming: "Wyoming", ne_panhandle: "Nebraska Panhandle" };
  function regionLabel(key) { return REGION_LABEL[key] || key; }

  // Dataset size, derived from the data so the copy can never go stale again.
  function datasetScale() {
    const doc = window.STB.doc;
    const keys = new Set();
    Object.values(doc.procedures).forEach((p) => (p.hospitals || []).forEach((h) => keys.add(h.key)));
    return { hospitals: keys.size, regions: (doc.regions || []).length };
  }

  function renderUnlisted(target, p, charged, quoted) {
    setStep(2);
    const scale = datasetScale();
    const breadth = p.breadth === true;
    const regionRows = !breadth ? Object.entries(p.regional || {}).map(([key, r]) =>
      el("div", { class: "detail-row" },
        el("div", { class: "detail-label" }, `${regionLabel(key)} cash range`),
        el("div", { class: "detail-amount" }, `${fmtUSD(r.cash_min)} – ${fmtUSD(r.cash_max)} (median ${fmtUSD(r.cash_median)})`),
        el("div", { class: "detail-source dim micro" }, "Hospital price files"),
      )) : [];
    const medians = !breadth ? Object.values(p.regional || {}).map((r) => r.cash_median).filter((v) => v != null) : [];
    const basePosted = medians.length ? Math.min(...medians) : null;
    const culprit = (basePosted != null && charged > basePosted * 1.25);

    target.replaceChildren(...[
      (quoted > 0 && charged > quoted * 1.1)
        ? el("p", { class: "chk-quoted-line" },
            `You were quoted ${fmtUSD(quoted)} but charged ${fmtUSD(charged)} — a `,
            el("strong", null, fmtUSD(charged - quoted)), " difference.")
        : null,
      el("p", { class: "chk-verdict-line" },
        el("strong", null, fmtUSD(charged)),
        ` — your hospital isn't among the ${scale.hospitals} hospitals we cover, so here is the context we can offer:`),
      ...regionRows,
      breadth
        ? (p.medicare_national_usd != null
            ? el("p", { class: "dim" },
                `We have posted prices for this code from other hospitals in our set, but not yours. ` +
                `Medicare's national rate is ${fmtUSD(p.medicare_national_usd)}.`)
            : el("p", { class: "dim micro" },
                "We have posted prices for this code from other hospitals, but not yours, and Medicare publishes no comparable facility rate for it."))
        : (p.medicare_national_usd != null
            ? el("div", { class: "detail-row" },
                el("div", { class: "detail-label" }, "Medicare national rate (unadjusted)"),
                el("div", { class: "detail-amount" }, fmtUSD(p.medicare_national_usd)),
                el("div", { class: "detail-source dim micro" }, p.tier === 2 ? "CY2026 Medicare " + medicareShort(window.STB.tier2Basis(p)) : "CY2026 OPPS Addendum B"))
            : el("p", { class: "dim micro" }, "Medicare reference unavailable for this code.")),
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
        `Our data covers ${scale.hospitals} hospitals across ${scale.regions} regions. Prices elsewhere vary, but the same public files exist for every US hospital — that's the point.`),
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
