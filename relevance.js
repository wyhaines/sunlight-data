// Pure relevance engine: distance, state boundary, nearest selection, and
// worth-the-travel. No DOM, no localStorage, no network — unit-tested with
// `node --test`. Dual-exports for Node; attaches to window for the browser.
(function (root) {
  "use strict";

  var CONST = {
    NEAR_VISIBLE_COUNT: 6,    // nearest in-state hospitals shown before "show all"
    WTT_MIN_SAVINGS_USD: 150, // worth-the-travel dollar floor
    WTT_MIN_SAVINGS_PCT: 0.25, // worth-the-travel percentage floor
    WTT_MAX_DISTANCE_MI: 300,  // never recommend travel beyond this
  };

  // Static adjacency for "include neighboring states". Covers the seed states +
  // their realistic cross-border corridors; extend as states are added.
  var STATE_ADJACENCY = {
    WY: ["MT", "SD", "NE", "CO", "UT", "ID"],
    NE: ["WY", "SD", "IA", "MO", "KS", "CO"],
    TX: ["NM", "OK", "AR", "LA"],
    CO: ["WY", "NE", "KS", "OK", "NM", "UT"],
    UT: ["ID", "WY", "CO", "NM", "AZ", "NV"],
    MT: ["ID", "WY", "SD", "ND"],
    SD: ["ND", "MT", "WY", "NE", "IA", "MN"],
    ID: ["MT", "WY", "UT", "NV", "OR", "WA"],
  };

  function haversineMiles(aLat, aLng, bLat, bLng) {
    var Rmi = 3958.7613;
    var toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(bLat - aLat);
    var dLng = toRad(bLng - aLng);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Rmi * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  function neighboringStates(state) {
    return STATE_ADJACENCY[(state || "").toUpperCase()] || [];
  }

  function withDistance(hospitals, anchor) {
    return hospitals.map(function (h) {
      var d = (anchor && anchor.lat != null && anchor.lng != null && h.lat != null && h.lng != null)
        ? haversineMiles(anchor.lat, anchor.lng, h.lat, h.lng) : null;
      return Object.assign({}, h, { _distance: d });
    });
  }

  function partitionByState(hospitals, anchorState) {
    var st = (anchorState || "").toUpperCase();
    var inState = [], outState = [];
    hospitals.forEach(function (h) {
      ((h.state || "").toUpperCase() === st ? inState : outState).push(h);
    });
    return { inState: inState, outState: outState };
  }

  function nearest(hospitals, n) {
    var sorted = hospitals.slice().sort(function (a, b) {
      if (a._distance == null) return 1;
      if (b._distance == null) return -1;
      return a._distance - b._distance;
    });
    return n == null ? sorted : sorted.slice(0, n);
  }

  function priceOf(h) { return h.cash_price != null ? h.cash_price : null; }

  // localBest = cheapest among the near group (nearest N in-state). Candidates =
  // ALL priced hospitals NOT in the near group, within max distance — including
  // out-of-state hospitals (cross-border worth-the-travel). Winner = the cheapest
  // candidate clearing both the dollar and percentage floors.
  function worthTheTravel(hospitals, anchorState, cfg) {
    cfg = cfg || CONST;
    var withDist = hospitals.filter(function (h) { return h._distance != null; });
    var inState = partitionByState(withDist, anchorState).inState;
    var nearGroup = nearest(inState, cfg.NEAR_VISIBLE_COUNT);
    var nearKeys = {};
    nearGroup.forEach(function (h) { nearKeys[h.key] = true; });
    var localPrices = nearGroup.map(priceOf).filter(function (p) { return p != null; });
    if (!localPrices.length) return null;
    var localBest = Math.min.apply(null, localPrices);

    var candidates = withDist
      .filter(function (h) { return !nearKeys[h.key] && priceOf(h) != null && h._distance <= cfg.WTT_MAX_DISTANCE_MI; })
      .map(function (h) { return Object.assign({}, h, { _savings: localBest - priceOf(h), _localBest: localBest }); })
      .filter(function (h) { return h._savings >= cfg.WTT_MIN_SAVINGS_USD && (h._savings / localBest) >= cfg.WTT_MIN_SAVINGS_PCT; })
      .sort(function (a, b) { return priceOf(a) - priceOf(b); });

    if (!candidates.length) return null;
    return { winner: candidates[0], others: candidates.slice(1) };
  }

  function searchAnchorCandidates(query, data) {
    var q = (query || "").trim().toLowerCase();
    if (!q) return { hospitals: [], places: [] };
    var hospitals = (data.hospitals || []).filter(function (h) {
      return h.name.toLowerCase().indexOf(q) >= 0 ||
        (h.city || "").toLowerCase().indexOf(q) >= 0;
    }).slice(0, 6);

    var places = [];
    var pd = data.places || { zips: {}, towns: [] };
    if (/^\d{3,5}$/.test(q)) {
      Object.keys(pd.zips || {}).forEach(function (z) {
        if (z.indexOf(q) === 0) {
          var p = pd.zips[z];
          places.push({ label: z + " · " + p.place + ", " + p.state, lat: p.lat, lng: p.lng, state: p.state });
        }
      });
    } else {
      (pd.towns || []).forEach(function (t) {
        if (t.name.toLowerCase().indexOf(q) >= 0) {
          places.push({ label: t.name + ", " + t.state, lat: t.lat, lng: t.lng, state: t.state });
        }
      });
      Object.keys(pd.zips || {}).forEach(function (z) {
        var p = pd.zips[z];
        if ((p.place || "").toLowerCase().indexOf(q) >= 0) {
          places.push({ label: z + " · " + p.place + ", " + p.state, lat: p.lat, lng: p.lng, state: p.state });
        }
      });
    }
    return { hospitals: hospitals, places: places.slice(0, 6) };
  }

  var API = {
    CONST: CONST,
    haversineMiles: haversineMiles,
    neighboringStates: neighboringStates,
    withDistance: withDistance,
    partitionByState: partitionByState,
    nearest: nearest,
    worthTheTravel: worthTheTravel,
    searchAnchorCandidates: searchAnchorCandidates,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.STBRelevance = API;
})(typeof window !== "undefined" ? window : globalThis);
