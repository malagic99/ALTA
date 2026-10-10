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
  '.section-head, .step, .card, .science, .timeline li, .member, .callout, .contact-card, .hero-inner, .hero-prism, .band, .arch'
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

// (2) Wang architecture-comparison viz — now lives in /arch-compare.js
//     auto-mounts on [data-arch-compare]; no logic needed here.

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
