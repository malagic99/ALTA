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

// (1) FLP step expander — in-place expansion; clicked card spans full row and reveals detail
(() => {
  const steps = document.querySelectorAll('.step[data-step]');
  if (!steps.length) return;

  const closeAll = () => {
    steps.forEach(s => {
      s.classList.remove('is-expanded');
      s.setAttribute('aria-expanded', 'false');
      const exp = s.querySelector('.step-expand');
      if (exp) exp.hidden = true;
    });
  };

  const open = (step) => {
    closeAll();
    step.classList.add('is-expanded');
    step.setAttribute('aria-expanded', 'true');
    const exp = step.querySelector('.step-expand');
    if (exp) exp.hidden = false;
    // Gentle scroll-into-view if the bottom of the card is below the fold
    setTimeout(() => {
      const rect = step.getBoundingClientRect();
      if (rect.top < 80) {
        window.scrollBy({ top: rect.top - 90, behavior: 'smooth' });
      }
    }, 60);
  };

  steps.forEach(step => {
    const trigger = () => {
      const isOpen = step.classList.contains('is-expanded');
      if (isOpen) closeAll(); else open(step);
    };
    step.addEventListener('click', (e) => {
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
})();

// (2) Wang chip-footprint viz — toggle task complexity; photonic die stays small, silicon grows
(() => {
  const viz = document.querySelector('.wang-viz');
  if (!viz) return;
  const taskBtns = viz.querySelectorAll('.wang-task-btn');
  const siliconSvg = viz.querySelector('.wang-chip-svg-silicon');
  const siliconDie = viz.querySelector('.wang-silicon-die');
  const coresG = viz.querySelector('.wang-silicon-cores');
  const heatG  = viz.querySelector('.wang-silicon-heat');
  if (!siliconSvg || !coresG) return;

  // Per-task chip data. Numbers are illustrative — area ~linear in N, energy ~N² per Wang 2025.
  const tasks = {
    low: {
      svg:   { w: 130, h: 84  },
      die:   { x: 3, y: 3, rxKey: 5 },
      cores: { cols: 4, rows: 2 },
      heat:  [[0.35, 0.5]],
      label: 'single-sensor',
      frame: 'fingernail',
      footprint: '~1.5 cm²',
      coresLabel: '~8 cores',
      power: '~80 mW',
      areaFactor: '~1.5×',
      powerFactor: '~16×',
    },
    medium: {
      svg:   { w: 220, h: 140 },
      cores: { cols: 8, rows: 5 },
      heat:  [[0.30, 0.4], [0.70, 0.65]],
      label: 'anomaly-classification',
      frame: 'credit card',
      footprint: '~6 cm²',
      coresLabel: '~40 cores',
      power: '~3 W',
      areaFactor: '~6×',
      powerFactor: '~600×',
    },
    high: {
      svg:   { w: 340, h: 218 },
      cores: { cols: 14, rows: 9 },
      heat:  [[0.22, 0.35], [0.55, 0.55], [0.82, 0.7]],
      label: 'full-autonomy',
      frame: 'paperback',
      footprint: '~15 cm²',
      coresLabel: '~126 cores',
      power: '~25 W',
      areaFactor: '~15×',
      powerFactor: '~5 000×',
    },
  };

  const setTask = (task) => {
    const d = tasks[task];
    if (!d) return;
    viz.dataset.task = task;

    // Resize the SVG (viewBox + width/height) and the die rectangle
    siliconSvg.setAttribute('viewBox', `0 0 ${d.svg.w} ${d.svg.h}`);
    siliconDie.setAttribute('width',  d.svg.w - 6);
    siliconDie.setAttribute('height', d.svg.h - 6);

    // Lay out the cores grid inside the die
    const padX = 14, padY = 14;
    const innerW = d.svg.w - 2 * padX;
    const innerH = d.svg.h - 2 * padY;
    const cellW = innerW / d.cores.cols;
    const cellH = innerH / d.cores.rows;
    const coreSize = Math.max(2.5, Math.min(cellW, cellH) * 0.55);
    let coresHtml = '';
    for (let r = 0; r < d.cores.rows; r++) {
      for (let c = 0; c < d.cores.cols; c++) {
        const cx = padX + c * cellW + cellW / 2;
        const cy = padY + r * cellH + cellH / 2;
        const opacity = 0.45 + Math.random() * 0.35;
        coresHtml += `<rect x="${(cx - coreSize/2).toFixed(2)}" y="${(cy - coreSize/2).toFixed(2)}" width="${coreSize.toFixed(2)}" height="${coreSize.toFixed(2)}" rx=".8" opacity="${opacity.toFixed(2)}"/>`;
      }
    }
    coresG.innerHTML = coresHtml;

    // Heat blobs scaled to the die area; cycle their radius via SMIL
    let heatHtml = '';
    const heatR = Math.min(d.svg.w, d.svg.h) * 0.22;
    d.heat.forEach(([fx, fy], i) => {
      const cx = padX + fx * innerW;
      const cy = padY + fy * innerH;
      const dur = 3.6 + i * 0.4;
      const begin = (i * 1.2).toFixed(2);
      heatHtml += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="0" fill="url(#wangSiliconHeat)"><animate attributeName="r" values="0;${heatR.toFixed(1)};0" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
    });
    heatG.innerHTML = heatHtml;

    // Update spec readouts
    viz.querySelector('[data-spec="frame"]').textContent = d.frame;
    viz.querySelector('[data-spec="footprint"]').textContent = d.footprint;
    viz.querySelector('[data-spec="cores"]').textContent = d.coresLabel;
    viz.querySelector('[data-spec="power"]').textContent = d.power;

    // Update buttons
    taskBtns.forEach(btn => {
      const active = btn.dataset.task === task;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    // Update takeaway line
    viz.querySelector('.wang-takeaway-task').textContent = d.label;
    viz.querySelector('[data-show="area"]').textContent  = `${d.areaFactor} the die area`;
    viz.querySelector('[data-show="power"]').textContent = `${d.powerFactor} the power`;
  };

  taskBtns.forEach(btn => btn.addEventListener('click', () => setTask(btn.dataset.task)));
  setTask('medium');
})();

// (3) Anomaly response simulator — collapsed by default; expand → trigger → stage-by-stage reveal
(() => {
  const sim = document.querySelector('.anomaly-sim');
  if (!sim) return;
  const launch = sim.querySelector('.anomaly-launch');
  const runner = sim.querySelector('.anomaly-runner');
  const trigger = sim.querySelector('.anomaly-trigger');
  const status = sim.querySelector('.anomaly-status');
  const stages = Array.from(sim.querySelectorAll('.anomaly-stage'));
  if (!launch || !runner || !trigger) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const timing = ['0.4 ns', '1.2 ns', '2 ns', '~1 μs'];
  const statusByStage = [
    'Thermal anomaly detected · sensing…',
    'Pattern matched · inferring response…',
    'Decision: vent · dispatching command…',
    'Autonomous venting initiated · zero ground latency',
  ];

  const resetStages = () => {
    stages.forEach((s, i) => {
      s.classList.remove('is-active', 'is-done');
      s.querySelector('.anomaly-stage-time').textContent = '— ' + (i < 3 ? 'ns' : 'μs');
    });
  };

  const collapse = () => {
    sim.dataset.state = 'collapsed';
    launch.setAttribute('aria-expanded', 'false');
    runner.hidden = true;
    resetStages();
    status.textContent = 'Awaiting trigger…';
    trigger.disabled = false;
  };

  const expand = () => {
    sim.dataset.state = 'open';
    launch.setAttribute('aria-expanded', 'true');
    runner.hidden = false;
    resetStages();
    status.textContent = 'Awaiting trigger…';
    trigger.disabled = false;
  };

  const run = () => {
    trigger.disabled = true;
    sim.dataset.state = 'running';
    resetStages();
    const stepDuration = reduced ? 320 : 950;

    stages.forEach((stage, i) => {
      setTimeout(() => {
        if (i > 0) {
          stages[i - 1].classList.remove('is-active');
          stages[i - 1].classList.add('is-done');
        }
        stage.classList.add('is-active');
        stage.querySelector('.anomaly-stage-time').textContent = timing[i];
        status.textContent = statusByStage[i];

        if (i === stages.length - 1) {
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

  launch.addEventListener('click', () => {
    if (sim.dataset.state === 'collapsed') expand(); else collapse();
  });
  trigger.addEventListener('click', () => {
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
