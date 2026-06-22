(function () {
  // Parse location.hash (or a given string) into view state {mode, cpt, hospital}.
  function parse(hash) {
    const h = (hash == null ? location.hash : hash).replace(/^#/, "");
    const legacy = h.match(/^h=([\w-]+)&p=([\w]{5})$/); // legacy deep link #h=<key>&p=<cpt>
    if (legacy) return { mode: "shop", cpt: legacy[2], hospital: legacy[1], legacy: true };
    const m = h.match(/^\/(shop|bill)(?:\/([\w]{5}))?(?:\/([\w-]+))?$/);
    if (m) return { mode: m[1], cpt: m[2] || null, hospital: m[3] || null };
    return { mode: "shop", cpt: null, hospital: null };
  }

  // Build a canonical hash from state.
  function toHash(s) {
    let out = "#/" + (s.mode || "shop");
    if (s.cpt) {
      out += "/" + s.cpt;
      if (s.hospital) out += "/" + s.hospital;
    }
    return out;
  }

  const listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emit() {
    const s = parse();
    listeners.forEach((fn) => fn(s));
  }

  function go(s) {
    const target = toHash(s);
    if (location.hash === target) emit();   // same route → re-render anyway
    else location.hash = target;            // triggers hashchange
  }

  window.addEventListener("hashchange", function () {
    const s = parse();
    if (s.legacy) { location.replace(toHash(s)); return; } // rewrite legacy, no extra history entry
    emit();
  });

  window.Router = { parse: parse, toHash: toHash, go: go, onChange: onChange, current: function () { return parse(); } };
})();
