(function () {
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null) continue;
        if (k === "class") node.className = v;
        else node.setAttribute(k, v);
      }
    }
    for (const child of children) {
      if (child == null) continue;
      if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function fmtUSD(n) {
    if (n == null) return "-";
    return "$" + Math.round(n).toLocaleString();
  }

  function fmtMult(m) {
    if (m == null) return "-";
    return m.toFixed(1) + "×";
  }

  fetch("data.json")
    .then((r) => {
      if (!r.ok) throw new Error("data.json fetch failed: " + r.status);
      return r.json();
    })
    .then(render)
    .catch((err) => {
      document.getElementById("headline-text").textContent = "Failed to load data: " + err.message;
      console.error(err);
    });

  function render(doc) {
    renderHeadline(doc);
    renderLegend();
    renderChart(doc);
    renderCallouts(doc);
    renderSameSystem(doc);
  }

  function renderHeadline(doc) {
    const hospitals = doc.hospitals.filter((h) => h.gross_charge != null);
    const minG = d3.min(hospitals, (h) => h.gross_charge);
    const maxG = d3.max(hospitals, (h) => h.gross_charge);
    const minE = d3.min(hospitals, (h) => h.estimated_cost.bottom_up);
    const maxE = d3.max(hospitals, (h) => h.estimated_cost.bottom_up);
    const h2 = document.getElementById("headline-text");
    h2.replaceChildren(
      document.createTextNode("The same brain MRI is charged "),
      el("strong", null, `${fmtUSD(minG)} to ${fmtUSD(maxG)}`),
      document.createTextNode(` across ${hospitals.length} hospitals in Texas and Wyoming. We estimate it costs them about `),
      el("strong", null, `${fmtUSD(minE)} to ${fmtUSD(maxE)}`),
      document.createTextNode(" to perform."),
    );
  }

  function renderLegend() {
    function swatch(color, border) {
      return el("span", {
        class: "legend-swatch",
        style: `background:${color}${border ? "; border:" + border : ""}`,
      });
    }
    function legendItem(marker, label) {
      return el("span", { class: "legend-item" }, marker, " ", label);
    }
    const items = [
      legendItem(swatch("var(--c-labor)"), "Tech labor"),
      legendItem(swatch("var(--c-contrast)"), "Contrast agent"),
      legendItem(swatch("var(--c-capital)"), "Capital (scanner + facility)"),
      legendItem(swatch("var(--c-overhead)"), "Overhead"),
      legendItem(swatch("var(--c-margin)", "1px solid var(--c-margin-hatch)"), "Margin (charge − cost)"),
      legendItem(el("span", { class: "legend-dashed" }), "CCR × gross cross-check"),
      legendItem(el("span", { class: "legend-circle" }), "Cash price (above bar)"),
      legendItem(el("span", { class: "legend-triangle" }), "Medicare reference (above bar)"),
    ];
    document.getElementById("legend").replaceChildren(...items);
  }

  function renderChart(doc) {
    const svg = d3.select("#chart");
    svg.selectAll("*").remove();
    const viewW = 940;
    const margins = { top: 16, right: 25, bottom: 50, left: 310, rowGap: 4 };
    const ROW_H = 48;
    const BAR_H = 14;

    const regions = doc.regions.map((r) => ({
      ...r,
      hospitals: doc.hospitals
        .filter((h) => h.region === r.key)
        .sort((a, b) => (b.gross_charge || 0) - (a.gross_charge || 0)),
    }));

    const maxGross = d3.max(doc.hospitals, (h) => h.gross_charge) || 7000;
    const xMax = Math.ceil((maxGross * 1.1) / 1000) * 1000;
    const xScale = d3.scaleLinear().domain([0, xMax]).range([margins.left, viewW - margins.right]);

    let y = margins.top;
    const layout = [];
    regions.forEach((region) => {
      const headerY = y + 14;
      y += 22;
      const rows = region.hospitals.map((h) => {
        const rowStart = y;
        y += ROW_H + margins.rowGap;
        return { h, rowStart };
      });
      layout.push({ region, headerY, rows });
      y += 12;
    });
    const axisY = y + 12;
    const viewH = axisY + 36;
    svg.attr("viewBox", `0 0 ${viewW} ${viewH}`);

    const gridStep = 1000;
    const grid = svg.append("g");
    for (let g = gridStep; g <= xMax; g += gridStep) {
      grid.append("line").attr("class", "grid-line")
        .attr("x1", xScale(g)).attr("x2", xScale(g))
        .attr("y1", margins.top).attr("y2", axisY);
    }

    const defs = svg.append("defs");
    const pat = defs.append("pattern")
      .attr("id", "margin-hatch")
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", 6).attr("height", 6)
      .attr("patternTransform", "rotate(45)");
    pat.append("rect").attr("width", 6).attr("height", 6).attr("fill", "var(--c-margin)");
    pat.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6)
      .attr("stroke", "var(--c-margin-hatch)").attr("stroke-width", 1);

    let tooltip = document.querySelector(".tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "tooltip";
      document.body.appendChild(tooltip);
    }

    layout.forEach(({ region, headerY, rows }) => {
      svg.append("text")
        .attr("class", "region-label")
        .attr("x", margins.left)
        .attr("y", headerY)
        .text(region.label.toUpperCase());
      rows.forEach(({ h, rowStart }) => renderRow(svg, h, rowStart, xScale, viewW, BAR_H, tooltip));
    });

    const axis = svg.append("g").attr("transform", `translate(0, ${axisY})`);
    axis.append("line")
      .attr("x1", margins.left).attr("x2", viewW - margins.right)
      .attr("stroke", "#888");
    for (let g = 0; g <= xMax; g += gridStep) {
      const x = xScale(g);
      axis.append("line").attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", 5).attr("stroke", "#888");
      axis.append("text").attr("x", x).attr("y", 18).attr("text-anchor", "middle")
        .attr("font-size", 10).attr("fill", "#666").text("$" + g.toLocaleString());
    }
    svg.append("text")
      .attr("x", viewW / 2).attr("y", viewH - 8).attr("text-anchor", "middle")
      .attr("font-size", 11).attr("fill", "#666").attr("font-style", "italic")
      .text("Chargemaster price (USD): bar end · Cost + margin = chargemaster · Markers above bar are reference values");
  }

  function renderRow(svg, h, rowStart, xScale, viewW, BAR_H, tooltip) {
    const barTop = rowStart + 16;
    const barBottom = barTop + BAR_H;
    const x0 = xScale(0);

    if (h.is_critical_access) {
      svg.append("rect").attr("class", "cah-band")
        .attr("x", 0).attr("y", rowStart).attr("width", viewW).attr("height", 48);
    }

    const stack = [
      { key: "technologist_labor", color: "var(--c-labor)" },
      { key: "contrast_agent", color: "var(--c-contrast)" },
      { key: "equipment_capital", color: "var(--c-capital)" },
      { key: "overhead", color: "var(--c-overhead)" },
    ];
    let runningX = x0;
    stack.forEach(({ key, color }) => {
      const v = h.cost_breakdown[key] || 0;
      const w = xScale(v) - x0;
      svg.append("rect")
        .attr("x", runningX).attr("y", barTop)
        .attr("width", w).attr("height", BAR_H).attr("fill", color);
      runningX += w;
    });

    const gross = h.gross_charge || 0;
    const grossX = xScale(gross);
    if (grossX > runningX) {
      svg.append("rect")
        .attr("x", runningX).attr("y", barTop)
        .attr("width", grossX - runningX).attr("height", BAR_H)
        .attr("fill", "url(#margin-hatch)")
        .attr("stroke", "var(--c-margin-hatch)").attr("stroke-width", 0.5);
    }

    if (h.estimated_cost.ccr_check != null) {
      const ccrX = xScale(h.estimated_cost.ccr_check);
      svg.append("line")
        .attr("x1", ccrX).attr("x2", ccrX)
        .attr("y1", barTop - 2).attr("y2", barBottom + 2)
        .attr("stroke", "var(--c-ccr)").attr("stroke-width", 1.2)
        .attr("stroke-dasharray", "3 2");
    }

    const medX = xScale(h.medicare_reference.amount);
    svg.append("polygon")
      .attr("points", `${medX},${barTop - 2} ${medX - 5},${barTop - 12} ${medX + 5},${barTop - 12}`)
      .attr("fill", "var(--c-medicare)");
    if (h.is_critical_access) {
      svg.append("text").attr("class", "cah-label-medicare")
        .attr("x", medX + 9).attr("y", barTop - 4).text("Medicare (cost-based)");
    }

    if (h.cash_price != null) {
      const cashX = xScale(h.cash_price);
      svg.append("circle")
        .attr("cx", cashX).attr("cy", barTop - 7).attr("r", 3.8)
        .attr("fill", "var(--c-cash)").attr("stroke", "#fff").attr("stroke-width", 1.2);
      svg.append("line")
        .attr("x1", cashX).attr("x2", cashX)
        .attr("y1", barTop - 3).attr("y2", barTop)
        .attr("stroke", "var(--c-cash)").attr("stroke-width", 1.2);
    }

    const labelRightX = x0 - 5;
    const { main, paren } = splitName(h.name);
    svg.append("text").attr("class", "hospital-name")
      .attr("x", labelRightX).attr("y", barTop + 5)
      .attr("text-anchor", "end")
      .attr("font-weight", h.is_critical_access ? 600 : 400)
      .text(main);
    const tagParts = [];
    if (paren) tagParts.push("(" + paren + ")");
    const ownership = ownershipTag(h);
    if (ownership) tagParts.push(ownership);
    svg.append("text").attr("class", "hospital-tag")
      .attr("x", labelRightX).attr("y", barTop + 16)
      .attr("text-anchor", "end")
      .text(tagParts.join(" · "));

    if (gross > 0) {
      svg.append("text").attr("class", "gross-label")
        .attr("x", grossX + 6).attr("y", barTop + 11)
        .text("$" + Math.round(gross).toLocaleString());
    }

    svg.append("rect")
      .attr("x", 0).attr("y", rowStart).attr("width", viewW).attr("height", 48)
      .attr("fill", "transparent").style("cursor", "pointer")
      .on("mouseenter", function (ev) { showTooltip(tooltip, ev, h); })
      .on("mousemove", function (ev) { moveTooltip(tooltip, ev); })
      .on("mouseleave", function () { hideTooltip(tooltip); });
  }

  function ownershipTag(h) {
    const parts = [];
    if (h.ownership) parts.push(h.ownership.replace(/_/g, " "));
    if (h.is_critical_access) parts.push("CAH");
    if (h.has_mobile_mri) parts.push("mobile MRI");
    return parts.join(" · ");
  }

  function splitName(name) {
    const m = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (m) return { main: m[1].trim(), paren: m[2].trim() };
    return { main: name, paren: null };
  }

  function showTooltip(tip, ev, h) {
    const cb = h.cost_breakdown;
    const fmt = fmtUSD;
    const children = [
      el("div", null, el("strong", null, h.name)),
      el("div", { class: "dim", style: "margin-bottom:6px" }, `${h.region} · CCN ${h.ccn || "-"}`),
      el("div", null, `Gross: ${fmt(h.gross_charge)} · Cash: ${fmt(h.cash_price)}`),
      el("div", null, `Negotiated: ${fmt(h.negotiated.min)} – ${fmt(h.negotiated.max)} (median ${fmt(h.negotiated.median)})`),
      el("hr"),
      el("div", null, "Est. cost (bottom-up): ", el("strong", null, fmt(h.estimated_cost.bottom_up))),
      el("div", { class: "dim micro" },
        `labor ${fmt(cb.technologist_labor)} · contrast ${fmt(cb.contrast_agent)} · capital ${fmt(cb.equipment_capital)} (${cb.capital_basis.replace("_", " ")}) · overhead ${fmt(cb.overhead)}`),
      el("div", null, `CCR×gross: ${fmt(h.estimated_cost.ccr_check)}` + (h.ccr.value != null ? ` (CCR ${h.ccr.value.toFixed(3)} FY${h.ccr.fy})` : "")),
      el("div", null, "Medicare: ", el("strong", null, fmt(h.medicare_reference.amount)), ` (${h.medicare_reference.basis.replace("_", " ")})`),
    ];
    if (h.medicare_reference.beneficiary_note) {
      children.push(el("div", { class: "warn micro" }, h.medicare_reference.beneficiary_note));
    }
    tip.replaceChildren(...children);
    tip.classList.add("visible");
    moveTooltip(tip, ev);
  }

  function moveTooltip(tip, ev) {
    const offset = 14;
    tip.style.left = ev.pageX + offset + "px";
    tip.style.top = ev.pageY + offset + "px";
  }

  function hideTooltip(tip) {
    tip.classList.remove("visible");
  }

  function renderCallouts(doc) {
    const byRegion = d3.group(doc.hospitals.filter((h) => h.gross_charge != null), (h) => h.region);
    const spreads = doc.regions.map((r) => {
      const list = byRegion.get(r.key) || [];
      const min = d3.min(list, (h) => h.gross_charge);
      const max = d3.max(list, (h) => h.gross_charge);
      return { region: r.label, mult: min && max ? max / min : null };
    });
    const all = doc.hospitals.filter((h) => h.gross_charge != null);
    const crossMin = d3.min(all, (h) => h.gross_charge);
    const crossMax = d3.max(all, (h) => h.gross_charge);
    const crossMult = crossMin && crossMax ? crossMax / crossMin : null;

    function callout(stat, label) {
      return el("div", { class: "callout" },
        el("div", { class: "stat" }, stat),
        el("div", { class: "stat-label" }, label),
      );
    }

    document.getElementById("callouts").replaceChildren(
      ...spreads.map((s) => callout(fmtMult(s.mult), s.region + " intra-region price spread")),
      callout(fmtMult(crossMult), "Cross-region (lowest to highest)"),
    );
  }

  function renderSameSystem(doc) {
    const container = document.getElementById("same-system");
    const torrington = doc.hospitals.find((h) => h.key === "banner_torrington");
    const casper = doc.hospitals.find((h) => h.key === "banner_casper");
    if (!torrington || !casper) {
      container.replaceChildren();
      return;
    }
    function side(title, t) {
      return el("div", null,
        el("div", null, el("strong", null, title)),
        el("div", { class: "detail" },
          `Charges ${fmtUSD(t.charges)} · cash ${fmtUSD(t.cash)} · est. cost ${fmtUSD(t.cost)} · ${t.medLabel} ${fmtUSD(t.med)}`,
        ),
      );
    }
    container.replaceChildren(
      el("h4", null, "Same operator, same chargemaster, but the rural patient pays more cash"),
      el("div", { class: "pair" },
        side("Torrington · 25-bed CAH · mobile MRI", {
          charges: torrington.gross_charge,
          cash: torrington.cash_price,
          cost: torrington.estimated_cost.bottom_up,
          medLabel: "Medicare (cost-based) ≈",
          med: torrington.medicare_reference.amount,
        }),
        side("Casper · 249-bed flagship", {
          charges: casper.gross_charge,
          cash: casper.cash_price,
          cost: casper.estimated_cost.bottom_up,
          medLabel: "Medicare (OPPS)",
          med: casper.medicare_reference.amount,
        }),
      ),
      el("p", { class: "takeaway" },
        "Banner's chargemaster price is essentially the same at both facilities. But the rural CAH costs more than 2× as much to deliver per scan, and its cash price runs ~60% higher than the urban flagship's, the opposite of what the cost difference would suggest.",
      ),
    );
  }

  window.__sunlight = { el, fmtUSD, fmtMult };
})();
