/* ALTA — Thermal-runaway response demo (replaces the "Watch a thermal-runaway response" panel in #use-cases).
 * Framework-free. Auto-mounts every [data-thermal-demo]. See snippet-thermal.html for required markup.
 * Options (data-attrs): data-speed="1", data-auto-loop="true|false", data-show-compare="true|false".
 */
(() => {
const G = '#EABA01', R = '#FD0B04', S = '#8A93C8', P = '#A965C9', MONO = "'JetBrains Mono', monospace";
const SVGNS = 'http://www.w3.org/2000/svg';
const KEBAB = new Set(['strokeWidth','strokeDasharray','strokeLinecap','strokeLinejoin','fontFamily','fontSize','textAnchor','stopColor','stopOpacity','clipPath']);
function h(tag, props, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  let ref = null;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || k === 'key') continue;
    if (k === 'ref') { ref = v; continue; }
    if (k === 'style') { Object.assign(el.style, v); continue; }
    if (/^on[A-Z]/.test(k)) { el.addEventListener(k.slice(2).toLowerCase(), v); continue; }
    el.setAttribute(KEBAB.has(k) ? k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()) : k, v);
  }
  (function add(list) { for (const c of list) { if (c == null || c === false) continue; if (Array.isArray(c)) add(c); else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c))); } })(kids);
  if (ref) ref(el);
  return el;
}
const txt = (x, y, s, p) => h('text', Object.assign({ x, y, fontFamily: MONO, fontSize: 12, fill: 'currentColor' }, p), s);
const clamp = (v) => Math.max(0, Math.min(1, v));
const ease = (v) => { v = clamp(v); return v < .5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2; };
const COLS = 4, ROWS = 3, CW = 70, CH = 62, X0 = 64, Y0 = 92, SX = 88, SY = 80;
const FIBER = 'M 46 163 H 398 C 422 163 422 243 398 243 H 64 C 40 243 40 323 64 323 H 440 C 490 323 520 260 520 200';
const CMD = 'M 560 160 V 24 H 370 V 44';
const RING = { cx: 560, cy: 200, r: 40, M: 36 };
const END = 6.0;
const STAGES = [
  { code: 'FBG', label: 'Sense', time: '0.4 ns', desc: 'The grating beside the hot cell reflects a shifted wavelength. Passive optics — no electronics in the loop.' },
  { code: 'PRC', label: 'Infer', time: '1.2 ns', desc: 'The light signature runs through the photonic reservoir and is classified as thermal runaway.' },
  { code: '↳', label: 'Decide', time: '2 ns', desc: 'A vent command goes out on the fiber backbone. No ground-station round-trip.' },
  { code: 'VENT', label: 'Act', time: '≈ 1 μs', desc: 'The valve opens, heat is dumped, and neighbouring cells stay safe.' },
];
const stageAt = (T) => T < 1.3 ? 0 : T < 3.0 ? 1 : T < 3.8 ? 2 : T < END ? 3 : 4;
const clockNs = (T) => T < 1.3 ? .4 * T / 1.3 : T < 3.0 ? .4 + .8 * (T - 1.3) / 1.7 : T < 3.8 ? 1.2 + .8 * (T - 3.0) / .8 : 2 * Math.pow(500, clamp((T - 3.8) / 2.2));
const fmtClock = (ns) => ns < 1000 ? ns.toFixed(ns < 10 ? 1 : 0) + ' ns' : (ns / 1000).toFixed(2) + ' μs';


class ThermalSim {
  constructor(root) {
    this.root = root;
    this.props = { speed: parseFloat(root.dataset.speed || '1'), autoLoop: root.dataset.autoLoop === 'true', showCompare: root.dataset.showCompare !== 'false' };
    this.q = (s) => root.querySelector(s);
    this.clock = this.q('.tr-clock');
    this.q('.tr-trigger').addEventListener('click', () => this.start());
    this.stageEls = Array.from(root.querySelectorAll('.tr-stage'));
    this.q('.tr-scene').replaceChildren(this.buildScene());
    this.update();
    this.componentDidMount();
    new IntersectionObserver(([en]) => { this.visible = en.isIntersecting; }).observe(root);
  }
  setState(o) { Object.assign(this.state, o); this.update(); }
  update() {
    const v = this.renderVals();
    const btn = this.q('.tr-trigger');
    btn.disabled = v.running;
    btn.querySelector('.tr-trigger-label').textContent = v.btnLabel;
    btn.dataset.state = this.state.phase;
    const st = this.q('.tr-status'); st.textContent = v.status; st.style.color = v.statusColor;
    v.stages.forEach((s, i) => {
      const el = this.stageEls[i]; if (!el) return;
      el.dataset.state = this.state.phase === 'running' && this.state.stage === i ? 'active' : (s.time !== '—' ? 'done' : 'idle');
      el.querySelector('.tr-stage-time').textContent = s.time;
    });
    const cmp = this.q('.tr-compare'); if (cmp) cmp.hidden = !v.showCompare;
  }
  state = { phase: 'idle', stage: -1, cell: 6 };
  el = { cells: [], glows: [], heats: [], grates: [], parts: [], louvers: [] };
  r = (k, i) => (e) => { if (i == null) this.el[k] = e; else this.el[k][i] = e; };
  clockRef = (e) => { this.clock = e; };
  T = 0; rot = 0; last = 0;
  reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  componentDidMount() {
    this.measure();
    this.paint(0, 0);
    this.raf = requestAnimationFrame(this.tick);
    if (this.props.autoLoop) setTimeout(() => this.start(), 1200);
  }
  componentWillUnmount() { cancelAnimationFrame(this.raf); clearTimeout(this.loopT); (this.rtimers || []).forEach(clearTimeout); }

  measure() {
    const f = this.el.fiber; if (!f || !f.getTotalLength) return;
    this.L = f.getTotalLength();
    const pts = []; for (let i = 0; i <= 600; i++) { const p = f.getPointAtLength(this.L * i / 600); pts.push([p.x, p.y, this.L * i / 600]); }
    this.lg = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      const c = i % COLS, rw = Math.floor(i / COLS), gx = X0 + c * SX + CW / 2, gy = Y0 + rw * SY + CH + 9;
      let best = 0, bd = 1e9; pts.forEach(p => { const d = Math.hypot(p[0] - gx, p[1] - gy); if (d < bd) { bd = d; best = p[2]; } });
      this.lg.push(best);
    }
    const c = this.el.cmd; this.Lc = c && c.getTotalLength ? c.getTotalLength() : 0;
  }

  start(cell) {
    if (this.state.phase === 'running') return;
    clearTimeout(this.loopT);
    const next = cell != null ? cell : (this.props.autoLoop && this.state.phase === 'done' ? Math.floor(Math.random() * 12) : this.state.cell);
    this.T = 0; this.last = 0;
    this.setState({ phase: 'running', stage: 0, cell: next });
    if (this.reduced) {
      this.rtimers = [1.3, 3.0, 3.8, END + .01].map((t, i) => setTimeout(() => { this.T = t; this.paint(t, 0); this.syncStage(t); }, (i + 1) * 650));
    }
  }

  syncStage(T) {
    const s = stageAt(T);
    if (s !== this.state.stage) {
      if (s === 4) {
        this.setState({ stage: 4, phase: 'done' });
        if (this.props.autoLoop) this.loopT = setTimeout(() => this.start(), 3500);
      } else this.setState({ stage: s });
    }
  }

  tick = (ts) => {
    const dt = this.last ? Math.min(.05, (ts - this.last) / 1000) : 0; this.last = ts;
    if (this.state.phase === 'running' && !this.reduced) {
      this.T += dt * (this.props.speed ?? 1);
      this.syncStage(this.T);
    }
    if (this.visible !== false) this.paint(this.state.phase === 'idle' ? 0 : Math.min(this.T, END + .01), dt, ts / 1000);
    this.raf = requestAnimationFrame(this.tick);
  };

  paint(T, dt, now = 0) {
    const E = this.el, live = this.state.phase !== 'idle', ci = this.state.cell;
    if (!E.fiber) return;
    const cr = Math.floor(ci / COLS), cc = ci % COLS;
    const rise = !live ? 0 : T < 1.3 ? ease(T / 1.3) : T < 4.2 ? 1 : 1 - ease((T - 4.2) / 1.8);
    for (let i = 0; i < COLS * ROWS; i++) {
      const rr = Math.floor(i / COLS), c = i % COLS, adj = Math.abs(rr - cr) + Math.abs(c - cc);
      const hh = i === ci ? rise : adj === 1 ? rise * .32 * clamp((T - .5) / .8) : 0;
      E.heats[i] && E.heats[i].setAttribute('opacity', (hh * .62).toFixed(3));
      if (E.glows[i]) { E.glows[i].setAttribute('r', (16 + 50 * hh).toFixed(1)); E.glows[i].setAttribute('opacity', hh.toFixed(3)); }
      if (E.grates[i]) {
        const lit = live && i === ci && T > .85 && T < 4.6;
        E.grates[i].setAttribute('stroke', lit ? '#FFF4C7' : G);
        E.grates[i].setAttribute('opacity', lit ? '1' : '.55');
        E.grates[i].setAttribute('stroke-width', lit ? '2' : '1.2');
      }
    }
    if (E.shimmer) E.shimmer.setAttribute('stroke-dashoffset', (-now * 24).toFixed(1));
    const put = (dot, glow, path, L0, L1, a, b) => {
      const on = live && T >= a && T <= b && path && path.getPointAtLength;
      [dot, glow].forEach(e => e && e.setAttribute('opacity', on ? (e === glow ? '.85' : '1') : '0'));
      if (!on) return;
      const p = path.getPointAtLength(L0 + (L1 - L0) * ease((T - a) / (b - a)));
      [dot, glow].forEach(e => { e.setAttribute('cx', p.x.toFixed(1)); e.setAttribute('cy', p.y.toFixed(1)); });
    };
    if (this.L) put(E.p1, E.p1g, E.fiber, this.lg[ci], this.L, 1.3, 2.3);
    if (this.Lc) put(E.p2, E.p2g, E.cmd, 0, this.Lc, 3.0, 3.8);
    const infer = live && T > 2.3 && T < 3.0;
    this.rot = (this.rot + dt * (infer ? 900 : 30)) % 360;
    if (E.ring) E.ring.setAttribute('transform', `rotate(${this.rot.toFixed(1)} ${RING.cx} ${RING.cy})`);
    if (E.ringGlow) E.ringGlow.setAttribute('opacity', infer ? '1' : live && T > 2.2 && T < 3.3 ? '.5' : '.15');
    if (E.nodeGlow) E.nodeGlow.setAttribute('r', infer ? (16 + 6 * Math.sin(now * 40)).toFixed(1) : '12');
    const open = !live ? 0 : T < 3.8 ? 0 : T < 4.2 ? ease((T - 3.8) / .4) : T < 5.6 ? 1 : 1 - ease((T - 5.6) / .4);
    E.louvers.forEach((l, i) => l && l.setAttribute('transform', `rotate(${(-62 * open).toFixed(1)} ${345 + i * 16} 48)`));
    E.parts.forEach((p, i) => {
      if (!p) return;
      const on = live && T > 3.9 && T < 5.9;
      if (!on) { p.setAttribute('opacity', '0'); return; }
      const ph = (((T - 3.9) * 1.1 + i / E.parts.length) % 1);
      const fade = clamp((5.9 - T) / .6);
      p.setAttribute('cx', (370 + ((i % 5) - 2) * 9 + Math.sin(ph * 6 + i) * 6).toFixed(1));
      p.setAttribute('cy', (46 - ph * 40).toFixed(1));
      p.setAttribute('r', (2 + ph * 3).toFixed(1));
      p.setAttribute('opacity', ((1 - ph) * .9 * fade).toFixed(2));
      p.setAttribute('fill', ph < .45 ? R : '#FF8A5C');
    });
    const shift = !live ? 0 : 36 * ease((T - .7) / .6) * (T < 4.2 ? 1 : 1 - ease((T - 4.2) / 1.8));
    if (E.spec) {
      let d = ''; const c0 = 548 + shift;
      for (let x = 474; x <= 686; x += 2) { const y = 360 - 52 * Math.exp(-Math.pow((x - c0) / 9, 2)); d += (d ? ' L ' : 'M ') + x + ' ' + y.toFixed(1); }
      E.spec.setAttribute('d', d); E.spec.setAttribute('stroke', shift > 18 ? R : G);
    }
    if (E.dl) E.dl.setAttribute('opacity', clamp(shift / 20).toFixed(2));
    if (this.clock) this.clock.textContent = fmtClock(live ? clockNs(Math.min(T, END)) : 0);
  }

  buildScene() {
    const cells = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      const c = i % COLS, rw = Math.floor(i / COLS), x = X0 + c * SX, y = Y0 + rw * SY, cx = x + CW / 2, cy = y + CH / 2, gy = y + CH + 9;
      cells.push(h('g', { key: 'c' + i, style: { cursor: 'pointer' }, onClick: () => this.start(i) },
        h('circle', { ref: this.r('glows', i), cx, cy, r: 16, fill: 'url(#trHeat)', opacity: 0 }),
        h('rect', { x, y, width: CW, height: CH, rx: 8, fill: 'rgba(138,147,200,.06)', stroke: S, strokeWidth: 1.2, opacity: .85 }),
        h('rect', { ref: this.r('heats', i), x, y, width: CW, height: CH, rx: 8, fill: R, opacity: 0 }),
        h('rect', { x: cx - 9, y: y - 5, width: 18, height: 5, rx: 1.5, fill: S, opacity: .5 }),
        h('line', { x1: x + 12, y1: cy, x2: x + CW - 12, y2: cy, stroke: S, strokeWidth: 1, opacity: .18 }),
        h('g', { ref: this.r('grates', i), stroke: G, strokeWidth: 1.2, opacity: .55 },
          [-8, -4, 0, 4, 8].map(o => h('line', { key: o, x1: cx + o, y1: gy - 5, x2: cx + o, y2: gy + 5 })))));
    }
    const bars = [];
    for (let i = 0; i < RING.M; i++) bars.push(h('line', { key: i, x1: RING.cx, y1: RING.cy - 34, x2: RING.cx, y2: RING.cy - 22 - (i % 3) * 3, stroke: G, strokeWidth: 2, strokeLinecap: 'round', opacity: .35 + (i % 4) * .15, transform: `rotate(${i * 10} ${RING.cx} ${RING.cy})` }));
    return h('svg', { viewBox: '0 0 720 400', width: '100%', height: '100%', style: { display: 'block', color: '#C3C8F0', overflow: 'hidden' }, role: 'img', 'aria-label': 'Battery bay with an embedded Bragg-grating fiber. A hot cell shifts the reflected wavelength; the signal runs to the ALTA photonic reservoir, which commands the vent valve to open.' },
      h('defs', null,
        h('radialGradient', { id: 'trHeat' }, h('stop', { offset: '0%', stopColor: R, stopOpacity: .75 }), h('stop', { offset: '55%', stopColor: '#FF5A1F', stopOpacity: .22 }), h('stop', { offset: '100%', stopColor: R, stopOpacity: 0 })),
        h('radialGradient', { id: 'trGold' }, h('stop', { offset: '0%', stopColor: G }), h('stop', { offset: '100%', stopColor: G, stopOpacity: 0 })),
        h('radialGradient', { id: 'trPurple' }, h('stop', { offset: '0%', stopColor: P }), h('stop', { offset: '100%', stopColor: P, stopOpacity: 0 })),
        h('radialGradient', { id: 'trRing' }, h('stop', { offset: '50%', stopColor: G, stopOpacity: 0 }), h('stop', { offset: '85%', stopColor: G, stopOpacity: .3 }), h('stop', { offset: '100%', stopColor: G, stopOpacity: 0 })),
        h('radialGradient', { id: 'trNode' }, h('stop', { offset: '0%', stopColor: R, stopOpacity: .8 }), h('stop', { offset: '100%', stopColor: R, stopOpacity: 0 }))),
      txt(24, 34, 'battery bay · cross-section', { opacity: .7 }),
      h('rect', { x: 24, y: 48, width: 414, height: 324, rx: 16, fill: 'rgba(138,147,200,.03)', stroke: S, strokeWidth: 1.4, opacity: .8 }),
      h('path', { ref: this.r('cmd'), d: CMD, fill: 'none', stroke: P, strokeWidth: 1.6, opacity: .55, strokeDasharray: '5 5' }),
      txt(468, 20, 'fiber backbone', { fill: P, fontSize: 11 }),
      txt(330, 34, 'vent valve', { textAnchor: 'end', opacity: .7 }),
      h('rect', { x: 337, y: 42, width: 66, height: 12, rx: 3, fill: '#0c0f1b', stroke: S, strokeWidth: 1.2 }),
      [0, 1, 2, 3].map(i => h('line', { key: 'l' + i, ref: this.r('louvers', i), x1: 345 + i * 16 - 6, y1: 48, x2: 345 + i * 16 + 6, y2: 48, stroke: '#C3C8F0', strokeWidth: 2, strokeLinecap: 'round' })),
      Array.from({ length: 16 }, (_, i) => h('circle', { key: 'p' + i, ref: this.r('parts', i), cx: 370, cy: 46, r: 2, fill: R, opacity: 0 })),
      h('path', { ref: this.r('fiber'), d: FIBER, fill: 'none', stroke: G, strokeWidth: 1.8, opacity: .5 }),
      h('path', { ref: this.r('shimmer'), d: FIBER, fill: 'none', stroke: G, strokeWidth: 1.8, opacity: .55, strokeDasharray: '2 22', strokeLinecap: 'round' }),
      cells,
      h('circle', { ref: this.r('ringGlow'), cx: RING.cx, cy: RING.cy, r: 66, fill: 'url(#trRing)', opacity: .15 }),
      h('circle', { cx: RING.cx, cy: RING.cy, r: RING.r, fill: '#0c0f1b', stroke: G, strokeWidth: 1.8, opacity: .8 }),
      h('g', { ref: this.r('ring') }, bars),
      h('circle', { ref: this.r('nodeGlow'), cx: RING.cx, cy: RING.cy - RING.r, r: 12, fill: 'url(#trNode)' }),
      h('circle', { cx: RING.cx, cy: RING.cy - RING.r, r: 5, fill: R }),
      txt(RING.cx, RING.cy + 4, 'PRC', { textAnchor: 'middle', fill: G, fontSize: 11 }),
      txt(RING.cx, RING.cy + 62, 'ALTA · photonic reservoir', { textAnchor: 'middle' }),
      txt(474, 290, 'reflected spectrum', { opacity: .7, fontSize: 11 }),
      h('text', { ref: this.r('dl'), x: 686, y: 290, textAnchor: 'end', fontFamily: MONO, fontSize: 11, fill: R, opacity: 0 }, 'Δλ ∝ ΔT'),
      h('line', { x1: 474, y1: 361, x2: 686, y2: 361, stroke: S, strokeWidth: 1, opacity: .45 }),
      h('line', { x1: 548, y1: 304, x2: 548, y2: 361, stroke: G, strokeWidth: 1, opacity: .35, strokeDasharray: '2 3' }),
      txt(548, 378, 'λ_Bragg', { textAnchor: 'middle', fill: G, fontSize: 10, opacity: .8 }),
      h('path', { ref: this.r('spec'), fill: 'none', stroke: G, strokeWidth: 2, strokeLinejoin: 'round' }),
      h('circle', { ref: this.r('p1g'), r: 14, fill: 'url(#trGold)', opacity: 0 }),
      h('circle', { ref: this.r('p1'), r: 4, fill: '#FFF4C7', opacity: 0 }),
      h('circle', { ref: this.r('p2g'), r: 14, fill: 'url(#trPurple)', opacity: 0 }),
      h('circle', { ref: this.r('p2'), r: 4, fill: '#F1DDFB', opacity: 0 }));
  }

  renderVals() {
    const { phase, stage } = this.state;
    const STATUS = ['Thermal anomaly · grating wavelength shifting…', 'Signature in the reservoir · classifying…', 'Thermal runaway · dispatching vent command…', 'Venting · heat dumped, neighbours safe'];
    const running = phase === 'running';
    return {
      trigger: () => this.start(),
      running,
      btnLabel: running ? 'Responding…' : phase === 'done' ? 'Replay' : 'Trigger thermal event',
      btnBg: running ? 'rgba(255,255,255,0.04)' : '#EABA01',
      btnBorder: running ? 'rgba(255,255,255,0.12)' : '#EABA01',
      btnColor: running ? '#a7adde' : '#02030f',
      status: phase === 'idle' ? 'Nominal · all cells within limits' : phase === 'done' ? 'Resolved on board in ≈ 1 μs · zero ground latency' : STATUS[stage] || '',
      statusColor: phase === 'idle' ? '#a7adde' : phase === 'done' ? '#EABA01' : '#FF5A4F',
      stages: STAGES.map((s, i) => {
        const active = running && stage === i, done = phase === 'done' || (running && stage > i);
        return Object.assign({}, s, {
          time: done || active ? s.time : '—',
          border: active ? 'rgba(234,186,1,0.6)' : done ? 'rgba(234,186,1,0.25)' : 'rgba(255,255,255,0.07)',
          bg: active ? 'rgba(234,186,1,0.08)' : '#0c0f1b',
          puckColor: active || done ? '#EABA01' : '#a7adde',
          puckBorder: active || done ? 'rgba(234,186,1,0.5)' : 'rgba(255,255,255,0.12)',
          timeColor: active ? '#eef0ff' : done ? '#EABA01' : '#a7adde',
        });
      }),
      showCompare: (this.props.showCompare ?? true) && phase === 'done',
    };
  }
}
document.querySelectorAll('[data-thermal-demo]').forEach(el => new ThermalSim(el));
})();
