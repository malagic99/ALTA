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
