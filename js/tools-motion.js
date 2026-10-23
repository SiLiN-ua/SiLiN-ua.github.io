(() => {
  const panel = document.querySelector('.tools-hero__map');
  if (!panel) return;
  const svg = panel.querySelector('svg');
  const ns = 'http://www.w3.org/2000/svg';
  const paths = [...svg.querySelectorAll('path')];
  const nodes = [...svg.querySelectorAll('circle')];
  const labels = [...panel.querySelectorAll('.tools-hero__protocol b')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const tracks = paths.map((path, index) => {
    const length = path.getTotalLength();
    const trail = path.cloneNode();
    trail.style.cssText = 'stroke:#a8d9cb;stroke-width:1.8;fill:none;opacity:.8';
    trail.style.strokeDasharray = `24 ${length}`;
    svg.append(trail);
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', '2.5');
    dot.style.cssText = 'fill:#c4e4d9;stroke:#a8d9cb;stroke-width:7;stroke-opacity:.12';
    svg.append(dot);
    return { path, length, trail, dot, offset: index * .27 };
  });
  const rings = nodes.map(node => {
    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', node.getAttribute('cx'));
    ring.setAttribute('cy', node.getAttribute('cy'));
    ring.style.cssText = 'fill:none;stroke:#a8d9cb;stroke-width:1';
    svg.append(ring);
    return ring;
  });
  let visible = true, frame = 0, previous = 0, elapsed = 0;
  let targetX = 0, targetY = 0, x = 0, y = 0;
  const allowed = () => visible && !document.hidden && !reduced.matches && !document.body.classList.contains('dossier-paused');
  function draw(time) {
    frame = 0;
    if (!allowed()) return;
    elapsed += previous ? Math.min(time - previous, 50) : 0;
    previous = time;
    const cycle = elapsed / 6500;
    tracks.forEach(({path, length, trail, dot, offset}) => {
      const progress = (cycle + offset) % 1;
      const point = path.getPointAtLength(progress * length);
      dot.setAttribute('cx', point.x);
      dot.setAttribute('cy', point.y);
      trail.style.strokeDashoffset = String(24 - progress * length);
    });
    rings.forEach((ring, i) => {
      const phase = (cycle * 2 + i * .21) % 1;
      ring.setAttribute('r', 7 + phase * 20);
      ring.style.opacity = String((1 - phase) * .38);
    });
    labels.forEach((label, i) => {
      const active = Math.floor((cycle % 1) * 3) === i;
      label.style.color = active ? '#c4e4d9' : '#59747e';
      label.style.textShadow = active ? '0 0 14px #a8d9cb44' : 'none';
    });
    x += (targetX - x) * .045;
    y += (targetY - y) * .045;
    svg.style.transform = `translate(${x}px, ${y}px)`;
    frame = requestAnimationFrame(draw);
  }
  function sync() {
    if (!allowed()) {
      cancelAnimationFrame(frame); frame = 0; previous = 0;
    } else if (!frame) frame = requestAnimationFrame(draw);
  }
  panel.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || !allowed()) return;
    const bounds = panel.getBoundingClientRect();
    targetX = ((event.clientX - bounds.left) / bounds.width - .5) * 12;
    targetY = ((event.clientY - bounds.top) / bounds.height - .5) * 10;
  });
  panel.addEventListener('pointerleave', () => { targetX = targetY = 0; });
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }).observe(panel);
  new MutationObserver(sync).observe(document.body, {attributes:true, attributeFilter:['class']});
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  // Keep the original diagram intact when motion is disabled from the start.
  tracks.forEach(({dot, trail}) => { dot.setAttribute('cx', '-50'); dot.setAttribute('cy', '-50'); trail.style.strokeDashoffset = '24'; });
  rings.forEach(ring => ring.style.opacity = '0');
  sync();
})();
