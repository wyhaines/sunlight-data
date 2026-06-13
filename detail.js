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

    const cb = h.cost_breakdown;
    const rows = [
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
        `; the chargemaster is ${fmtMult(h.multiples.gross_vs_medicare)}.`
      : "Medicare reference unavailable for this code — multiples not computed.";

    const breakdown = el("div", { class: "detail-breakdown dim" },
      `Bottom-up components: labor ${fmtUSD(cb.technologist_labor)} · contrast ${fmtUSD(cb.contrast_agent)}` +
      ` · capital ${fmtUSD(cb.equipment_capital)} (${cb.capital_basis.replace("_", " ")}) · overhead ${fmtUSD(cb.overhead)}` +
      ` · volume ${h.scans_per_year_used}/yr`,
    );

    const children = [
      el("div", { class: "detail-head" },
        el("h3", null, h.name),
        el("button", { class: "detail-close", type: "button" }, "× close"),
      ),
      el("div", { class: "dim" }, `CPT ${p.cpt} · ${p.label} · CCN ${h.ccn} · ${h.region}`),
      ...rows.map(row),
      breakdown,
      el("p", { class: "takeaway" }, multLine),
    ];
    if (h.medicare_reference.beneficiary_note) {
      children.push(el("p", { class: "warn micro" }, "CAH note: " + h.medicare_reference.beneficiary_note));
    }
    container.replaceChildren(...children);
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
