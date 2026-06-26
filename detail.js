(function () {
  const { el, fmtUSD, fmtMult, medicareShort } = window.STB;
  const G = () => window.STBGlossary;

  function render(state) {
    const container = document.getElementById("detail");
    if (!container) return;
    if (!state || state.mode === "bill" || !state.cpt || !state.hospital || !window.STB.doc) {
      container.replaceChildren();
      return;
    }
    let p = window.STB.doc.procedures[state.cpt];
    if (!p && window.STBBreadth) {                       // breadth code: adapt from the already-cached shard
      const shard = window.STBBreadth.cachedShard(state.cpt);
      const hidx = window.STBBreadth.hospitalIndex();
      if (shard && hidx) p = window.STBBreadth.breadthRecord(shard, hidx);
    }
    const h = p && p.hospitals.find((x) => x.key === state.hospital);
    if (!h) {
      container.replaceChildren();
      return;
    }

    const tier2 = p.tier === 2;
    const breadth = p.breadth === true;   // a breadth-index code (no cost model at all)
    const breadthImaging = p.tier === 1 && h.cost_breakdown == null;   // priced + CCR + Medicare, no bottom-up
    const medRef = h.medicare_reference;
    const medUnavail = medRef.amount == null || medRef.basis === "unavailable";

    // ⓘ source text: a plain lead sentence, with the raw provenance appended for auditors.
    function srcText(kind) {
      switch (kind) {
        case "list_price": {
          let t = "From this hospital's publicly posted price file. " + (h.provenance.prices || "");
          const ps = h.posted_spread;
          if (ps && ps.n_items > 1) {
            t += ps.gross_max > ps.gross_min
              ? ` Posted at ${ps.n_items} internal line items (${fmtUSD(ps.gross_min)}–${fmtUSD(ps.gross_max)}); the figure shown is the median.`
              : ` Posted at ${ps.n_items} internal line items, all ${fmtUSD(ps.gross_min)}.`;
          }
          return t;
        }
        case "prices": return "From this hospital's publicly posted price file. " + (h.provenance.prices || "");
        case "ccr": return "From this hospital's Medicare cost report (its radiology cost-to-charge ratio × the list price). " + (h.provenance.ccr || "");
        case "bottom_up": return "Two independent estimates: our build-up from staff time, equipment, and overhead, and this hospital's cost-report ratio × its list price. " + (h.provenance.bottom_up || "") + " " + (h.provenance.ccr || "");
        case "medicare": return "Medicare's published rate for this service. " + (h.provenance.medicare || "");
        default: return "";
      }
    }

    function rowEl(labelNode, amountText, kind) {
      return el("div", { class: "detail-row" },
        el("div", { class: "detail-label" }, labelNode, G().source(srcText(kind))),
        el("div", { class: "detail-amount" }, amountText));
    }

    const rows = [
      rowEl(G().term("chargemaster", "List price"), fmtUSD(h.gross_charge), "list_price"),
      rowEl(G().term("cash_price", "Cash (self-pay) price"), fmtUSD(h.cash_price), "prices"),
      rowEl(G().term("insurer_negotiated", "Insurer-negotiated rates"),
        `${fmtUSD(h.negotiated.min)} – ${fmtUSD(h.negotiated.max)} (mid ${fmtUSD(h.negotiated.median)})`, "prices"),
    ];

    // Estimated cost to deliver: range for full Tier-1, single value for breadth-only, none for Tier-2.
    if (!tier2 && !breadth) {
      const costs = breadthImaging
        ? [h.estimated_cost && h.estimated_cost.ccr_check].filter((v) => v != null)
        : [h.estimated_cost.bottom_up, h.estimated_cost.ccr_check].filter((v) => v != null);
      if (costs.length) {
        const lo = Math.min(...costs), hi = Math.max(...costs);
        const amt = lo === hi ? fmtUSD(lo) : `${fmtUSD(lo)} – ${fmtUSD(hi)}`;
        rows.push(rowEl(G().term("bottom_up", "Estimated cost to deliver"), amt, breadthImaging ? "ccr" : "bottom_up"));
      }
    }

    // Medicare reference (basis termed).
    const medKey = medUnavail ? "medicare_reference" : G().basisTermKey(medRef.basis);
    rows.push(rowEl(
      el("span", null, G().term(medKey, "Medicare reference"), medUnavail ? "" : ` (${medicareShort(medRef.basis)})`),
      medUnavail ? "no published reference" : fmtUSD(medRef.amount), "medicare"));

    // Plain takeaway.
    const takeaway = h.multiples.cash_vs_medicare != null
      ? el("p", { class: "takeaway" },
          `This hospital's cash price is ${fmtMult(h.multiples.cash_vs_medicare)} what Medicare pays`,
          h.multiples.gross_vs_medicare != null ? `; its list price is ${fmtMult(h.multiples.gross_vs_medicare)}.` : ".")
      : el("p", { class: "takeaway dim" }, "Medicare publishes no comparable rate for this code.");

    // A short, plain context note (the component breakdown is gone from the surface; it lives in the ⓘ and the chart).
    let note = null;
    if (breadth) {
      note = el("p", { class: "detail-breakdown dim" },
        "Posted prices and a Medicare benchmark for this code — not one of our worked cost examples, so there's no cost-to-deliver build-up." +
        (h.is_critical_access ? " As a Critical Access Hospital its Medicare figure is a national/locality benchmark, not the literal cost-based payment." : ""));
    } else if (tier2) {
      note = el("p", { class: "detail-breakdown dim" },
        "Posted prices only — no cost-to-deliver estimate for this kind of code.");
    } else if (breadthImaging) {
      note = el("p", { class: "detail-breakdown dim" },
        "No per-site cost build-up here (scan volume isn't publicly reported for this hospital) — the cost figure is its cost-report ratio applied to the list price." +
        (h.is_critical_access ? " As a Critical Access Hospital its Medicare figure is a benchmark, not the literal payment." : ""));
    }

    const children = [
      el("div", { class: "detail-head" },
        el("h3", null, h.name),
        el("button", { class: "detail-close", type: "button" }, "× close"),
      ),
      el("div", { class: "dim micro" }, `${p.label} · `, G().term("cpt", `CPT ${p.cpt}`),
        G().source(`CCN ${h.ccn} · region ${h.region}`)),
      (tier2 || breadth) ? el("div", { class: "tier2-badge" }, "Posted prices — not a cost estimate") : null,
      ...rows,
      note,
      takeaway,
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
