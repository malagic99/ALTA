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

// (2) Wang interactive chart — slider drives O(N²) digital curve vs O(1) photonic line
(() => {
  const slider = document.getElementById('wangN');
  const out = document.getElementById('wangNValue');
  const ratioEl = document.getElementById('wangRatio');
  const svg = document.querySelector('.wang-chart-svg');
  if (!slider || !svg) return;

  const digitalPath = svg.querySelector('.wang-digital');
  const digitalFill = svg.querySelector('.wang-digital-fill');
  const markerLine  = svg.querySelector('.wang-marker-line');
  const markerD     = svg.querySelector('.wang-marker-digital');
  const markerP     = svg.querySelector('.wang-marker-photonic');

  // Chart geometry inside viewBox (0..600 x 0..280)
  const X0 = 60, X1 = 580;      // x-axis pixel range
  const Y_TOP = 40, Y_BOT = 240; // y-axis pixel range
  const N_MIN = 10, N_MAX = 1000;
  // Log scale: 10¹ at y=Y_BOT-... wait, y=220 is photonic baseline.
  // We map energy 1..10000 onto y 220..40. log10(1)=0 -> 220, log10(10⁴)=4 -> 40.
  // So y(e) = 220 - (log10(e) / 4) * 180
  const PHOTONIC_BASE_Y = 220;
  const TOP_Y = 40;
  const yForEnergy = (e) => {
    const logE = Math.log10(Math.max(1, e));
    return PHOTONIC_BASE_Y - (logE / 4) * (PHOTONIC_BASE_Y - TOP_Y);
  };
  const xForN = (n) => X0 + ((n - N_MIN) / (N_MAX - N_MIN)) * (X1 - X0);
  const energyDigital = (n) => Math.pow(n / N_MIN, 2);   // normalized: 1 at N=10

  // Build the digital curve once (it's static; only the marker moves with slider)
  let stroke = 'M';
  let fill = `M ${X0} ${PHOTONIC_BASE_Y}`;
  for (let n = N_MIN; n <= N_MAX; n += 5) {
    const x = xForN(n);
    const y = yForEnergy(energyDigital(n));
    stroke += ` ${x.toFixed(1)} ${y.toFixed(1)}`;
    fill += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  fill += ` L ${X1} ${PHOTONIC_BASE_Y} Z`;
  digitalPath.setAttribute('d', stroke);
  digitalFill.setAttribute('d', fill);

  const fmt = (n) => {
    if (n >= 1000) return `${Math.round(n / 100) / 10}k×`;
    if (n >= 100)  return `${Math.round(n)}×`;
    if (n >= 10)   return `${Math.round(n)}×`;
    return `${n.toFixed(1)}×`;
  };

  const update = () => {
    const n = Number(slider.value);
    const x = xForN(n);
    const yDigital = yForEnergy(energyDigital(n));
    markerLine.setAttribute('x1', x); markerLine.setAttribute('x2', x);
    markerD.setAttribute('cx', x); markerD.setAttribute('cy', yDigital);
    markerP.setAttribute('cx', x);
    out.value = n;
    const ratio = energyDigital(n);
    ratioEl.textContent = fmt(ratio);
  };
  slider.addEventListener('input', update);
  update();
})();

// (3) Anomaly response simulator — staged pulse with timing readouts
(() => {
  const sim = document.querySelector('.anomaly-sim');
  if (!sim) return;
  const trigger = sim.querySelector('.anomaly-trigger');
  const pulse = sim.querySelector('.anomaly-sim-pulse');
  const status = sim.querySelector('.anomaly-status');
  const stages = Array.from(sim.querySelectorAll('.anomaly-stage'));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Stage timing copy (display only; actual animation pacing below)
  const timing = ['0.4 ns', '1.2 ns', '2 ns', '~1 μs'];

  const reset = () => {
    sim.dataset.state = 'idle';
    stages.forEach((s, i) => {
      s.classList.remove('is-active', 'is-done');
      s.querySelector('.anomaly-stage-time').textContent = '— ' + (i < 3 ? 'ns' : 'μs');
    });
    pulse.style.left = '14%';
    pulse.style.opacity = '0';
    status.textContent = 'Idle · awaiting event';
    trigger.disabled = false;
  };

  // Stage positions across the rail (visual stops: 0%, 33%, 66%, 100% along the rail
  // which sits from 14% to 86% of the track width)
  const stagePositions = [14, 38, 62, 86];

  const run = () => {
    trigger.disabled = true;
    sim.dataset.state = 'running';
    status.textContent = 'Thermal anomaly detected · propagating…';
    pulse.style.opacity = '1';
    pulse.style.left = stagePositions[0] + '%';

    // Stage-by-stage activation with realistic-looking timing copy
    const stepDuration = reduced ? 250 : 700;
    stages.forEach((stage, i) => {
      setTimeout(() => {
        stage.classList.add('is-active');
        stage.querySelector('.anomaly-stage-time').textContent = timing[i];
        if (i > 0) {
          stages[i - 1].classList.remove('is-active');
          stages[i - 1].classList.add('is-done');
        }
        pulse.style.transition = `left ${stepDuration / 1000}s cubic-bezier(.4, .8, .4, 1)`;
        if (i < stages.length - 1) {
          pulse.style.left = stagePositions[i + 1] + '%';
        }
        if (i === 2) status.textContent = 'Decision: vent · dispatching command…';
        if (i === stages.length - 1) {
          setTimeout(() => {
            stage.classList.remove('is-active');
            stage.classList.add('is-done');
            sim.dataset.state = 'done';
            pulse.style.opacity = '0';
            status.textContent = 'Autonomous venting initiated · zero ground latency';
            trigger.disabled = false;
          }, stepDuration * 0.7);
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
