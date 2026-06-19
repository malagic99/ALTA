// Year
document.getElementById('year').textContent = new Date().getFullYear();

// Theme toggle — delegate from document so it survives any re-render or
// timing weirdness. Initial value is set by the inline <head> script.
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest('#themeToggle');
  if (!t) return;
  e.preventDefault();
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  try { localStorage.setItem('alta-theme', next); } catch (err) {}
});

// Sticky nav state
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 12);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// Mobile menu
const toggle = document.getElementById('navToggle');
const links = document.querySelector('.nav-links');
toggle?.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
});
links?.querySelectorAll('a').forEach(a =>
  a.addEventListener('click', () => {
    links.classList.remove('open');
    toggle?.setAttribute('aria-expanded', 'false');
  })
);

// Progress dots — active state tracks which section is in view
(() => {
  const dots = document.querySelectorAll('.progress-dots a');
  if (!dots.length) return;
  const map = new Map();
  dots.forEach(a => {
    const id = a.getAttribute('data-section');
    const target = id === 'top' ? document.getElementById('top') : document.getElementById(id);
    if (target) map.set(target, a);
  });
  const setActive = (a) => {
    dots.forEach(d => d.classList.toggle('active', d === a));
  };
  const obs = new IntersectionObserver((entries) => {
    // Pick the entry closest to the top of the viewport
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length) {
      const a = map.get(visible[0].target);
      if (a) setActive(a);
    }
  }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
  map.forEach((_, el) => obs.observe(el));
})();

// Reveal on scroll
const revealTargets = document.querySelectorAll(
  '.section-head, .step, .card, .science, .timeline li, .member, .callout, .contact-card, .hero-inner, .hero-prism, .band'
);
revealTargets.forEach(el => el.classList.add('reveal'));
const io = new IntersectionObserver(
  entries => entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }),
  { threshold: 0.12 }
);
revealTargets.forEach(el => io.observe(el));

// ===== Interactive features =====

// (1) FLP step expander — click a card, panel slides in below with schematic + explainer
(() => {
  const steps = document.querySelectorAll('.step[data-step]');
  const panel = document.getElementById('step-detail-panel');
  if (!steps.length || !panel) return;
  const inner = panel.querySelector('.step-detail-inner');
  const closeBtn = panel.querySelector('.step-detail-close');

  const close = (focusReturn) => {
    panel.hidden = true;
    panel.classList.remove('is-open');
    steps.forEach(s => s.setAttribute('aria-expanded', 'false'));
    if (focusReturn) focusReturn.focus();
  };

  const open = (n) => {
    const tpl = document.getElementById(`step-template-${n}`);
    if (!tpl) return;
    const fragment = tpl.content.cloneNode(true);
    // Fade out current content, swap, fade in
    if (!panel.hidden) {
      panel.classList.add('is-animating');
      setTimeout(() => {
        inner.innerHTML = '';
        inner.appendChild(fragment);
        panel.classList.remove('is-animating');
      }, 180);
    } else {
      inner.innerHTML = '';
      inner.appendChild(fragment);
      panel.hidden = false;
      requestAnimationFrame(() => panel.classList.add('is-open'));
    }
    steps.forEach(s => {
      s.setAttribute('aria-expanded', s.dataset.step === String(n) ? 'true' : 'false');
    });
    // Scroll into view if needed (gentle nudge, not jarring jump)
    setTimeout(() => {
      const rect = panel.getBoundingClientRect();
      if (rect.bottom > window.innerHeight) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 220);
  };

  steps.forEach(step => {
    const trigger = () => {
      const n = Number(step.dataset.step);
      const isOpen = step.getAttribute('aria-expanded') === 'true';
      if (isOpen) close(step); else open(n);
    };
    step.addEventListener('click', (e) => {
      // Don't trigger if user clicked an internal link inside the card
      if (e.target.closest('a')) return;
      trigger();
    });
    step.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger();
      }
    });
  });
  closeBtn?.addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) close();
  });
})();

// (2) Wang architecture toggle — Photonic FLP vs Silicon Digital
(() => {
  const viz = document.querySelector('.wang-viz');
  if (!viz) return;
  const buttons = viz.querySelectorAll('.wang-toggle-btn');
  const archs   = viz.querySelectorAll('.wang-arch');
  const stats   = viz.querySelectorAll('.wang-stat');

  // Distribute N virtual neurons around the photonic fiber loop
  const photoNeurons = viz.querySelector('.wang-photonic-neurons');
  if (photoNeurons) {
    const cx = 210, cy = 140, rx = 135, ry = 85;
    const count = 36;
    let html = '';
    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 2;
      const x = cx + rx * Math.cos(t);
      const y = cy + ry * Math.sin(t);
      html += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5"/>`;
    }
    photoNeurons.innerHTML = html;
  }

  // Lay out the silicon node grid + spaghetti interconnects
  const silNodes = viz.querySelector('.wang-silicon-nodes');
  const silConn  = viz.querySelector('.wang-silicon-connections');
  if (silNodes && silConn) {
    const cols = 18, rows = 9;
    const left = 40, top = 50, gx = 19, gy = 18;
    const pts = [];
    let nodeHtml = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = left + c * gx;
        const y = top + r * gy;
        pts.push([x, y]);
        nodeHtml += `<rect x="${x - 2.5}" y="${y - 2.5}" width="5" height="5" rx=".8"/>`;
      }
    }
    silNodes.innerHTML = nodeHtml;
    // Sparse but recognisably crisscross interconnects
    let connHtml = '';
    const total = 110;
    for (let i = 0; i < total; i++) {
      const a = pts[(i * 31) % pts.length];
      const b = pts[(i * 71 + 5) % pts.length];
      if (a === b) continue;
      connHtml += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
    }
    silConn.innerHTML = connHtml;
  }

  const setArch = (target) => {
    viz.dataset.arch = target;
    buttons.forEach(btn => {
      const active = btn.dataset.arch === target;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    archs.forEach(svg => {
      const show = svg.dataset.arch === target;
      svg.hidden = !show;
      // wait a frame so the transition kicks in after hidden flip
      requestAnimationFrame(() => svg.classList.toggle('is-active', show));
    });
    stats.forEach(stat => {
      const show = stat.dataset.show === target;
      stat.hidden = !show;
    });
  };
  buttons.forEach(btn => btn.addEventListener('click', () => setArch(btn.dataset.arch)));
  // initial pulse to settle animation state
  setArch('photonic');
})();

// (3) Anomaly response simulator — stage-by-stage activation, layout-agnostic
(() => {
  const sim = document.querySelector('.anomaly-sim');
  if (!sim) return;
  const trigger = sim.querySelector('.anomaly-trigger');
  const status = sim.querySelector('.anomaly-status');
  const stages = Array.from(sim.querySelectorAll('.anomaly-stage'));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const timing = ['0.4 ns', '1.2 ns', '2 ns', '~1 μs'];
  const statusByStage = [
    'Thermal anomaly detected · sensing…',
    'Pattern matched · inferring response…',
    'Decision: vent · dispatching command…',
    'Autonomous venting initiated · zero ground latency',
  ];

  const reset = () => {
    sim.dataset.state = 'idle';
    stages.forEach((s, i) => {
      s.classList.remove('is-active', 'is-done');
      s.querySelector('.anomaly-stage-time').textContent = '— ' + (i < 3 ? 'ns' : 'μs');
    });
    status.textContent = 'Idle · awaiting event';
    trigger.disabled = false;
  };

  const run = () => {
    trigger.disabled = true;
    sim.dataset.state = 'running';
    const stepDuration = reduced ? 320 : 700;

    stages.forEach((stage, i) => {
      setTimeout(() => {
        // Carry the previous stage from active to done so the rail "fills"
        if (i > 0) {
          stages[i - 1].classList.remove('is-active');
          stages[i - 1].classList.add('is-done');
        }
        stage.classList.add('is-active');
        stage.querySelector('.anomaly-stage-time').textContent = timing[i];
        status.textContent = statusByStage[i];

        if (i === stages.length - 1) {
          // Hold the last active state briefly, then settle to "done"
          setTimeout(() => {
            stage.classList.remove('is-active');
            stage.classList.add('is-done');
            sim.dataset.state = 'done';
            trigger.disabled = false;
          }, stepDuration * 0.9);
        }
      }, i * stepDuration);
    });
  };

  trigger.addEventListener('click', () => {
    if (sim.dataset.state === 'done') reset();
    requestAnimationFrame(run);
  });
})();

// (4) Roadmap phase drill-down — exclusive accordion (only one open at a time)
(() => {
  const items = document.querySelectorAll('.tl-item');
  if (!items.length) return;
  items.forEach(item => {
    const btn = item.querySelector('.tl-toggle');
    const panel = item.querySelector('.tl-detail');
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      // Close all
      items.forEach(other => {
        const b = other.querySelector('.tl-toggle');
        const p = other.querySelector('.tl-detail');
        if (b && p) { b.setAttribute('aria-expanded', 'false'); p.hidden = true; }
      });
      if (!isOpen) {
        btn.setAttribute('aria-expanded', 'true');
        panel.hidden = false;
      }
    });
  });
})();

// Starfield
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let stars = [];
  let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

  const resize = () => {
    w = canvas.width = window.innerWidth * dpr;
    h = canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    const count = Math.floor((window.innerWidth * window.innerHeight) / 9000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.2 * dpr + 0.2 * dpr,
      a: Math.random() * 0.8 + 0.2,
      s: Math.random() * 0.4 + 0.05,
      tw: Math.random() * Math.PI * 2,
    }));
  };

  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const flicker = reduced ? s.a : s.a * (0.7 + 0.3 * Math.sin(t * 0.002 + s.tw));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220, 230, 255, ${flicker})`;
      ctx.fill();
      if (!reduced) {
        s.y += s.s * dpr * 0.2;
        if (s.y > h) { s.y = 0; s.x = Math.random() * w; }
      }
    }
    requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(draw);
})();
