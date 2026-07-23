/* Live counters — DOM stats that grow continuously based on a daily rate.
   Each element carries:
     data-live-counter
     data-base="240"          starting value at data-since 00:00 UTC
     data-per-day="13.5"      average daily increment (fractional OK)
     data-since="2026-07-23"  baseline date, ISO
     data-suffix="+"          optional string appended to the number
     data-thousands=" "       optional thousands separator (e.g. " " or ",")
   Recomputes every 30 seconds so the number reflects the current time.
   On value change, briefly highlights via a CSS class. */
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
    // Anchor: `since` at 00:00 UTC
    var anchor = Date.parse(since + 'T00:00:00Z');
    var now = Date.now();
    var days = Math.max(0, (now - anchor) / 86400000);
    return Math.floor(base + days * perDay);
  }
  function apply(el) {
    var n = compute(el);
    if (n == null) return;
    var sep = el.dataset.thousands || '';
    var suf = el.dataset.suffix || '';
    var next = format(n, sep) + suf;
    if (el.textContent !== next) {
      el.textContent = next;
      el.classList.remove('stat__num--tick');
      // force reflow to restart animation
      void el.offsetWidth;
      el.classList.add('stat__num--tick');
    }
  }
  function tickAll() {
    document.querySelectorAll('[data-live-counter]').forEach(apply);
  }
  document.addEventListener('DOMContentLoaded', function(){
    tickAll();
    setInterval(tickAll, 30000);
  });
})();
