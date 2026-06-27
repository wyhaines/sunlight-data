// web/breadth.js — breadth-tier Shop support: the pure shard→record adapter, the
// search matcher, honesty badges, and the browser-runtime lazy loaders. Dual-
// exported like glossary.js / relevance.js so the pure contract is node --test'able.
(function (root) {
  "use strict";

  // ---- Pure: a thin breadth shard + the hospital index → the procedure-record
  // shape the existing Shop renderers already consume. Tier-1 cost fields are
  // simply omitted (the renderers skip them). medicare_reference and multiples
  // are ALWAYS objects so callers can dereference them unguarded.
  function breadthRecord(shard, hospitalIndex) {
    var hospitals = [];
    var hkeys = Object.keys(shard.hospitals || {});
    for (var i = 0; i < hkeys.length; i++) {
      var hkey = hkeys[i];
      var meta = hospitalIndex[hkey];
      if (!meta) continue;                       // never fabricate hospital metadata
      var cell = shard.hospitals[hkey];
      var med = cell.medicare;                   // {amount, basis} | null
      var mult = cell.multiples;                 // {cash_vs_medicare, gross_vs_medicare} | null
      hospitals.push({
        key: hkey,
        name: meta.name, city: meta.city, state: meta.state,
        lat: meta.lat, lng: meta.lng, ccn: meta.ccn, region: meta.region,
        ownership: meta.ownership, is_critical_access: meta.is_critical_access,
        has_mobile_mri: meta.has_mobile_mri,
        gross_charge: cell.gross_charge, cash_price: cell.cash_price,
        negotiated: cell.negotiated || { min: null, median: null, max: null },
        posted_spread: cell.posted_spread,
        descriptions: cell.descriptions,
        inpatient_fallback: cell.inpatient_fallback,
        medicare_reference: med
          ? { amount: med.amount, basis: med.basis,
              locality_adjusted: String(med.basis).indexOf("opps") === 0,
              wage_index: meta.wage_index }
          : { amount: null, basis: "unavailable" },
        multiples: mult
          ? { cash_vs_medicare: mult.cash_vs_medicare, gross_vs_medicare: mult.gross_vs_medicare,
              medicare_basis: med ? med.basis : null }
          : { cash_vs_medicare: null, gross_vs_medicare: null, medicare_basis: null },
        provenance: {
          prices: "From this hospital's publicly posted machine-readable price file.",
          medicare: med ? "Derived programmatically from public OPPS Addendum B / CLFS / PFS." : "",
        },
      });
    }
    return {
      cpt: shard.code, label: shard.name, breadth: true,
      name_source: shard.name_source, needs_curation: shard.needs_curation,
      code_class: shard.code_class, basis_kind: shard.basis_kind,
      medicare_national_usd: shard.medicare_national,
      hospitals: hospitals,
    };
  }

  // ---- Pure: routing + honesty badges ------------------------------------
  function isBreadthOnly(cpt, doc) {
    return !!cpt && !(doc && doc.procedures && doc.procedures[cpt]);
  }

  function badgesFor(record) {
    var chips = [{ term: "breadth_listing", text: "posted prices · not a worked example" }];
    if (record && record.needs_curation) {
      chips.push({ term: "hospital_named", text: "name as the hospital describes it" });
    }
    return chips;
  }

  // ---- Pure: a one-time normalized search structure → a ranked matcher.
  // Each entry caches a lowercased name and a haystack (name + cpt + every
  // hospital's posted description token). Ranking: exact CPT, then name prefix,
  // then haystack substring; synonym terms expand to extra needles.
  function buildSearch(procIndex, searchIndex) {
    var codes = procIndex.codes || {};
    var tokens = (searchIndex && searchIndex.codes) || {};
    var synonyms = procIndex.synonyms || [];
    var entries = Object.keys(codes).map(function (code) {
      var e = codes[code];
      var toks = tokens[code] || [e.name, code];
      return {
        code: code, name: e.name, name_source: e.name_source, needs_curation: e.needs_curation,
        nameLc: String(e.name).toLowerCase(),
        hay: (toks.join(" ") + " " + code).toLowerCase(),
      };
    });
    return function match(query) {
      var q = String(query == null ? "" : query).trim().toLowerCase();
      if (!q) return [];
      var needles = [q];
      synonyms.forEach(function (s) {
        var hit = (s.terms || []).some(function (t) { return t.indexOf(q) >= 0 || q.indexOf(t) >= 0; });
        if (hit) (s.rule && s.rule.keyword || []).forEach(function (k) { needles.push(String(k).toLowerCase()); });
      });
      var exact = [], prefix = [], contains = [];
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i];
        if (en.code.toLowerCase() === q) exact.push(en);
        else if (en.nameLc.indexOf(q) === 0) prefix.push(en);
        else if (needles.some(function (n) { return en.hay.indexOf(n) >= 0; })) contains.push(en);
      }
      return exact.concat(prefix, contains).slice(0, 10).map(function (en) {
        return { cpt: en.code, name: en.name, name_source: en.name_source, needs_curation: en.needs_curation };
      });
    };
  }

  // ---- Browser runtime: lazy fetch + cache of the indexes and per-code shards.
  // Not exercised in the browser by node tests except via a stubbed global fetch.
  var _hindex = null, _hindexPromise = null;
  var _procIndex = null, _procIndexPromise = null;
  var _matcher = null, _searchPromise = null;
  var _shardCache = {}, _shardPending = {};

  function __resetCaches() {
    _hindex = null; _hindexPromise = null;
    _procIndex = null; _procIndexPromise = null;
    _matcher = null; _searchPromise = null;
    _shardCache = {}; _shardPending = {};
  }

  function _json(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  }

  function ensureHospitalIndex() {
    if (_hindex) return Promise.resolve(_hindex);
    if (!_hindexPromise) {
      _hindexPromise = _json("hospital-index.json").then(function (doc) { _hindex = doc; return doc; });
    }
    return _hindexPromise;
  }
  function hospitalIndex() { return _hindex; }

  function ensureProcedureIndex() {
    if (_procIndex) return Promise.resolve(_procIndex);
    if (!_procIndexPromise) {
      _procIndexPromise = _json("procedure-index.json").then(function (doc) { _procIndex = doc; return doc; });
    }
    return _procIndexPromise;
  }
  function procedureIndex() { return _procIndex; }

  function ensureSearch() {
    if (_matcher) return Promise.resolve(_matcher);
    if (!_searchPromise) {
      _searchPromise = Promise.all([
        ensureProcedureIndex(), _json("search-index.json"), ensureHospitalIndex(),
      ]).then(function (parts) { _matcher = buildSearch(parts[0], parts[1]); return _matcher; });
    }
    return _searchPromise;
  }
  function searchReady() { return !!_matcher; }
  function match(query) { return _matcher ? _matcher(query) : []; }

  function getShard(cpt) {
    if (Object.prototype.hasOwnProperty.call(_shardCache, cpt)) return Promise.resolve(_shardCache[cpt]);
    if (_shardPending[cpt]) return _shardPending[cpt];
    var pr = ensureHospitalIndex()
      .then(function () { return _json("shards/" + cpt + ".json"); })
      .then(function (shard) { _shardCache[cpt] = shard; delete _shardPending[cpt]; return shard; },
            function () { _shardCache[cpt] = null; delete _shardPending[cpt]; return null; });
    _shardPending[cpt] = pr;
    return pr;
  }
  function cachedShard(cpt) {
    return Object.prototype.hasOwnProperty.call(_shardCache, cpt) ? _shardCache[cpt] : undefined;
  }

  // Resolve a CPT to a renderable procedure record: the curated record from
  // data.json, else a breadth record adapted from its lazy-loaded shard. Reads the
  // caches synchronously; kicks off a load (calling onLoad on completion) when the
  // shard or hospital index isn't ready. Status: ok | loading | error | none.
  function resolveRecord(cpt, doc, onLoad) {
    if (!cpt) return { status: "none" };
    if (doc && doc.procedures && doc.procedures[cpt]) return { status: "ok", p: doc.procedures[cpt] };
    var shard = cachedShard(cpt);            // undefined=never, null=failed, object=ok
    if (shard === undefined) { getShard(cpt).then(onLoad, onLoad); return { status: "loading" }; }
    if (shard === null) return { status: "error" };
    var hidx = hospitalIndex();
    if (!hidx) { ensureHospitalIndex().then(onLoad, onLoad); return { status: "loading" }; }
    return { status: "ok", p: breadthRecord(shard, hidx) };
  }

  var API = {
    breadthRecord: breadthRecord,
    isBreadthOnly: isBreadthOnly,
    badgesFor: badgesFor,
    buildSearch: buildSearch,
    ensureHospitalIndex: ensureHospitalIndex,
    hospitalIndex: hospitalIndex,
    ensureProcedureIndex: ensureProcedureIndex,
    procedureIndex: procedureIndex,
    resolveRecord: resolveRecord,
    ensureSearch: ensureSearch,
    searchReady: searchReady,
    match: match,
    getShard: getShard,
    cachedShard: cachedShard,
    __resetCaches: __resetCaches,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.STBBreadth = API;
})(typeof window !== "undefined" ? window : globalThis);
