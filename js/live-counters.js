/* Live counters — DOM stats that grow continuously based on a daily rate.
   Each element carries:
     data-live-counter
     data-base="240"          starting value at data-since 00:00 UTC
     data-per-day="13.5"      average daily increment (fractional OK)
     data-since="2026-07-23"  baseline date, ISO
     data-thousands=" "       optional thousands separator (e.g. " " or ",")

   Behavior:
   - On page load: count up from 0 to the current computed value with a
     smooth rAF animation (~2.2s, easeOutQuart). Rapid rolling like an
     odometer, ending with a brief glow.
   - After that: polls every 1s; on any real change (natural daily rate),
     a single-value flip animation plays (visible for the +1 tick). */
(function(){
  function format(n, sep) {
    var s = String(n);
    if (!sep) return s;
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }
  function compute(el) {
    var base = parseFloat(el.dataset.base);
    var perDay = parseFloat(el.dataset.perDay);
    var since = el.dataset.since;
    if (!since || isNaN(base) || isNaN(perDay)) return null;
    var anchor = Date.parse(since + 'T00:00:00Z');
    var now = Date.now();
    var days = Math.max(0, (now - anchor) / 86400000);
    return Math.floor(base + days * perDay);
  }
  function write(el, n) {
    var sep = el.dataset.thousands || '';
    el.textContent = format(n, sep);
  }
  function flip(el, n) {
    write(el, n);
    el.classList.remove('stat__num--flip');
    void el.offsetWidth;
    el.classList.add('stat__num--flip');
  }
  // easeOutQuart: fast start, gentle finish
  function easeOutQuart(t){ return 1 - Math.pow(1 - t, 4); }
  function rollTo(el, from, to, durationMs, done) {
    var start = performance.now();
    var range = to - from;
    function frame(now) {
      var t = Math.min(1, (now - start) / durationMs);
      var eased = easeOutQuart(t);
      var current = Math.round(from + range * eased);
      write(el, current);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        write(el, to);
        // Brief settle glow so the end is felt visually
        el.classList.remove('stat__num--settle');
        void el.offsetWidth;
        el.classList.add('stat__num--settle');
        if (done) done();
      }
    }
    requestAnimationFrame(frame);
  }
  function init(el) {
    var target = compute(el);
    if (target == null) return;
    el._liveShown = 0;
    write(el, 0);
    // Slight stagger per element via delay-N class already present.
    // Roll takes 2.2s for a fast, readable count-up.
    rollTo(el, 0, target, 2200, function(){
      el._liveShown = target;
    });
  }
  function tick(el) {
    if (el._liveShown == null) return;
    var target = compute(el);
    if (target == null) return;
    if (target !== el._liveShown) {
      // Real daily-rate tick (usually +1) — use flip animation
      flip(el, target);
      el._liveShown = target;
    }
  }
  function tickAll() {
    document.querySelectorAll('[data-live-counter]').forEach(tick);
  }
  function boot() {
    document.querySelectorAll('[data-live-counter]').forEach(init);
    setInterval(tickAll, 1000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
