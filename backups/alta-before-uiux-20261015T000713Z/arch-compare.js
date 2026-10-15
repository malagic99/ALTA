/* ALTA — Architecture comparison (Photonic FLP vs Silicon Digital)
 * Framework-free. Mount: <section data-arch-compare data-n="500"> … see snippet.html.
 * Photonic view: rAF-driven (bars morph live). Silicon view: SVG SMIL (same technique as index.html step-anims).
 */
(() => {
const G = '#EABA01', R = '#FD0B04', S = '#8A93C8', MONO = "'JetBrains Mono', monospace";
const fmt = (x) => x.toLocaleString('en-US').replace(/,/g, ' ');
const SVGNS = 'http://www.w3.org/2000/svg';
const KEBAB = new Set(['strokeWidth','strokeDasharray','strokeLinecap','strokeLinejoin','fontFamily','fontSize','textAnchor','stopColor','stopOpacity','clipPath']);
function h(tag, props, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  let ref = null;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || k === 'key') continue;
    if (k === 'ref') { ref = v; continue; }
    if (k === 'style') { Object.assign(el.style, v); continue; }
    el.setAttribute(KEBAB.has(k) ? k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()) : k, v);
  }
  (function add(list) { for (const c of list) { if (c == null || c === false) continue; if (Array.isArray(c)) add(c); else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c))); } })(kids);
  if (ref) ref(el);
  return el;
}
const anim = (attr, values, dur, begin, keyTimes, extra) =>
  h('animate', Object.assign({ attributeName: attr, values, dur, begin: begin || '0s', repeatCount: 'indefinite' }, keyTimes ? { keyTimes } : {}, extra || {}));
const txt = (x, y, s, props) => h('text', Object.assign({ x, y, fontFamily: MONO, fontSize: 16, fill: 'currentColor' }, props), s);
const flow = (x1, x2, y, stroke, op, w) =>
  h('line', { x1, y1: y, x2, y2: y, stroke, strokeWidth: w || 2.5, opacity: op, strokeDasharray: '7 9', strokeLinecap: 'round' },
    anim('stroke-dashoffset', '32;0', '1.2s'));

const PH = { cx: 360, cy: 215, r: 118, M: 90, inR: 108 };
const env = (t) => { const ph = ((t % 10) + 10) % 10; return ph > 6.4 && ph < 7.6 ? Math.sin(Math.PI * (ph - 6.4) / 1.2) : 0; };
const uIn = (t) => .45 * Math.sin(2.1 * t) + .25 * Math.sin(5.3 * t + 1.2) + .12 * Math.sin(11.7 * t + .4) + env(t) * .95 * Math.sin(31 * t);
const yOut = (t) => .12 + .8 * env(t - .35) + .04 * Math.sin(7.3 * t) + .03 * Math.sin(17 * t + 2);

function photonic(n, self) {
  const { cx, cy, r, M, inR } = PH;
  const reg = (k) => (el) => { self.ph[k] = el; if (el && k === 'bars') self.kick(); };
  const bars = [];
  for (let i = 0; i < M; i++) bars.push(h('line', { key: i, x1: cx, y1: cy - inR, x2: cx, y2: cy - inR + 10, stroke: G, strokeWidth: 2.6, strokeLinecap: 'round', transform: `rotate(${i * 360 / M} ${cx} ${cy})` }));
  return h('svg', { viewBox: '0 0 720 420', width: '100%', height: '100%', style: { color: '#C3C8F0', display: 'block', overflow: 'visible' }, role: 'img', 'aria-label': 'Photonic delay reservoir: one nonlinear node on a fiber loop. Each lap, light passes the node and updates the next virtual neuron; a readout flags anomalies.' },
    h('defs', null,
      h('radialGradient', { id: 'phNodeGlow' }, h('stop', { offset: '0%', stopColor: R, stopOpacity: .8 }), h('stop', { offset: '100%', stopColor: R, stopOpacity: 0 })),
      h('radialGradient', { id: 'phCore' }, h('stop', { offset: '55%', stopColor: G, stopOpacity: 0 }), h('stop', { offset: '92%', stopColor: G, stopOpacity: .16 }), h('stop', { offset: '100%', stopColor: G, stopOpacity: 0 })),
      h('linearGradient', { id: 'phInFade', x1: 0, x2: 1 }, h('stop', { offset: '0%', stopColor: G, stopOpacity: 0 }), h('stop', { offset: '35%', stopColor: G, stopOpacity: .9 }), h('stop', { offset: '100%', stopColor: '#FFF4C7' })),
      h('linearGradient', { id: 'phOutFade', x1: 500, x2: 690, gradientUnits: 'userSpaceOnUse' }, h('stop', { offset: '0%', stopColor: G }), h('stop', { offset: '100%', stopColor: G, stopOpacity: .1 }))),
    h('circle', { cx, cy, r: r + 30, fill: 'url(#phCore)' }),
    h('circle', { cx, cy, r: r + 9, fill: 'none', stroke: G, strokeWidth: 1, opacity: .14, strokeDasharray: '1 6' }),
    h('circle', { cx, cy, r, fill: 'none', stroke: G, strokeWidth: 2, opacity: .5 }),
    h('g', { ref: reg('bars') }, bars),
    txt(cx, cy - 6, 'one fiber loop', { textAnchor: 'middle', fontSize: 12, opacity: .55 }),
    txt(cx, cy + 14, 'τ = N · θ', { textAnchor: 'middle', fontSize: 12, fill: G, opacity: .8 }),
    txt(40, 58, 'input u(t)', { fontSize: 16 }),
    h('path', { ref: reg('inPath'), fill: 'none', stroke: 'url(#phInFade)', strokeWidth: 2.2, strokeLinejoin: 'round' }),
    h('circle', { ref: reg('nodeGlow'), cx, cy: cy - r, r: 22, fill: 'url(#phNodeGlow)' }),
    h('circle', { cx, cy: cy - r, r: 15, fill: '#0c0f1b', stroke: R, strokeWidth: 1.5, opacity: .9 }),
    h('circle', { cx, cy: cy - r, r: 8, fill: R }),
    txt(cx, cy - r - 30, 'nonlinear node', { textAnchor: 'middle', fill: R }),
    h('line', { x1: cx + r, y1: cy, x2: 501, y2: cy, stroke: G, strokeWidth: 2.2, strokeLinecap: 'round' }),
    txt(690, 140, 'readout · Σ wᵢxᵢ', { textAnchor: 'end', fill: G }),
    h('line', { x1: 500, y1: 187, x2: 690, y2: 187, stroke: R, strokeWidth: 1, opacity: .45, strokeDasharray: '4 5' }),
    txt(690, 178, 'threshold', { textAnchor: 'end', fontSize: 11, fill: R, opacity: .7 }),
    h('path', { ref: reg('outPath'), fill: 'none', stroke: 'url(#phOutFade)', strokeWidth: 2.2, strokeLinejoin: 'round' }),
    h('text', { ref: reg('status'), x: 690, y: 282, textAnchor: 'end', fontFamily: MONO, fontSize: 15, fill: G }, 'nominal'),
    txt(cx, 398, `N = ${fmt(n)} virtual neurons · one physical node · one fiber`, { textAnchor: 'middle', fill: G, fontSize: 15 }));
}

function silicon(n, ref) {
  const D = 2.4, cols = 12, rows = 7, dx = 190, dy = 120, dw = 340, dh = 210;
  const x0 = dx + 16, y0 = dy + 28, cw = (dw - 32) / cols, ch = (dh - 40) / rows, cs = 14;
  const colBegin = (c) => (c * D / cols).toFixed(3) + 's';
  const cores = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const b = (c * D / cols + r * 0.012).toFixed(3) + 's';
    cores.push(h('rect', { key: r + '-' + c, x: x0 + c * cw + (cw - cs) / 2, y: y0 + r * ch + (ch - cs) / 2, width: cs, height: cs, rx: 2, fill: S, opacity: .22 },
      anim('opacity', '.22;1;.4;.22', D + 's', b, '0;.03;.14;1'),
      anim('fill', `${S};#F6E7A6;${S};${S}`, D + 's', b, '0;.03;.16;1')));
  }
  const mem = [];
  for (let i = 0; i < 28; i++) {
    const c = Math.floor(i * cols / 28);
    mem.push(h('rect', { key: 'm' + i, x: dx + 6 + i * 11.86, y: 56, width: 8.5, height: 24, rx: 1.5, fill: S, opacity: .22 },
      anim('opacity', '.22;.95;.22;.22', D + 's', colBegin(c), '0;.03;.18;1')));
  }
  const buses = [];
  for (let c = 0; c < cols; c++) {
    const bx = x0 + c * cw + cw / 2;
    buses.push(h('line', { key: 'b' + c, x1: bx, y1: 86, x2: bx, y2: dy, stroke: S, strokeWidth: 1, opacity: .3 }));
    [0, D / 2].forEach((off, k) => buses.push(h('rect', { key: 'p' + c + k, x: bx - 2, y: 86, width: 4, height: 7, rx: 1, fill: k ? S : G, opacity: 0 },
      anim('y', '86;114;114', D + 's', ((c * D / cols + off) % D).toFixed(3) + 's', '0;.07;1'),
      anim('opacity', '0;1;1;0;0', D + 's', ((c * D / cols + off) % D).toFixed(3) + 's', '0;.01;.06;.075;1'))));
  }
  let clk = `M ${dx} 366`;
  for (let k = 0; k < 16; k++) { const x = dx + k * 24; clk += ` V 350 H ${x + 12} V 366 H ${x + 24}`; }
  const heat = [[300, 200, 3.6], [440, 270, 4.3], [370, 240, 5.1], [250, 290, 4.7]].map(([x, y, d], i) =>
    h('circle', { key: 'h' + i, cx: x, cy: y, r: 30, fill: 'url(#siHeat)' },
      anim('r', '34;100;34', d + 's', (-i * 1.1) + 's'), anim('opacity', '.5;.95;.5', d + 's', (-i * 1.1) + 's')));
  const bits = [0, 1, 2].map(i => h('rect', { key: 'bit' + i, x: 132, y: 222, width: 6, height: 6, rx: 1, fill: S },
    anim('x', '132;182', '.6s', (-i * 0.2) + 's'), anim('opacity', '0;1;1;0', '.6s', (-i * 0.2) + 's', '0;.15;.85;1')));
  return h('svg', { ref, viewBox: '0 0 720 420', width: '100%', height: '100%', style: { color: '#C3C8F0', display: 'block' }, role: 'img', 'aria-label': 'Silicon digital: signal is digitised, every clock step fetches all weights from memory into a grid of cores, which heats up.' },
    h('defs', null,
      h('radialGradient', { id: 'siHeat' }, h('stop', { offset: '0%', stopColor: R, stopOpacity: .55 }), h('stop', { offset: '60%', stopColor: '#FF5A1F', stopOpacity: .18 }), h('stop', { offset: '100%', stopColor: R, stopOpacity: 0 })),
      h('clipPath', { id: 'siDieClip' }, h('rect', { x: dx, y: dy, width: dw, height: dh, rx: 6 })),
      h('clipPath', { id: 'siClkClip' }, h('rect', { x: dx, y: 340, width: dw, height: 34 }))),
    h('g', null,
      flow(30, 80, 225, 'currentColor', .55),
      txt(30, 196, 'input'),
      h('rect', { x: 80, y: 207, width: 50, height: 36, rx: 4, fill: 'rgba(138,147,200,.08)', stroke: 'currentColor', strokeWidth: 1.2, opacity: .85 }),
      txt(105, 230, 'ADC', { textAnchor: 'middle', fontSize: 12 }),
      h('line', { x1: 130, y1: 225, x2: dx, y2: 225, stroke: S, strokeWidth: 1, opacity: .35 }),
      bits,
      txt(dx, 40, 'weight memory', { fontSize: 13, opacity: .75 }),
      txt(dx + dw, 40, `${fmt(n * n)} weights`, { fontSize: 13, textAnchor: 'end', fill: S }),
      h('rect', { x: dx, y: 50, width: dw, height: 36, rx: 4, fill: 'rgba(138,147,200,.05)', stroke: S, strokeWidth: 1.2, opacity: .7 }),
      mem, buses,
      txt(dx + dw + 12, 107, 'data movement', { fontSize: 12, fill: G }),
      h('rect', { x: dx, y: dy, width: dw, height: dh, rx: 6, fill: 'rgba(138,147,200,.05)' }),
      h('g', { clipPath: 'url(#siDieClip)' }, heat),
      cores,
      h('rect', { x: dx, y: dy, width: dw, height: dh, rx: 6, fill: 'none', stroke: S, strokeWidth: 1.6 },
        anim('stroke', `${S};#D2566A;${S}`, '4.3s')),
      txt(dx + 14, dy + 19, 'silicon die · clocked digital', { fontSize: 11, opacity: .6 }),
      txt(dx + dw + 12, 300, 'heat ∝ N²', { fontSize: 14, fill: R }),
      h('line', { x1: dx + dw, y1: 225, x2: 560, y2: 225, stroke: S, strokeWidth: 1, opacity: .35 }),
      h('rect', { x: 560, y: 207, width: 50, height: 36, rx: 4, fill: 'rgba(138,147,200,.08)', stroke: 'currentColor', strokeWidth: 1.2, opacity: .85 }),
      txt(585, 230, 'DAC', { textAnchor: 'middle', fontSize: 12 }),
      h('line', { x1: 610, y1: 225, x2: 690, y2: 225, stroke: G, strokeWidth: 2.5, strokeLinecap: 'round', opacity: .3 },
        anim('opacity', '.3;.3;1;.3', D + 's', '0s', '0;.9;.95;1')),
      txt(690, 196, 'readout', { textAnchor: 'end', fill: G }),
      txt(dx - 10, 363, 'CLK', { textAnchor: 'end', fontSize: 12, opacity: .6 }),
      h('g', { clipPath: 'url(#siClkClip)' },
        h('path', { d: clk, fill: 'none', stroke: S, strokeWidth: 1.5, opacity: .75 },
          h('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 0;-24 0', dur: '.4s', repeatCount: 'indefinite' }))),
      h('text', { x: 360, y: 400, textAnchor: 'middle', fontFamily: MONO, fontSize: 15, fill: '#C3C8F0' },
        `N = ${fmt(n)} neurons · `, h('tspan', { fill: R }, `${fmt(n * n)} multiply-accumulates per step`))));
}


function mount(root) {
  const n = Math.max(10, parseInt(root.dataset.n || '500', 10));
  const stage = root.querySelector('.arch-stage');
  const insight = root.querySelector('.arch-insight');
  const facts = root.querySelector('.arch-facts');
  const tabs = root.querySelectorAll('[data-arch-mode]');
  root.querySelectorAll('[data-arch-n]').forEach(el => { el.textContent = fmt(n); });
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S0 = {
    ph: {}, lastK: 0, visible: true, raf: 0,
    x: Array.from({ length: PH.M }, (_, i) => .3 + .5 * Math.abs(Math.sin(i * 12.9898))),
    mask: Array.from({ length: PH.M }, (_, i) => (Math.sin(i * 78.233) * 43758.5) % 1 > 0 ? 1 : -1),
    fresh: new Array(PH.M).fill(0),
  };
  const self = S0;
  self.frame = function (t) {
    const { cx, cy, M, inR } = PH, P = this.ph;
    if (!P.bars || !P.bars.isConnected) return;
    const phi = (t * 90) % 360;
    P.bars.setAttribute('transform', `rotate(${phi.toFixed(2)} ${cx} ${cy})`);
    const k = Math.round(((360 - phi) % 360) / (360 / M)) % M;
    const u = uIn(t);
    let guard = 0;
    while (this.lastK !== k && guard++ < M) {   // update every slot that crossed the node this frame
      const prev = this.lastK; this.lastK = (this.lastK + 1) % M; const j = this.lastK;
      this.x[j] = .5 + .5 * Math.sin(2.3 * this.x[prev] + 1.7 * this.mask[j] * u + .5 * this.x[j]);
      this.fresh[j] = 1;
    }
    const kids = P.bars.children;
    for (let i = 0; i < M; i++) {
      const v = this.x[i], f = this.fresh[i], el = kids[i];
      el.setAttribute('y2', (cy - inR + 4 + 42 * v).toFixed(1));
      el.setAttribute('opacity', (.28 + .62 * v + .1 * f).toFixed(2));
      el.setAttribute('stroke', f > .55 ? '#FFF4C7' : G);
      this.fresh[i] = f * .965;
    }
    P.nodeGlow.setAttribute('r', (20 + 9 * Math.abs(u)).toFixed(1));
    let d = '';
    for (let xx = 40; xx <= 345; xx += 3) d += (d ? ' L ' : 'M ') + xx + ' ' + (cy - PH.r - 17 * uIn(t - (345 - xx) / 200) * Math.min(1, (345 - xx) / 60)).toFixed(1);
    P.inPath.setAttribute('d', d);
    d = '';
    for (let xx = 500; xx <= 690; xx += 3) d += (d ? ' L ' : 'M ') + xx + ' ' + (PH.cy - 72 * (yOut(t - (xx - 500) / 200) - .12) * Math.min(1, (xx - 500) / 40)).toFixed(1);
    P.outPath.setAttribute('d', d);
    const hit = yOut(t) > .51;
    P.status.textContent = hit ? 'anomaly detected' : 'nominal';
    P.status.setAttribute('fill', hit ? R : G);
  };
  self.kick = function () {   // pre-roll so a full frame shows even without rAF (export, reduced motion)
    if (this.primed) return; this.primed = true;
    queueMicrotask(() => { this.lastK = 0; for (let k = 0; k < 400; k++) this.frame(1.5 + k * 0.012); this.frame(6.9); this.primed = false; });
  };
  const loop = (ts) => { self.frame(ts / 1000); self.raf = requestAnimationFrame(loop); };
  const start = () => { if (!reduced && !self.raf && self.visible) self.raf = requestAnimationFrame(loop); };
  const stop = () => { cancelAnimationFrame(self.raf); self.raf = 0; };
  const svgRef = (el) => { if (reduced) requestAnimationFrame(() => { el.setCurrentTime(1.1); el.pauseAnimations(); }); };

  const COPY = {
    photonic: {
      insight: 'Each lap, light passes the single nonlinear node and updates the next virtual neuron. Adding neurons adds delay, not hardware — energy per decision stays flat.',
      facts: [['Energy scaling', 'O(1)', 'is-gold'], ['Signal chain', 'Fully analogue, no A/D', ''], ['Neurons', 'Virtual, time-multiplexed', '']],
    },
    silicon: {
      insight: `Every step fetches ${fmt(n * n)} weights from memory. Most of the energy is spent moving data — and it leaves the die as heat.`,
      facts: [['Energy scaling', 'O(N²)', 'is-red'], ['Signal chain', 'ADC → clocked cores → DAC', ''], ['Neurons', 'Physical cores + weight memory', '']],
    },
  };
  const setMode = (mode) => {
    stop(); self.ph = {};
    stage.replaceChildren(mode === 'photonic' ? photonic(n, self) : silicon(n, svgRef));
    insight.textContent = COPY[mode].insight;
    facts.replaceChildren(...COPY[mode].facts.map(([k, v, c]) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="arch-fact-k"></span><span class="arch-fact-v ${c}"></span>`;
      li.children[0].textContent = k; li.children[1].textContent = v;
      return li;
    }));
    tabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.archMode === mode)));
    root.dataset.mode = mode;
    if (mode === 'photonic') start();
  };
  tabs.forEach(b => b.addEventListener('click', () => setMode(b.dataset.archMode)));
  // pause the rAF loop while offscreen
  new IntersectionObserver(([e]) => { self.visible = e.isIntersecting; if (!self.visible) stop(); else if (root.dataset.mode === 'photonic') start(); }).observe(root);
  setMode(root.dataset.default === 'silicon' ? 'silicon' : 'photonic');
}
document.querySelectorAll('[data-arch-compare]').forEach(mount);
})();
