(function () {
  const { el, fmtUSD } = window.STB;

  function build() {
    const container = document.getElementById("checker");
    if (!window.STB.doc) return;
    const doc = window.STB.doc;

    const procSelect = el("select", { id: "chk-proc" },
      ...Object.values(doc.procedures).sort((a, b) => a.cpt.localeCompare(b.cpt))
        .map((p) => el("option", { value: p.cpt }, `${p.label} (CPT ${p.cpt})`)));
    procSelect.value = window.STB.cpt;

    const hospSelect = el("select", { id: "chk-hosp" });
    function fillHospitals() {
      const p = doc.procedures[procSelect.value];
      hospSelect.replaceChildren(
        ...p.hospitals.map((h) => el("option", { value: h.key }, h.name)),
        el("option", { value: "__other__" }, "My hospital isn't listed"),
      );
    }
    fillHospitals();
    procSelect.addEventListener("change", fillHospitals);

    const amountInput = el("input", { id: "chk-amount", type: "number", min: "0", step: "0.01", placeholder: "e.g. 2400" });
    const goBtn = el("button", { type: "button", class: "chk-go" }, "Check it");
    const verdict = el("div", { id: "chk-verdict" });

    goBtn.addEventListener("click", () => {
      const amount = parseFloat(amountInput.value);
      if (!(amount > 0)) {
        verdict.replaceChildren(el("p", { class: "warn" }, "Enter the dollar amount you were charged."));
        return;
      }
      renderVerdict(verdict, doc.procedures[procSelect.value], hospSelect.value, amount);
      // Gate-1 usage signal: count that A verdict was rendered — no amount, no
      // hospital, no PII; just the event (spec §5). No-op until GoatCounter exists.
      if (window.goatcounter && window.goatcounter.count) {
        window.goatcounter.count({ path: "checker-verdict", title: "Bill checker used", event: true });
      }
    });

    container.replaceChildren(
      el("h3", null, "Check a bill you received"),
      el("p", { class: "dim" },
        "Compare what you were charged against the hospital's own published prices and what Medicare pays. " +
        "For imaging (Tier 1) we also show the cost-report-implied cost; lab codes (Tier 2) show posted prices vs. Medicare only."),
      el("div", { class: "chk-form" },
        el("label", null, "Procedure ", procSelect),
        el("label", null, "Hospital ", hospSelect),
        el("label", null, "Amount charged ($) ", amountInput),
        goBtn,
      ),
      el("p", { class: "micro dim" },
        "Everything you enter stays in your browser — this site has no server to send it to."),
      verdict,
    );
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
    const noun = p.category === "lab" ? "test" : p.category === "imaging" ? "scan" : "service";
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

  function renderVerdict(target, p, hospKey, amount) {
    if (hospKey === "__other__") {
      renderUnlisted(target, p, amount);
      return;
    }
    const h = p.hospitals.find((x) => x.key === hospKey);
    const tier2 = p.tier === 2;
    const r = refs(h, tier2);
    const band = classify(amount, r);

    const medicareLabel = tier2 ? "Medicare reference (CLFS national)" : "Medicare reference";
    const rows = tier2
      ? [
          ["Posted chargemaster price", r.gross, h.provenance.prices],
          ["Posted cash (self-pay) price", r.cash, h.provenance.prices],
          [medicareLabel, r.medicare, h.provenance.medicare],
        ]
      : [
          ["Posted chargemaster price", r.gross, h.provenance.prices],
          ["Posted cash (self-pay) price", r.cash, h.provenance.prices],
          ["Estimated cost to deliver (two methods)",
            null, h.provenance.bottom_up,
            r.costLow != null ? `${fmtUSD(r.costLow)} – ${fmtUSD(r.costHigh)}` : "-"],
          [medicareLabel, r.medicare, h.provenance.medicare],
        ];

    target.replaceChildren(...[
      el("p", { class: "chk-verdict-line" },
        el("strong", null, fmtUSD(amount)),
        ` ${verdictCopy(band, p)}`),
      tier2 ? el("p", { class: "micro dim" }, "Tier 2: compared against posted prices and Medicare's CLFS national rate only — no cost-to-deliver estimate for lab codes.") : null,
      ...rows.map(([label, val, source, custom]) =>
        el("div", { class: "detail-row" },
          el("div", { class: "detail-label" }, label),
          el("div", { class: "detail-amount" }, custom != null ? custom : fmtUSD(val)),
          el("div", { class: "detail-source dim micro" }, source),
        )),
      guidance(),
      el("p", { class: "micro dim" },
        "These are estimates from public data, compared for context — not a determination that any " +
        "bill is correct or incorrect, and not medical, legal, or financial advice."),
    ].filter((c) => c != null));
  }

  function renderUnlisted(target, p, amount) {
    const regionRows = Object.entries(p.regional).map(([key, r]) =>
      el("div", { class: "detail-row" },
        el("div", { class: "detail-label" }, key === "dfw" ? "Dallas–Fort Worth cash range" : "SE WY / NE Panhandle cash range"),
        el("div", { class: "detail-amount" }, `${fmtUSD(r.cash_min)} – ${fmtUSD(r.cash_max)} (median ${fmtUSD(r.cash_median)})`),
        el("div", { class: "detail-source dim micro" }, "Hospital MRFs, 10 facilities"),
      ));
    target.replaceChildren(
      el("p", { class: "chk-verdict-line" },
        el("strong", null, fmtUSD(amount)),
        " — your hospital isn't in our 10-facility dataset, so here is the context we can offer:"),
      ...regionRows,
      p.medicare_national_usd != null
        ? el("div", { class: "detail-row" },
            el("div", { class: "detail-label" }, "Medicare national rate (unadjusted)"),
            el("div", { class: "detail-amount" }, fmtUSD(p.medicare_national_usd)),
            el("div", { class: "detail-source dim micro" }, p.tier === 2 ? "CY2026 Medicare CLFS national rate" : "CY2026 OPPS Addendum B"))
        : el("p", { class: "dim micro" }, "Medicare reference unavailable for this code."),
      guidance(),
      el("p", { class: "micro dim" },
        "Our data covers 10 hospitals in two regions. Prices elsewhere vary, but the same public files " +
        "exist for every US hospital — that's the point."),
    );
  }

  function guidance() {
    return el("div", { class: "chk-guidance" },
      el("h4", null, "What you can do next"),
      el("ul", null,
        el("li", null, "Ask for an itemized bill — billing errors are common, and you're entitled to one."),
        el("li", null, "Ask for the self-pay or prompt-pay rate; hospitals often discount when asked directly."),
        el("li", null, "Nonprofit hospitals must have financial-assistance (charity care) policies — ask whether you qualify; many patients do without knowing it."),
        el("li", null, "If you were uninsured or self-pay, you may have been entitled to a Good Faith Estimate; bills far above it can be disputed under the No Surprises Act."),
      ),
      el("p", { class: "micro dim" }, "A dispute-letter generator built from this data is coming next."),
    );
  }

  window.STB.onReady.push(build);
})();
