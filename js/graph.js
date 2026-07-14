/* Star + network graph background.
   - Star field: dim + bright + shooting stars
   - Interactive node graph in hero (mouse-reactive)
*/
(function () {
  'use strict';

  /* ---------- STAR CANVAS (global) ---------- */
  let paused = false;
  document.addEventListener('visibilitychange', () => { paused = document.hidden; });

  function starField() {
    const c = document.getElementById('stars');
    if (!c) return;
    const ctx = c.getContext('2d');
    let w, h, stars;
    const N = 120;

    function resize() {
      w = c.width  = window.innerWidth  * devicePixelRatio;
      h = c.height = window.innerHeight * devicePixelRatio;
      c.style.width  = window.innerWidth + 'px';
      c.style.height = window.innerHeight + 'px';
      stars = Array.from({ length: N }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.2 * devicePixelRatio + .2 * devicePixelRatio,
        a: Math.random() * .6 + .2,
        s: Math.random() * .015 + .005,
        p: Math.random() * Math.PI * 2,
      }));
    }
    resize();
    window.addEventListener('resize', resize);

    let shooter = null;
    function maybeShoot() {
      if (shooter || Math.random() > .002) return;
      shooter = {
        x: Math.random() * w * .6,
        y: Math.random() * h * .4,
        vx: (6 + Math.random() * 4) * devicePixelRatio,
        vy: (2 + Math.random() * 2) * devicePixelRatio,
        life: 0, max: 60
      };
    }

    function draw() {
      if (paused) { requestAnimationFrame(draw); return; }
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.p += s.s;
        const twinkle = .6 + Math.sin(s.p) * .4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 220, 255, ${s.a * twinkle})`;
        ctx.fill();
      }
      maybeShoot();
      if (shooter) {
        shooter.life++;
        const alpha = 1 - shooter.life / shooter.max;
        const tailX = shooter.x - shooter.vx * 8;
        const tailY = shooter.y - shooter.vy * 8;
        const grad = ctx.createLinearGradient(tailX, tailY, shooter.x, shooter.y);
        grad.addColorStop(0, 'rgba(110, 168, 255, 0)');
        grad.addColorStop(1, `rgba(200, 220, 255, ${alpha})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.2 * devicePixelRatio;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(shooter.x, shooter.y);
        ctx.stroke();
        shooter.x += shooter.vx;
        shooter.y += shooter.vy;
        if (shooter.life > shooter.max) shooter = null;
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  /* ---------- HERO NETWORK GRAPH ---------- */
  function heroGraph() {
    const c = document.getElementById('hero-graph');
    if (!c) return;
    const ctx = c.getContext('2d');
    let w, h, nodes, mouse = { x: -1000, y: -1000 };
    const NODES = 55;
    const MAX_DIST = 180;

    function resize() {
      const parent = c.parentElement;
      w = c.width  = parent.offsetWidth  * devicePixelRatio;
      h = c.height = parent.offsetHeight * devicePixelRatio;
      c.style.width  = parent.offsetWidth + 'px';
      c.style.height = parent.offsetHeight + 'px';
      nodes = Array.from({ length: NODES }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - .5) * .3 * devicePixelRatio,
        vy: (Math.random() - .5) * .3 * devicePixelRatio,
        r: (Math.random() * 2 + 1.2) * devicePixelRatio,
        pulse: Math.random() * Math.PI * 2,
      }));
    }
    resize();
    window.addEventListener('resize', resize);

    c.parentElement.addEventListener('mousemove', (e) => {
      const rect = c.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left) * devicePixelRatio;
      mouse.y = (e.clientY - rect.top)  * devicePixelRatio;
    });
    c.parentElement.addEventListener('mouseleave', () => { mouse.x = -1000; mouse.y = -1000; });

    const MD2 = (MAX_DIST * devicePixelRatio) ** 2;
    const MOUSE_R2 = (140 * devicePixelRatio) ** 2;

    function draw() {
      ctx.clearRect(0, 0, w, h);

      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;

        const dxm = n.x - mouse.x, dym = n.y - mouse.y;
        const dm2 = dxm * dxm + dym * dym;
        if (dm2 < MOUSE_R2) {
          const f = 1 - dm2 / MOUSE_R2;
          n.x += (dxm / Math.sqrt(dm2 + 1)) * f * 1.5;
          n.y += (dym / Math.sqrt(dm2 + 1)) * f * 1.5;
        }
      }

      /* edges */
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < MD2) {
            const alpha = (1 - d2 / MD2) * .5;
            ctx.strokeStyle = `rgba(74, 158, 255, ${alpha})`;
            ctx.lineWidth = 1 * devicePixelRatio;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      /* mouse edges */
      for (const n of nodes) {
        const dxm = n.x - mouse.x, dym = n.y - mouse.y;
        const dm2 = dxm * dxm + dym * dym;
        if (dm2 < MOUSE_R2) {
          const alpha = (1 - dm2 / MOUSE_R2) * .8;
          ctx.strokeStyle = `rgba(79, 209, 255, ${alpha})`;
          ctx.lineWidth = 1.2 * devicePixelRatio;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }

      /* nodes */
      for (const n of nodes) {
        n.pulse += .04;
        const glow = 1 + Math.sin(n.pulse) * .3;
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 4 * glow);
        grad.addColorStop(0, 'rgba(110, 168, 255, .8)');
        grad.addColorStop(.4, 'rgba(74, 158, 255, .3)');
        grad.addColorStop(1, 'rgba(74, 158, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 4 * glow, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#e6edfb';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(draw);
    }
    draw();
  }

  function init() {
    starField();
    heroGraph();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
