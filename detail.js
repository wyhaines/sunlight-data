(function () {
  const { el, fmtUSD, fmtMult, medicareShort } = window.STB;

  function render(state) {
    const container = document.getElementById("detail");
    if (!container) return;
    if (!state || state.mode === "bill" || !state.cpt || !state.hospital || !window.STB.doc) {
      container.replaceChildren();
      return;
    }
    const p = window.STB.doc.procedures[state.cpt];
    const h = p && p.hospitals.find((x) => x.key === state.hospital);
    if (!h) {
      container.replaceChildren();
      return;
    }

    const tier2 = p.tier === 2;
    const breadthImaging = p.tier === 1 && h.cost_breakdown == null;   // priced + CCR + Medicare, no bottom-up
    const medRef = h.medicare_reference;
    const medUnavail = medRef.amount == null || medRef.basis === "unavailable";

    const priceRows = [
      ["Chargemaster (gross)", h.gross_charge, h.provenance.prices],
      ["Cash price", h.cash_price, h.provenance.prices],
      ["Negotiated (min / median / max)",
        null, h.provenance.prices,
        `${fmtUSD(h.negotiated.min)} / ${fmtUSD(h.negotiated.median)} / ${fmtUSD(h.negotiated.max)}`],
    ];
    const medRow = tier2
      ? [medUnavail ? "Medicare reference" : `Medicare reference (${medicareShort(medRef.basis)})`,
         medRef.amount, h.provenance.medicare, medUnavail ? "no published reference" : null]
      : ["Medicare reference", h.medicare_reference.amount, h.provenance.medicare];

    let rows;
    if (tier2) {
      rows = [...priceRows, medRow];
    } else if (breadthImaging) {
      rows = [...priceRows];
      if (h.estimated_cost && h.estimated_cost.ccr_check != null) {
        rows.push(["Estimated cost — CCR × gross", h.estimated_cost.ccr_check, h.provenance.ccr]);
      }
      rows.push(medRow);
    } else {
      rows = [
        ...priceRows,
        ["Estimated cost — bottom-up", h.estimated_cost.bottom_up, h.provenance.bottom_up],
        ["Estimated cost — CCR × gross", h.estimated_cost.ccr_check, h.provenance.ccr],
        medRow,
      ];
    }

    function row([label, amount, source, custom]) {
      return el("div", { class: "detail-row" },
        el("div", { class: "detail-label" }, label),
        el("div", { class: "detail-amount" }, custom != null ? custom : fmtUSD(amount)),
        el("div", { class: "detail-source dim micro" }, source),
      );
    }

    const multLine = h.multiples.cash_vs_medicare != null
      ? `This hospital's cash price is ${fmtMult(h.multiples.cash_vs_medicare)} its Medicare reference` +
        ` (${medicareShort(h.multiples.medicare_basis)})` +
        `; the chargemaster is ${fmtMult(h.multiples.gross_vs_medicare)}.`
      : "Medicare reference unavailable for this code — multiples not computed.";

    // Chargemaster-range note (both tiers): when a hospital posts the same code
    // at multiple internal line items, surface the gross spread. Genuine
    // transparency — the headline gross above is the median across those items.
    const ps = h.posted_spread;
    let spreadLine = null;
    if (ps && ps.n_items > 1) {
      const txt = ps.gross_max > ps.gross_min
        ? `Chargemaster range: ${fmtUSD(ps.gross_min)}–${fmtUSD(ps.gross_max)} across ${ps.n_items} internal items (the gross above is the median).`
        : `Posted on ${ps.n_items} internal line items, all at ${fmtUSD(ps.gross_min)}.`;
      spreadLine = el("div", { class: "detail-breakdown dim" }, txt);
    }

    let breakdown;
    if (tier2) {
      breakdown = el("div", { class: "detail-breakdown dim" },
        "Posted prices only — Tier 2. No bottom-up cost build or CCR cross-check; " +
        "the comparison is the hospital's posted price against Medicare's published rate.");
    } else if (breadthImaging) {
      breakdown = el("div", { class: "detail-breakdown dim" },
        "No per-site bottom-up cost model — scan volume is not publicly reported for this hospital. " +
        "We show the posted price against two independent public-data references: this hospital's " +
        "radiology cost-to-charge ratio (CCR × gross) and Medicare's technical rate." +
        (h.is_critical_access ? " As a Critical Access Hospital it is actually reimbursed ~101% of cost, so the OPPS figure is a benchmark, not the literal payment." : ""));
    } else {
      const cb = h.cost_breakdown;
      breakdown = el("div", { class: "detail-breakdown dim" },
        `Bottom-up components: labor ${fmtUSD(cb.technologist_labor)} · contrast ${fmtUSD(cb.contrast_agent)}` +
        ` · capital ${fmtUSD(cb.equipment_capital)} (${cb.capital_basis.replace("_", " ")}) · overhead ${fmtUSD(cb.overhead)}` +
        ` · volume ${h.scans_per_year_used}/yr`);
    }

    const children = [
      el("div", { class: "detail-head" },
        el("h3", null, h.name),
        el("button", { class: "detail-close", type: "button" }, "× close"),
      ),
      el("div", { class: "dim" }, `CPT ${p.cpt} · ${p.label} · CCN ${h.ccn} · ${h.region}`),
      tier2 ? el("div", { class: "tier2-badge" }, "Posted prices — not a cost estimate") : null,
      ...rows.map(row),
      breakdown,
      spreadLine,
      el("p", { class: "takeaway" }, multLine),
    ];
    if (h.medicare_reference.beneficiary_note) {
      children.push(el("p", { class: "warn micro" }, "CAH note: " + h.medicare_reference.beneficiary_note));
    }
    container.replaceChildren(...children.filter((c) => c != null));
    container.querySelector(".detail-close").addEventListener("click", () => {
      Router.go({ mode: "shop", cpt: state.cpt });
    });
    container.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.addEventListener("stb:route-changed", (e) => render(e.detail));
})();
