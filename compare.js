// Compare-set state: a list of hospital keys the user pins to compare, persisted
// locally and shared across procedures (switch procedures, the set re-prices).
(function () {
  "use strict";
  var KEY = "stb:compare";
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function write(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  function list() { return read(); }
  function has(key) { return read().indexOf(key) >= 0; }
  function toggle(key) {
    var a = read(), i = a.indexOf(key);
    if (i >= 0) a.splice(i, 1); else a.push(key);
    write(a);
  }
  function clear() { write([]); }
  window.STBCompare = { list: list, has: has, toggle: toggle, clear: clear };
})();
