// Anchor persistence + lazy places loader. The anchor is a personal lens kept in
// localStorage (never the URL). No DOM here; the control lives in app.js.
(function () {
  "use strict";
  var KEY = "stb:anchor";
  var placesCache = null;

  function get() {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; }
  }
  function set(anchor) {
    try { localStorage.setItem(KEY, JSON.stringify(anchor)); } catch (e) {}
  }
  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }
  function loadPlaces() {
    if (placesCache) return Promise.resolve(placesCache);
    return fetch("places.json")
      .then(function (r) { return r.ok ? r.json() : { zips: {}, towns: [] }; })
      .catch(function () { return { zips: {}, towns: [] }; })
      .then(function (doc) { placesCache = doc; return doc; });
  }

  window.STBAnchor = { get: get, set: set, clear: clear, loadPlaces: loadPlaces };
})();
