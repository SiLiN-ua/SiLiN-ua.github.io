/* Live counters — DOM stats that grow continuously based on a daily rate.
   Each element carries:
     data-live-counter
     data-base="240"          starting value at data-since 00:00 UTC
     data-per-day="13.5"      average daily increment (fractional OK)
     data-since="2026-07-23"  baseline date, ISO
     data-thousands=" "       optional thousands separator (e.g. " " or ",")

   Behavior:
   - On page load: animates count-up from a starting value to the current
     computed value with a visible per-value flip animation.
   - After that: re-checks every second; when the number actually changes,
     flips the new value in with the same animation. */
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
  function setValue(el, n) {
    var sep = el.dataset.thousands || '';
    el.textContent = format(n, sep);
    el.classList.remove('stat__num--flip');
    void el.offsetWidth;
    el.classList.add('stat__num--flip');
  }
  function countUp(el, from, to, durationMs, done) {
    var steps = Math.max(1, to - from);
    // Cap animation frames to keep it snappy and readable
    var maxSteps = Math.min(steps, 20);
    var stepValues = [];
    for (var i = 1; i <= maxSteps; i++) {
      var v = from + Math.round((to - from) * (i / maxSteps));
      stepValues.push(v);
    }
    if (stepValues[stepValues.length - 1] !== to) stepValues.push(to);
    var interval = Math.max(80, Math.floor(durationMs / stepValues.length));
    var idx = 0;
    function step() {
      setValue(el, stepValues[idx]);
      idx++;
      if (idx < stepValues.length) setTimeout(step, interval);
      else if (done) done();
    }
    step();
  }
  function init(el) {
    var target = compute(el);
    if (target == null) return;
    // Start slightly below the target so users see the flip animation on load.
    var startDelta = Math.min(15, Math.max(3, Math.floor(target * 0.02)));
    var from = Math.max(parseFloat(el.dataset.base), target - startDelta);
    // Cache current shown for later ticks
    el._liveShown = from;
    countUp(el, from, target, 2000, function(){
      el._liveShown = target;
    });
  }
  function tick(el) {
    var target = compute(el);
    if (target == null) return;
    if (target !== el._liveShown) {
      // Real tick: flip through any missed numbers (usually just +1)
      countUp(el, el._liveShown, target, 900, function(){
        el._liveShown = target;
      });
    }
  }
  function tickAll() {
    document.querySelectorAll('[data-live-counter]').forEach(tick);
  }
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('[data-live-counter]').forEach(init);
    // Check every second for real value changes
    setInterval(tickAll, 1000);
  });
})();
