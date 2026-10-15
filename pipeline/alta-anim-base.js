/* ALTA pipeline "Look inside" animations — shared base. Load before the alta-*.js components. */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const KEBAB = /^(strokeWidth|strokeDasharray|strokeDashoffset|strokeLinecap|strokeLinejoin|fontFamily|fontSize|fontWeight|textAnchor|stopColor|stopOpacity|letterSpacing)$/;
  function h(tag, props, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null) continue;
      if (k === 'ref') { v(el); continue; }
      el.setAttribute(KEBAB.test(k) ? k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()) : k, v);
    }
    (function add(l) { for (const c of l) { if (c == null || c === false) continue; if (Array.isArray(c)) add(c); else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c))); } })(kids);
    return el;
  }
  const C = { G: '#EABA01', R: '#FD0B04', P: '#A965C9', S: '#8A93C8', W: '#FFF4C7', O: '#FF9A5C', I: '#7C86FF', INK: '#C3C8F0', MUTED: '#A7ADDE', BG: '#0C0F1B', MONO: "'JetBrains Mono', ui-monospace, monospace" };
  const txt = (x, y, s, p) => h('text', Object.assign({ x, y, fontFamily: C.MONO, fontSize: 14, fill: C.INK }, p), s);
  const stop = (o, c, a) => h('stop', { offset: o, stopColor: c, stopOpacity: a });
  const glow = (id, c) => h('radialGradient', { id }, stop(0, '#fff', 1), stop(.35, c, .85), stop(1, c, 0));
  const clamp = v => Math.max(0, Math.min(1, v));
  const ease = v => { v = clamp(v); return v < .5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2; };
  const win = (t, a, b) => clamp((t - a) / (b - a));
  const mod = (t, p) => ((t % p) + p) % p;
  let uid = 0;
  class Base extends HTMLElement {
    connectedCallback() {
      if (this._on) return; this._on = true;
      this._id = 'alta' + (++uid) + '-';
      this.style.display = 'block';
      this.reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const [w, ht] = this.size;
      this.svg = h('svg', { viewBox: `0 0 ${w} ${ht}`, width: '100%', role: 'img', 'aria-label': this.label, style: 'display:block;overflow:visible;height:auto' });
      this.el = {};
      this.build(this.svg);
      this.appendChild(this.svg);
      this.prime ? this.prime() : this.paint(this.still, 0);
      this.io = new IntersectionObserver(([e]) => e.isIntersecting ? this.go() : this.stop());
      this.io.observe(this);
    }
    disconnectedCallback() { this.stop(); this.io && this.io.disconnect(); this._on = false; this.replaceChildren(); }
    go() {
      if (this.reduced || this.raf) return;
      let last = 0;
      const loop = ts => { const dt = last ? Math.min(.05, (ts - last) / 1000) : 0; last = ts; this.paint(ts / 1000, dt); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }
    stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
    id(n) { return this._id + n; }
    ref(k, i) { return e => { if (i == null) this.el[k] = e; else (this.el[k] = this.el[k] || [])[i] = e; }; }
    get size() { return [520, 300]; }
    get still() { return 3; }
    get label() { return ''; }
  }
  window.ALTA = Object.assign(window.ALTA || {}, { h, C, txt, stop, glow, clamp, ease, win, mod, Base });
})();
