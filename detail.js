(function () {
  const { el, fmtUSD, fmtMult } = window.STB;

  function parseHash() {
    const m = location.hash.match(/^#h=([\w-]+)(?:&p=(\d{5}))?$/);
    return m ? { key: m[1], cpt: m[2] || null } : null;
  }

  function render() {
    const container = document.getElementById("detail");
    const target = parseHash();
    if (!target || !window.STB.doc) {
      container.replaceChildren();
      return;
    }
    if (target.cpt) window.STB.setCpt(target.cpt);
    const p = window.STB.proc;
    const h = p.hospitals.find((x) => x.key === target.key);
    if (!h) {
      container.replaceChildren(el("p", { class: "dim" }, "Unknown hospital in link."));
      return;
    }

    const tier2 = p.tier === 2;

    const rows = tier2
      ? [
          ["Chargemaster (gross)", h.gross_charge, h.provenance.prices],
          ["Cash price", h.cash_price, h.provenance.prices],
          ["Negotiated (min / median / max)",
            null, h.provenance.prices,
            `${fmtUSD(h.negotiated.min)} / ${fmtUSD(h.negotiated.median)} / ${fmtUSD(h.negotiated.max)}`],
          ["Medicare reference (CLFS national)", h.medicare_reference.amount, h.provenance.medicare],
        ]
      : [
          ["Chargemaster (gross)", h.gross_charge, h.provenance.prices],
          ["Cash price", h.cash_price, h.provenance.prices],
          ["Negotiated (min / median / max)",
            null, h.provenance.prices,
            `${fmtUSD(h.negotiated.min)} / ${fmtUSD(h.negotiated.median)} / ${fmtUSD(h.negotiated.max)}`],
          ["Estimated cost — bottom-up", h.estimated_cost.bottom_up, h.provenance.bottom_up],
          ["Estimated cost — CCR × gross", h.estimated_cost.ccr_check, h.provenance.ccr],
          ["Medicare reference", h.medicare_reference.amount, h.provenance.medicare],
        ];

    function row([label, amount, source, custom]) {
      return el("div", { class: "detail-row" },
        el("div", { class: "detail-label" }, label),
        el("div", { class: "detail-amount" }, custom != null ? custom : fmtUSD(amount)),
        el("div", { class: "detail-source dim micro" }, source),
      );
    }

    const multLine = h.multiples.cash_vs_medicare != null
      ? `This hospital's cash price is ${fmtMult(h.multiples.cash_vs_medicare)} its Medicare reference` +
        (h.multiples.medicare_basis === "cost_based" ? " (CAH: cost-based reference, not OPPS)" : "") +
        (h.multiples.medicare_basis === "clfs" ? " (CLFS national rate)" : "") +
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

    const breakdown = tier2
      ? el("div", { class: "detail-breakdown dim" },
          "Posted prices only — Tier 2. No bottom-up cost build or CCR cross-check for lab codes; " +
          "the comparison is the hospital's posted price against Medicare's published CLFS rate.")
      : (function () {
          const cb = h.cost_breakdown;
          return el("div", { class: "detail-breakdown dim" },
            `Bottom-up components: labor ${fmtUSD(cb.technologist_labor)} · contrast ${fmtUSD(cb.contrast_agent)}` +
            ` · capital ${fmtUSD(cb.equipment_capital)} (${cb.capital_basis.replace("_", " ")}) · overhead ${fmtUSD(cb.overhead)}` +
            ` · volume ${h.scans_per_year_used}/yr`);
        })();

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
      history.pushState(null, "", location.pathname + location.search);
      render();
    });
    container.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  window.addEventListener("hashchange", render);
  document.addEventListener("stb:procedure-changed", render);
  window.STB.onReady.push(render);
})();
