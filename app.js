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

  function medicareLabel(basis) {
    switch (basis) {
      case "clfs": return "Clinical Laboratory Fee Schedule national rate (no wage adjustment, no technical/professional split)";
      case "opps_technical": return "OPPS Addendum B rate, wage-index adjusted (technical/facility component)";
      case "opps_facility": return "OPPS facility clinic-visit rate (billed as HCPCS G0463), wage-index adjusted";
      case "pfs": return "Physician Fee Schedule national amount (therapy code; no wage adjustment)";
      case "pfs_technical": return "Physician Fee Schedule technical component, national (no wage adjustment)";
      case "cost_based": return "Critical-Access cost-based reference (~101% of cost)";
      case "unavailable": return "No published Medicare reference for this code";
      default: return "Medicare reference";
    }
  }

  function medicareShort(basis) {
    switch (basis) {
      case "clfs": return "CLFS national";
      case "opps_technical": return "OPPS";
      case "opps_facility": return "OPPS facility (G0463)";
      case "pfs": return "PFS national";
      case "pfs_technical": return "PFS technical";
      case "cost_based": return "CAH cost-based";
      case "unavailable": return "unavailable";
      default: return "Medicare";
    }
  }

  // Tier-2 basis is uniform per procedure; read it from the first hospital that has one.
  function tier2Basis(p) {
    const h = (p.hospitals || []).find((x) => x.medicare_reference && x.medicare_reference.basis);
    return h ? h.medicare_reference.basis : "unavailable";
  }

  const DEFAULT_CPT = "70553";
  let DOC = null;

  window.STB = {
    el, fmtUSD, fmtMult, medicareLabel, medicareShort, tier2Basis,
    buildProcedurePicker,
    onReady: [],
    get doc() { return DOC; },
    get cpt() { return (Router.current().cpt) || DEFAULT_CPT; },
    get proc() { return DOC ? DOC.procedures[this.cpt] : null; },
    setCpt(cpt) { Router.go({ mode: "shop", cpt }); },     // back-compat shim → route
    rerender() { render(Router.current()); },
  };

  fetch("data.json")
    .then((r) => {
      if (!r.ok) throw new Error("data.json fetch failed: " + r.status);
      return r.json();
    })
    .then((doc) => {
      DOC = doc;
      if (window.STBBreadth) window.STBBreadth.ensureHospitalIndex();
      Router.onChange(render);
      render(Router.current());
      window.STB.onReady.forEach((fn) => fn());
    })
    .catch((err) => {
      const sw = document.getElementById("mode-switch");
      if (sw) sw.replaceChildren(el("p", { class: "warn" }, "Failed to load data: " + err.message));
      console.error(err);
    });

  // ---- Orchestrator: switcher + mode dispatch -----------------------------

  function render(state) {
    renderSwitcher(state.mode);
    const shop = document.getElementById("shop-view");
    const bill = document.getElementById("bill-view");
    const isShop = state.mode !== "bill";
    shop.hidden = !isShop;
    bill.hidden = isShop;
    if (isShop) renderShop(state);
    else document.dispatchEvent(new CustomEvent("stb:bill-mode", { detail: state }));
    document.dispatchEvent(new CustomEvent("stb:route-changed", { detail: state }));
  }

  function renderSwitcher(mode) {
    function btn(m, label) {
      const active = m === (mode === "bill" ? "bill" : "shop");
      const b = el("button", { class: "mode-btn" + (active ? " active" : ""), type: "button" }, label);
      b.addEventListener("click", () => Router.go({ mode: m, cpt: Router.current().cpt || null }));
      return b;
    }
    document.getElementById("mode-switch").replaceChildren(btn("shop", "Shop prices"), btn("bill", "Check a bill"));
  }

  // ---- Procedure selector (category-grouped, router-driven) ---------------

  const MODALITY_ORDER = ["mri", "ct", "ultrasound", "xray", "mammography"];
  const MODALITY_LABEL = {
    mri: "MRI", ct: "CT", ultrasound: "Ultrasound", xray: "X-ray", mammography: "Mammography",
  };
  const CATEGORY_ORDER = ["imaging", "lab", "em", "procedure", "surgery"];
  const CATEGORY_LABEL = {
    imaging: "Imaging", lab: "Lab", em: "Office & behavioral-health visits", procedure: "Procedures", surgery: "Surgery",
  };

  function procGroupKey(p) {
    // Imaging is sub-grouped by modality; every other category groups by itself.
    return p.category === "imaging" && p.modality ? p.modality : (p.category || "other");
  }

  function groupRank(key) {
    const mi = MODALITY_ORDER.indexOf(key);
    if (mi >= 0) return [CATEGORY_ORDER.indexOf("imaging"), mi];   // imaging modalities first, in order
    const ci = CATEGORY_ORDER.indexOf(key);
    return [ci >= 0 ? ci : CATEGORY_ORDER.length, 0];
  }

  function groupLabel(key) {
    return MODALITY_LABEL[key] || CATEGORY_LABEL[key] || key;
  }

  // Everyday-language synonyms → a predicate over the procedure. Lets people
  // search the words they actually use ("mammogram" for Mammography, "sonogram"
  // for ultrasound, "EKG" for ECG) even when our canonical label differs. A
  // synonym fires when the typed query is a prefix/substring of (or contains)
  // the synonym term, so partial typing still matches. Extend freely.
  const SYNONYMS = [
    { terms: ["mammogram"], test: (p) => p.modality === "mammography" },
    { terms: ["sonogram", "ultrasound", "ultra sound"], test: (p) => p.modality === "ultrasound" },
    { terms: ["cat scan", "ct scan"], test: (p) => p.modality === "ct" },
    { terms: ["x-ray", "x ray", "xray"], test: (p) => p.modality === "xray" },
    { terms: ["ekg", "heart tracing"], test: (p) => p.cpt === "93000" },
    { terms: ["bloodwork", "blood work", "blood test", "labs"], test: (p) => p.category === "lab" },
    { terms: ["scope"], test: (p) => /scopy|endoscop/.test(p.label.toLowerCase()) },
  ];

  function pickableProcs() {
    return Object.values(DOC.procedures).filter((p) => p.addon_only !== true);
  }

  function matchesQuery(p, q) {
    if (p.label.toLowerCase().includes(q) || p.cpt.includes(q)) return true;
    return SYNONYMS.some((s) =>
      s.test(p) && s.terms.some((t) => t.includes(q) || q.includes(t)));
  }

  function procCatTag(p) {
    return groupLabel(procGroupKey(p));   // e.g. "MRI", "Lab", "Surgery"
  }

  // Shared search-first procedure picker, used by both Shop and Check-a-bill.
  // Returns a self-contained <div class="proc-picker">. Selecting a procedure
  // calls onSelect(cpt); the caller is responsible for re-rendering its view.
  function buildProcedurePicker({ selectedCpt, onSelect, mode }) {
    const placeholder = "Search a procedure or code — e.g. mammogram, 76830";
    const input = el("input", {
      class: "picker-input", type: "search", autocomplete: "off",
      placeholder, "aria-label": "Search procedures",
    });
    const results = el("ul", { class: "picker-results", hidden: "" });
    const cat = el("div", { class: "picker-cat" });
    let openCat = null;   // which browse category is currently expanded

    function pick(cpt) { onSelect(cpt); }

    const useBreadth = (mode || "shop") === "shop" && !!window.STBBreadth;
    let debounceTimer = null;

    // Uniform result rows {cpt, label, tag} from the active source: the 12,369-code
    // breadth index when loaded (shop mode), else the curated 66.
    function shopMatches(q) {
      if (useBreadth && window.STBBreadth.searchReady()) {
        return window.STBBreadth.match(q).map((r) => ({
          cpt: r.cpt, label: r.name,
          tag: r.needs_curation ? "as the hospital describes it" : "",
        }));
      }
      return pickableProcs().filter((p) => matchesQuery(p, q)).slice(0, 10)
        .map((p) => ({ cpt: p.cpt, label: p.label, tag: procCatTag(p) }));
    }

    function renderResults() {
      const q = input.value.trim().toLowerCase();
      if (!q) { results.hidden = true; results.replaceChildren(); return; }
      const matches = shopMatches(q);
      if (matches.length === 0) {
        results.hidden = false;
        results.replaceChildren(el("li", { class: "picker-empty dim" }, "No matching procedures."));
        return;
      }
      results.hidden = false;
      results.replaceChildren(...matches.map((m, i) => {
        const li = el("li", { class: "picker-result" + (i === 0 ? " first" : ""), "data-cpt": m.cpt },
          el("span", { class: "picker-result-label" }, `${m.label} (CPT ${m.cpt})`),
          el("span", { class: "picker-result-tag dim micro" }, m.tag),
        );
        li.addEventListener("click", () => pick(m.cpt));
        return li;
      }));
    }

    // Enter selects the first match (low-effort keyboard win).
    input.addEventListener("focus", () => {
      if (useBreadth) window.STBBreadth.ensureSearch().then(renderResults);
    });
    input.addEventListener("input", () => {
      if (!useBreadth) { renderResults(); return; }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(renderResults, 120);
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      const q = input.value.trim().toLowerCase();
      if (!q) return;
      const first = shopMatches(q)[0];
      if (first) { ev.preventDefault(); pick(first.cpt); }
    });

    // Browse-by-category: expand one category at a time, reusing the grouping
    // helpers. Imaging is sub-grouped by modality.
    function categoryProcsGrouped(catKey) {
      const procs = pickableProcs().filter((p) => (p.category || "other") === catKey);
      const groups = new Map();
      procs.forEach((p) => {
        const key = procGroupKey(p);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
      });
      const orderedKeys = [...groups.keys()].sort((a, b) => {
        const ra = groupRank(a), rb = groupRank(b);
        return ra[0] - rb[0] || ra[1] - rb[1] || a.localeCompare(b);
      });
      return orderedKeys.map((key) => ({ key, procs: groups.get(key).sort((a, b) => a.cpt.localeCompare(b.cpt)) }));
    }

    function renderCat() {
      if (!openCat) { cat.replaceChildren(); return; }
      const blocks = categoryProcsGrouped(openCat).map(({ key, procs }) =>
        el("div", { class: "picker-cat-group" },
          // Only show a sub-label when it differs from the category (i.e. imaging modalities).
          key === openCat ? null : el("div", { class: "picker-cat-sublabel" }, groupLabel(key)),
          el("div", { class: "picker-cat-items" },
            ...procs.map((p) => {
              const b = el("button", { class: "picker-cat-item" + (p.cpt === selectedCpt ? " active" : ""), type: "button", "data-cpt": p.cpt },
                `${p.label} (CPT ${p.cpt})`);
              b.addEventListener("click", () => pick(p.cpt));
              return b;
            }),
          ),
        ));
      cat.replaceChildren(...blocks);
    }

    const browseButtons = CATEGORY_ORDER.map((catKey) => {
      const b = el("button", { class: "picker-browse-btn", type: "button", "data-cat": catKey }, CATEGORY_LABEL[catKey]);
      b.addEventListener("click", () => {
        openCat = openCat === catKey ? null : catKey;   // toggle: same button collapses
        for (const sib of browse.querySelectorAll(".picker-browse-btn")) {
          sib.classList.toggle("active", sib.getAttribute("data-cat") === openCat);
        }
        renderCat();
      });
      return b;
    });
    const browse = el("div", { class: "picker-browse" },
      el("span", { class: "picker-browse-label dim" }, "or browse:"),
      ...browseButtons,
    );

    const search = el("div", { class: "picker-search" }, input, results, browse, cat);

    // Current-selection summary + Change (shown when a procedure is selected).
    const picker = el("div", { class: "proc-picker", "data-mode": mode || "shop" });
    const selShard = (selectedCpt && !DOC.procedures[selectedCpt] && window.STBBreadth)
      ? window.STBBreadth.cachedShard(selectedCpt) : null;
    const selProc = (selectedCpt && DOC.procedures[selectedCpt])
      || (selShard ? { label: selShard.name, cpt: selectedCpt } : null);
    if (selProc) {
      const p = selProc;
      search.hidden = true;
      const change = el("button", { class: "picker-change", type: "button" }, "Change");
      change.addEventListener("click", () => {
        current.hidden = true;
        search.hidden = false;
        input.focus();
      });
      const current = el("div", { class: "picker-current" },
        el("span", { class: "picker-current-label" }, `Selected: ${p.label} (CPT ${p.cpt})`),
        change,
      );
      picker.appendChild(current);
      picker.appendChild(search);
    } else {
      picker.appendChild(search);
    }
    return picker;
  }

  function buildSelector(state) {
    return buildProcedurePicker({
      selectedCpt: state.cpt,
      onSelect: (cpt) => Router.go({ mode: "shop", cpt }),
      mode: "shop",
    });
  }

  // Unified "where are you" control: one search box matching hospitals AND
  // towns/ZIPs. Selection writes the anchor (localStorage) and re-renders.
  function buildAnchorControl() {
    const anchor = STBAnchor.get();
    const wrap = el("div", { class: "anchor-control" });

    if (anchor) {
      const change = el("button", { class: "anchor-change", type: "button" }, "Change");
      change.addEventListener("click", () => { STBAnchor.clear(); STB.rerender(); });
      wrap.replaceChildren(
        el("span", { class: "anchor-pin" }, "📍"),
        el("span", { class: "anchor-current" }, `Near ${anchor.label}`),
        change,
      );
      return wrap;
    }

    const input = el("input", {
      class: "picker-input anchor-input", type: "search", autocomplete: "off",
      placeholder: "Where are you? — a hospital, town, or ZIP", "aria-label": "Set your location",
    });
    const results = el("ul", { class: "picker-results", hidden: "" });

    function choosePlace(p) { STBAnchor.set({ lat: p.lat, lng: p.lng, state: p.state, label: p.label, source: "place" }); STB.rerender(); }
    function chooseHospital(h) { STBAnchor.set({ lat: h.lat, lng: h.lng, state: h.state, label: `${h.name} (${h.city}, ${h.state})`, source: "hospital" }); STB.rerender(); }

    function renderResults(places) {
      const q = input.value.trim();
      if (!q) { results.hidden = true; results.replaceChildren(); return; }
      const hospitals = (DOC.procedures[STB.cpt] ? DOC.procedures[STB.cpt].hospitals : [])
        .filter((h) => h.lat != null);
      const r = STBRelevance.searchAnchorCandidates(q, { hospitals, places: places || { zips: {}, towns: [] } });
      const items = [];
      if (r.hospitals.length) {
        items.push(el("li", { class: "picker-group dim micro" }, "Hospitals"));
        r.hospitals.forEach((h) => {
          const li = el("li", { class: "picker-result" }, `${h.name} — ${h.city}, ${h.state}`);
          li.addEventListener("click", () => chooseHospital(h));
          items.push(li);
        });
      }
      if (r.places.length) {
        items.push(el("li", { class: "picker-group dim micro" }, "Towns / ZIPs"));
        r.places.forEach((p) => {
          const li = el("li", { class: "picker-result" }, p.label);
          li.addEventListener("click", () => choosePlace(p));
          items.push(li);
        });
      }
      if (!items.length) items.push(el("li", { class: "picker-empty dim" }, "No match — try a hospital name or a nearby town."));
      results.hidden = false;
      results.replaceChildren(...items);
    }

    let placesDoc = null;
    input.addEventListener("focus", () => { STBAnchor.loadPlaces().then((d) => { placesDoc = d; renderResults(placesDoc); }); });
    input.addEventListener("input", () => renderResults(placesDoc));

    wrap.replaceChildren(el("div", { class: "picker-search" }, input, results));
    return wrap;
  }

  // ---- Unified Shop comparison --------------------------------------------

  let SHOP_REGION = "all", SHOP_SORT = "cheapest";
  let SHOP_SHOW_ALL = false, SHOP_INCLUDE_NEIGHBORS = false;

  function fmtDistance(mi) {
    if (mi == null) return "";
    if (mi < 1) return "in town";
    if (mi < 100) return `≈${Math.round(mi)} mi`;
    return `≈${Math.round(mi / 5) * 5} mi`;
  }

  function stateLabel(code) {
    const r = (DOC.regions || []).find((x) => x.key === "wyoming");
    return { WY: "Wyoming", TX: "Texas", NE: "Nebraska", CO: "Colorado", UT: "Utah",
             MT: "Montana", SD: "South Dakota", ID: "Idaho" }[code] || code;
  }

  // Resolve a Shop CPT to a renderable record: a curated procedure from data.json,
  // or a breadth code adapted from its lazy-loaded shard (fetched on demand, with a
  // re-render when it arrives). Status: "ok" | "loading" | "error" | "none".
  function resolveShopProc(cpt) {
    if (!cpt) return { status: "none" };
    if (DOC.procedures[cpt]) return { status: "ok", p: DOC.procedures[cpt] };
    const B = window.STBBreadth;
    if (!B) return { status: "none" };
    const shard = B.cachedShard(cpt);            // undefined=never, null=failed, object=ok
    if (shard === undefined) {
      B.getShard(cpt).then(() => STB.rerender(), () => STB.rerender());
      return { status: "loading" };
    }
    if (shard === null) return { status: "error" };
    const hidx = B.hospitalIndex();
    if (!hidx) { B.ensureHospitalIndex().then(() => STB.rerender()); return { status: "loading" }; }
    return { status: "ok", p: B.breadthRecord(shard, hidx) };
  }

  // Inline honesty chips for a breadth listing (null for a curated procedure).
  function breadthChips(p) {
    if (!p || !p.breadth || !window.STBBreadth || !window.STBGlossary) return null;
    const G = window.STBGlossary;
    const chips = window.STBBreadth.badgesFor(p).map((c) =>
      el("span", { class: "breadth-chip" }, G.term(c.term, c.text)));
    return el("div", { class: "breadth-chips" }, ...chips);
  }

  function renderShop(state) {
    const view = document.getElementById("shop-view");
    const cpt = state.cpt;
    const resolved = resolveShopProc(cpt);
    if (resolved.status !== "ok") {
      const msg = resolved.status === "loading" ? "Loading this procedure…"
        : resolved.status === "error" ? "Couldn't load this procedure — please try again."
        : "Pick a procedure to compare prices.";
      view.replaceChildren(
        buildSelector(state),
        buildAnchorControl(),
        el("p", { class: resolved.status === "error" ? "warn shop-empty" : "dim shop-empty" }, msg),
      );
      return;
    }
    const p = resolved.p;
    const anchor = STBAnchor.get();
    const med = p.medicare_national_usd;
    const anchorEl = buildAnchorControl();
    const medEl = med != null
      ? el("p", { class: "shop-anchor" }, `Medicare pays about ${fmtUSD(med)} for this.`)
      : el("p", { class: "shop-anchor dim" }, "Medicare publishes no comparable facility rate for this code.");

    if (!anchor || anchor.lat == null) {
      // No anchor → existing flat region-filtered list.
      const hospitals = p.hospitals.filter((h) => SHOP_REGION === "all" || h.region === SHOP_REGION);
      const priced = hospitals.filter((h) => h.cash_price != null);
      const maxCash = priced.length ? Math.max(...priced.map((h) => h.cash_price)) : 0;
      const ordered = hospitals.slice().sort(shopComparator);
      const children = [
        buildSelector(state), anchorEl,
        el("div", { class: "shop-controls" }, regionFilter(), sortControl(), copyLink()),
        medEl,
        breadthChips(p),
        comparePanel(p),
        el("div", { class: "shop-list" }, ...ordered.map((h) => shopRow(p, h, maxCash))),
        fairReveal(p),
        el("div", { id: "detail", class: "detail" }),
      ];
      view.replaceChildren(...children.filter(Boolean));
      if (state.hospital) document.dispatchEvent(new CustomEvent("stb:route-changed", { detail: state }));
      return;
    }

    // Anchored → relevance tiers.
    const withDist = STBRelevance.withDistance(p.hospitals, anchor);
    const maxCash = (() => {
      const priced = withDist.filter((h) => h.cash_price != null);
      return priced.length ? Math.max(...priced.map((h) => h.cash_price)) : 0;
    })();
    const { inState, outState } = STBRelevance.partitionByState(withDist, anchor.state);
    const inNear = STBRelevance.nearest(inState);
    const shown = SHOP_SHOW_ALL ? inNear : inNear.slice(0, STBRelevance.CONST.NEAR_VISIBLE_COUNT);
    const hiddenCount = inNear.length - shown.length;

    const sections = [
      el("div", { class: "shop-tier-head" }, `Near you · ${stateLabel(anchor.state)}`),
      el("div", { class: "shop-list" }, ...shown.map((h) => shopRow(p, h, maxCash))),
    ];
    if (hiddenCount > 0 || SHOP_SHOW_ALL) {
      const toggle = el("button", { class: "shop-showmore", type: "button" },
        SHOP_SHOW_ALL ? "Show fewer" : `Show all ${inNear.length} in ${stateLabel(anchor.state)}`);
      toggle.addEventListener("click", () => { SHOP_SHOW_ALL = !SHOP_SHOW_ALL; STB.rerender(); });
      sections.push(toggle);
    }

    const neighbors = STBRelevance.neighboringStates(anchor.state);
    const neighborHosps = STBRelevance.nearest(outState.filter((h) => neighbors.indexOf((h.state || "").toUpperCase()) >= 0));
    if (neighborHosps.length) {
      const tog = el("button", { class: "shop-neighbors-toggle", type: "button" },
        SHOP_INCLUDE_NEIGHBORS ? "Hide neighboring states" : `＋ include neighboring states (${neighborHosps.length})`);
      tog.addEventListener("click", () => { SHOP_INCLUDE_NEIGHBORS = !SHOP_INCLUDE_NEIGHBORS; STB.rerender(); });
      sections.push(tog);
      if (SHOP_INCLUDE_NEIGHBORS) {
        sections.push(
          el("div", { class: "shop-tier-head" }, "Across the state line — verify your plan covers it"),
          el("div", { class: "shop-list" }, ...neighborHosps.map((h) => shopRow(p, h, maxCash))),
        );
      }
    }

    const anchoredChildren = [
      buildSelector(state), anchorEl,
      el("div", { class: "shop-controls" }, sortControl(), copyLink()),
      medEl,
      breadthChips(p),
      worthTheTravelCallout(p, withDist, anchor),   // implemented in Task 8; returns null for now
      comparePanel(p),                              // implemented in Task 8; returns null for now
      ...sections,
      fairReveal(p),
      el("div", { id: "detail", class: "detail" }),
    ];
    view.replaceChildren(...anchoredChildren.filter(Boolean));
    if (state.hospital) document.dispatchEvent(new CustomEvent("stb:route-changed", { detail: state }));
  }

  function shopComparator(a, b) {
    const av = a.cash_price, bv = b.cash_price;
    if (av == null) return 1;
    if (bv == null) return -1;                                    // unpriced last
    return SHOP_SORT === "priciest" ? bv - av : av - bv;          // default cheapest-first
  }

  function comparePin(p, h) {
    const on = STBCompare.has(h.key);
    const btn = el("button", {
      class: "compare-pin" + (on ? " on" : ""), type: "button",
      title: on ? "Remove from compare" : "Add to compare", "aria-pressed": on ? "true" : "false",
    }, on ? "✓" : "+");
    btn.addEventListener("click", (ev) => { ev.stopPropagation(); STBCompare.toggle(h.key); STB.rerender(); });
    return btn;
  }

  // Pinned hospitals priced for the CURRENT procedure, with the savings spread.
  function comparePanel(p) {
    const keys = STBCompare.list();
    if (!keys.length) return null;
    const rows = keys
      .map((k) => p.hospitals.find((h) => h.key === k))
      .filter(Boolean)
      .map((h) => ({ h, cash: h.cash_price }));
    const priced = rows.map((r) => r.cash).filter((c) => c != null);
    const best = priced.length ? Math.min(...priced) : null;

    const clearBtn = el("button", { class: "compare-clear", type: "button" }, "clear");
    clearBtn.addEventListener("click", () => { STBCompare.clear(); STB.rerender(); });

    return el("div", { class: "compare-panel" },
      el("div", { class: "compare-head" }, el("strong", null, `Your compare set (${rows.length})`), clearBtn),
      el("div", { class: "compare-rows" }, ...rows.map(({ h, cash }) => {
        const delta = (cash != null && best != null && cash > best) ? ` · +${fmtUSD(cash - best)} vs cheapest` : (cash != null && cash === best ? " · cheapest here" : "");
        const remove = el("button", { class: "compare-remove", type: "button", title: "Remove" }, "×");
        remove.addEventListener("click", () => { STBCompare.toggle(h.key); STB.rerender(); });
        return el("div", { class: "compare-row" },
          el("span", { class: "compare-name" }, h.name),
          el("span", { class: "compare-price" }, cash != null ? fmtUSD(cash) : "no posted price"),
          el("span", { class: "dim micro" }, delta),
          remove,
        );
      })),
    );
  }

  function worthTheTravelCallout(p, withDist, anchor) {
    const wtt = STBRelevance.worthTheTravel(withDist, anchor.state);
    if (!wtt) return null;
    const w = wtt.winner;
    const crossBorder = (w.state || "").toUpperCase() !== (anchor.state || "").toUpperCase();
    const addBtn = el("button", { class: "wtt-add", type: "button" },
      STBCompare.has(w.key) ? "✓ in compare" : "+ add to compare");
    addBtn.addEventListener("click", () => { STBCompare.toggle(w.key); STB.rerender(); });

    const line2 = `${fmtUSD(w._savings)} less than the best price near you · ${fmtDistance(w._distance)}, likely a multi-hour drive` +
      (crossBorder ? ` · across the ${anchor.state}–${w.state} line — check your plan` : "");

    const children = [
      el("div", { class: "wtt-head" }, "⭐ Worth the travel"),
      el("div", { class: "wtt-main" }, el("strong", null, `${w.name} — ${fmtUSD(w.cash_price)}`)),
      el("div", { class: "wtt-sub dim" }, line2),
      addBtn,
    ];
    if (wtt.others.length) {
      const more = el("details", { class: "wtt-more" },
        el("summary", null, `other options worth the drive (${wtt.others.length})`),
        ...wtt.others.map((o) => el("div", { class: "wtt-other dim micro" },
          `${o.name} — ${fmtUSD(o.cash_price)} · ${fmtDistance(o._distance)} · ${fmtUSD(o._savings)} less`)));
      children.push(more);
    }
    return el("div", { class: "wtt-callout" }, ...children);
  }

  function shopRow(p, h, maxCash) {
    const cash = h.cash_price;
    const mult = h.multiples && h.multiples.cash_vs_medicare;
    const pct = (cash != null && maxCash) ? Math.max(3, Math.round(100 * cash / maxCash)) : 0;
    const dist = h._distance != null ? el("span", { class: "shop-dist dim micro" }, fmtDistance(h._distance)) : null;
    const row = el("div", { class: "shop-row" + (h.is_critical_access ? " cah" : "") },
      comparePin(p, h),
      el("button", { class: "shop-rowbtn", type: "button" },
        el("div", { class: "shop-name" },
          el("span", null, h.name),
          el("span", { class: "shop-tags dim micro" }, tier2Tag(h), dist ? " · " : "", dist),
        ),
        el("div", { class: "shop-price" }, cash != null ? fmtUSD(cash) : el("span", { class: "dim" }, "no posted price")),
        el("div", { class: "shop-mult dim micro" }, mult != null ? el("span", null, `${fmtMult(mult)} `, window.STBGlossary.term("x_medicare", "Medicare")) : ""),
        el("div", { class: "shop-bar" }, el("span", { class: "shop-bar-fill", style: `width:${pct}%` })),
      ),
    );
    row.querySelector(".shop-rowbtn").addEventListener("click", () => Router.go({ mode: "shop", cpt: p.cpt, hospital: h.key }));
    return row;
  }

  function regionFilter() {
    const sel = el("select", { id: "shop-region" },
      el("option", { value: "all" }, "All regions"),
      ...DOC.regions.map((r) => el("option", { value: r.key }, r.label)),
    );
    sel.value = SHOP_REGION;
    sel.addEventListener("change", () => { SHOP_REGION = sel.value; render(Router.current()); });
    return el("label", null, "Region ", sel);
  }

  function sortControl() {
    const sel = el("select", { id: "shop-sort" },
      el("option", { value: "cheapest" }, "Cheapest first"),
      el("option", { value: "priciest" }, "Priciest first"),
    );
    sel.value = SHOP_SORT;
    sel.addEventListener("change", () => { SHOP_SORT = sel.value; render(Router.current()); });
    return el("label", null, "Sort ", sel);
  }

  function copyLink() {
    const btn = el("button", { class: "shop-copy", type: "button" }, "Copy link");
    btn.addEventListener("click", () => {
      const url = location.origin + location.pathname + Router.toHash(Router.current());
      const flash = () => {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy link"; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(flash, flash);
      } else {
        flash();
      }
    });
    return btn;
  }

  function tier2Tag(h) {
    const parts = [];
    if (h.ownership) parts.push(h.ownership.replace(/_/g, " "));
    if (h.is_critical_access) parts.push("CAH");
    parts.push(h.region);
    return parts.join(" · ");
  }

  // Supplementary chargemaster-range note: when a hospital posts the same code at
  // multiple internal line items (n_items > 1), surface the gross spread + count
  // alongside the median price. This is genuine transparency — a hospital posting
  // one lipid panel at 11 prices, $60–$207. The headline gross/cash stays the
  // median (already in the data); this only adds context.
  function postedSpreadNote(h) {
    const ps = h.posted_spread;
    if (!ps || !(ps.n_items > 1)) return "";
    const range = ps.gross_max > ps.gross_min ? `, ${fmtUSD(ps.gross_min)}–${fmtUSD(ps.gross_max)}` : "";
    return ` · ${ps.n_items} items${range}`;
  }

  // ---- "Is this fair?" reveal (relocated convergence chart / Tier-2 reasoning) ----

  function fairReveal(p) {
    const body = el("div", { class: "fair-body" });
    const d = el("details", { class: "fair-reveal" },
      el("summary", null, "How do we know what it should cost?"),
      body);
    d.addEventListener("toggle", () => {
      if (!d.open || body.dataset.built) return;
      body.dataset.built = "1";
      if (p.tier === 1) {
        const wrap = el("div", { class: "chart-wrap" });             // renderChart expects .chart-wrap
        body.replaceChildren(
          buildLegend(),
          wrap,
          el("div", { id: "callouts", class: "callouts" }),
          el("div", { id: "same-system", class: "same-system" }),
        );
        const view = { regions: DOC.regions, hospitals: p.hospitals, same_system: p.same_system, label: p.label, cpt: p.cpt };
        renderChart(view);
        renderCallouts(view);
        renderSameSystem(view);
      } else {
        body.replaceChildren(tier2Reasoning(p));
      }
    });
    return d;
  }

  function buildLegend() {
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
    return el("div", { class: "legend" }, ...items);
  }

  // Tier-2 posted-price-vs-Medicare reasoning for the reveal: the per-hospital
  // × Medicare framing + the basis label + the "not a cost estimate" note.
  function tier2Reasoning(p) {
    const basis = tier2Basis(p);
    const med = p.medicare_national_usd;
    const hospitals = p.hospitals.filter((h) => h.gross_charge != null || h.cash_price != null);

    const medLine = (med == null || basis === "unavailable")
      ? el("div", { class: "tier2-medicare dim" },
          "No published Medicare reference for this code — posted prices are shown for context.")
      : el("div", { class: "tier2-medicare dim" },
          `Medicare reference: ${fmtUSD(med)} — ${medicareLabel(basis)}.`);

    const rows = hospitals
      .slice()
      .sort((a, b) => (b.cash_price || b.gross_charge || 0) - (a.cash_price || a.gross_charge || 0))
      .map((h) => {
        const mult = h.multiples && h.multiples.cash_vs_medicare;
        return el("div", { class: "tier2-row" + (h.is_critical_access ? " cah" : "") },
          el("div", { class: "tier2-name" },
            el("span", null, h.name),
            el("span", { class: "tier2-tag dim micro" }, tier2Tag(h)),
          ),
          el("div", { class: "tier2-prices" },
            `gross ${fmtUSD(h.gross_charge)} · cash ${fmtUSD(h.cash_price)} · `,
            window.STBGlossary.term("insurer_negotiated", "insurer-negotiated"),
            ` ${fmtUSD(h.negotiated.min)}–${fmtUSD(h.negotiated.max)}${postedSpreadNote(h)}`),
          el("div", { class: "tier2-mult" },
            mult != null ? `cash = ${fmtMult(mult)} Medicare` : "no posted price"),
        );
      });

    return el("div", { class: "tier2-panel" },
      el("div", { class: "tier2-badge" }, "Posted prices — not a cost estimate"),
      el("p", { class: "dim" },
        "Tier-2 codes carry posted prices versus Medicare's published rate only — we do not decompose a " +
        "cost to deliver. The comparison below is each hospital's posted price against that Medicare reference."),
      medLine,
      ...rows,
    );
  }

  // ---- Convergence chart (Tier-1) — content of the reveal -----------------

  function renderChart(view) {
    const wrap = document.querySelector(".chart-wrap");
    if (!document.getElementById("chart")) {
      const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgEl.setAttribute("id", "chart");
      svgEl.setAttribute("role", "img");
      svgEl.setAttribute("aria-label", "Per-hospital cost vs. charge for selected imaging procedure");
      wrap.replaceChildren(svgEl);
    }
    const svg = d3.select("#chart");
    svg.selectAll("*").remove();
    const viewW = 940;
    const margins = { top: 16, right: 25, bottom: 50, left: 310, rowGap: 4 };
    const ROW_H = 48;
    const BAR_H = 14;

    const regions = view.regions.map((r) => ({
      ...r,
      hospitals: view.hospitals
        .filter((h) => h.region === r.key)
        .sort((a, b) => (b.gross_charge || 0) - (a.gross_charge || 0)),
    }));

    const maxGross = d3.max(view.hospitals, (h) => h.gross_charge) || 7000;
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

    if (h.cost_breakdown) {
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
      const grossX0 = xScale(h.gross_charge || 0);
      if (grossX0 > runningX) {
        svg.append("rect")
          .attr("x", runningX).attr("y", barTop)
          .attr("width", grossX0 - runningX).attr("height", BAR_H)
          .attr("fill", "url(#margin-hatch)")
          .attr("stroke", "var(--c-margin-hatch)").attr("stroke-width", 0.5);
      }
    } else {
      // Breadth-only: no per-site cost model, so draw the posted (gross) price as a
      // single neutral bar. The CCR + Medicare + cash markers below still render.
      const grossX0 = xScale(h.gross_charge || 0);
      svg.append("rect")
        .attr("x", x0).attr("y", barTop)
        .attr("width", Math.max(0, grossX0 - x0)).attr("height", BAR_H)
        .attr("fill", "var(--c-posted, #c9ced6)");
    }

    if (h.estimated_cost && h.estimated_cost.ccr_check != null) {
      const ccrX = xScale(h.estimated_cost.ccr_check);
      svg.append("line")
        .attr("x1", ccrX).attr("x2", ccrX)
        .attr("y1", barTop - 2).attr("y2", barBottom + 2)
        .attr("stroke", "var(--c-ccr)").attr("stroke-width", 1.2)
        .attr("stroke-dasharray", "3 2");
    }

    if (h.medicare_reference.amount != null) {
      const medX = xScale(h.medicare_reference.amount);
      svg.append("polygon")
        .attr("points", `${medX},${barTop - 2} ${medX - 5},${barTop - 12} ${medX + 5},${barTop - 12}`)
        .attr("fill", "var(--c-medicare)");
      if (h.medicare_reference.basis === "cost_based") {
        svg.append("text").attr("class", "cah-label-medicare")
          .attr("x", medX + 9).attr("y", barTop - 4).text("Medicare (cost-based)");
      }
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

    const gross = h.gross_charge || 0;
    const grossX = xScale(gross);
    if (gross > 0) {
      svg.append("text").attr("class", "gross-label")
        .attr("x", grossX + 6).attr("y", barTop + 11)
        .text("$" + Math.round(gross).toLocaleString());
    }

    if (h.multiples && h.multiples.cash_vs_medicare != null) {
      svg.append("text").attr("class", "row-multiple")
        .attr("x", labelRightX).attr("y", barTop + 27).attr("text-anchor", "end")
        .text(`cash = ${fmtMult(h.multiples.cash_vs_medicare)} Medicare${h.medicare_reference.basis === "cost_based" ? " (cost-based)" : ""}`);
    }

    svg.append("rect")
      .attr("x", 0).attr("y", rowStart).attr("width", viewW).attr("height", 48)
      .attr("fill", "transparent").style("cursor", "pointer")
      .on("mouseenter", function (ev) { showTooltip(tooltip, ev, h); })
      .on("mousemove", function (ev) { moveTooltip(tooltip, ev); })
      .on("mouseleave", function () { hideTooltip(tooltip); })
      .on("click", () => { Router.go({ mode: "shop", cpt: window.STB.cpt, hospital: h.key }); });
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
    const f = fmtUSD;
    const costLow = h.estimated_cost && h.estimated_cost.bottom_up != null
      ? Math.min(h.estimated_cost.bottom_up, h.estimated_cost.ccr_check != null ? h.estimated_cost.ccr_check : h.estimated_cost.bottom_up)
      : (h.estimated_cost ? h.estimated_cost.ccr_check : null);
    const costHigh = h.estimated_cost && h.estimated_cost.bottom_up != null
      ? Math.max(h.estimated_cost.bottom_up, h.estimated_cost.ccr_check != null ? h.estimated_cost.ccr_check : h.estimated_cost.bottom_up)
      : (h.estimated_cost ? h.estimated_cost.ccr_check : null);
    const costText = costLow == null ? "—" : (costLow === costHigh ? f(costLow) : `${f(costLow)} – ${f(costHigh)}`);
    const children = [
      el("div", null, el("strong", null, h.name)),
      el("div", { class: "dim micro", style: "margin-bottom:6px" }, h.region),
      el("div", null, `List price: ${f(h.gross_charge)} · Cash: ${f(h.cash_price)}`),
      el("div", null, `Insurer-negotiated: ${f(h.negotiated.min)} – ${f(h.negotiated.max)}`),
      el("div", null, `Estimated cost to deliver: ${costText}`),
      el("div", null, "Medicare: ", el("strong", null, f(h.medicare_reference.amount)),
        ` (${(h.medicare_reference.basis || "").replace("_", " ")})`),
      el("hr"),
      el("div", { class: "dim micro" }, "Prices from the hospital's posted file; cost from its Medicare cost report; Medicare from the published fee schedule."),
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

  function renderCallouts(view) {
    const byRegion = d3.group(view.hospitals.filter((h) => h.gross_charge != null), (h) => h.region);
    const spreads = view.regions.map((r) => {
      const list = byRegion.get(r.key) || [];
      const min = d3.min(list, (h) => h.gross_charge);
      const max = d3.max(list, (h) => h.gross_charge);
      return { region: r.label, mult: min && max ? max / min : null };
    });
    const all = view.hospitals.filter((h) => h.gross_charge != null);
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

  function renderSameSystem(view) {
    const container = document.getElementById("same-system");
    const ss = view.same_system;
    if (ss == null) {
      container.replaceChildren();
      return;
    }
    const torrington = view.hospitals.find((h) => h.key === ss.cah_key);
    const casper = view.hospitals.find((h) => h.key === ss.flagship_key);
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
    const takeaway = ss && ss.cash_ratio != null && ss.cost_ratio != null
      ? `For this procedure, Banner's chargemaster prices are nearly identical at both facilities` +
        ` (ratio ${ss.gross_ratio == null ? "n/a" : ss.gross_ratio}×), the rural CAH costs ${ss.cost_ratio}× as much to deliver per scan` +
        `, and its cash price runs ${ss.cash_ratio}× the urban flagship's.`
      : "Comparison unavailable for this procedure (missing price data).";
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
      el("p", { class: "takeaway" }, takeaway),
    );
  }
})();
