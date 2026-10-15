/* <alta-prc> — Step 02 Processing: photonic delay reservoir. One nonlinear node on a fiber loop; each bar is a virtual neuron. */
(() => {
  const { h, C, txt, stop, mod, Base } = ALTA;
  const cx = 260, cy = 168, r = 94, M = 72, inR = 86;
  const env = t => { const p = mod(t, 10); return p > 6.4 && p < 7.6 ? Math.sin(Math.PI * (p - 6.4) / 1.2) : 0; };
  const uIn = t => .45 * Math.sin(2.1 * t) + .25 * Math.sin(5.3 * t + 1.2) + .12 * Math.sin(11.7 * t + .4) + env(t) * .95 * Math.sin(31 * t);
  const yOut = t => .12 + .8 * env(t - .35) + .04 * Math.sin(7.3 * t) + .03 * Math.sin(17 * t + 2);
  class AltaPrc extends Base {
    get label() { return 'Photonic delay reservoir: one nonlinear node on a fiber loop. Each lap, light passes the node and updates the next virtual neuron; a readout flags anomalies.'; }
    build(s) {
      const id = n => this.id(n);
      this.x = Array.from({ length: M }, (_, i) => .3 + .5 * Math.abs(Math.sin(i * 12.9898)));
      this.mask = Array.from({ length: M }, (_, i) => (Math.sin(i * 78.233) * 43758.5) % 1 > 0 ? 1 : -1);
      this.fresh = new Array(M).fill(0); this.k = 0;
      const bars = [];
      for (let i = 0; i < M; i++) bars.push(h('line', { x1: cx, y1: cy - inR, x2: cx, y2: cy - inR + 10, stroke: C.G, strokeWidth: 2.6, strokeLinecap: 'round', transform: `rotate(${i * 360 / M} ${cx} ${cy})` }));
      s.append(
        h('defs', null,
          h('radialGradient', { id: id('node') }, stop(0, C.R, .8), stop(1, C.R, 0)),
          h('radialGradient', { id: id('core') }, stop(.55, C.G, 0), stop(.92, C.G, .16), stop(1, C.G, 0)),
          h('linearGradient', { id: id('in'), x1: 20, x2: 250, gradientUnits: 'userSpaceOnUse' }, stop(0, C.G, 0), stop(.35, C.G, .9), stop(1, C.W, 1)),
          h('linearGradient', { id: id('out'), x1: 380, x2: 500, gradientUnits: 'userSpaceOnUse' }, stop(0, C.G, 1), stop(1, C.G, .15))),
        h('circle', { cx, cy, r: r + 28, fill: `url(#${id('core')})` }),
        h('circle', { cx, cy, r: r + 8, fill: 'none', stroke: C.G, opacity: .14, strokeDasharray: '1 6' }),
        h('circle', { cx, cy, r, fill: 'none', stroke: C.G, strokeWidth: 2, opacity: .5 }),
        h('g', { ref: this.ref('bars') }, bars),
        txt(cx, cy - 4, 'one fiber loop', { textAnchor: 'middle', fontSize: 12, fill: C.MUTED }),
        txt(cx, cy + 16, 'τ = N · θ', { textAnchor: 'middle', fontSize: 12, fill: C.G }),
        txt(20, 40, 'input u(t)'),
        h('path', { ref: this.ref('inP'), fill: 'none', stroke: `url(#${id('in')})`, strokeWidth: 2.2, strokeLinejoin: 'round' }),
        h('circle', { ref: this.ref('glow'), cx, cy: cy - r, r: 20, fill: `url(#${id('node')})` }),
        h('circle', { cx, cy: cy - r, r: 14, fill: C.BG, stroke: C.R, strokeWidth: 1.5 }),
        h('circle', { cx, cy: cy - r, r: 7, fill: C.R }),
        txt(cx, cy - r - 26, 'nonlinear node', { textAnchor: 'middle', fill: C.R }),
        h('line', { x1: cx + r, y1: cy, x2: 381, y2: cy, stroke: C.G, strokeWidth: 2.2, strokeLinecap: 'round' }),
        txt(500, 96, 'readout Σwᵢxᵢ', { textAnchor: 'end', fill: C.G }),
        h('line', { x1: 380, y1: 145, x2: 500, y2: 145, stroke: C.R, opacity: .5, strokeDasharray: '4 5' }),
        txt(500, 137, 'threshold', { textAnchor: 'end', fontSize: 11, fill: C.R, opacity: .75 }),
        h('path', { ref: this.ref('outP'), fill: 'none', stroke: `url(#${id('out')})`, strokeWidth: 2.2, strokeLinejoin: 'round' }),
        h('text', { ref: this.ref('st'), x: 500, y: 214, textAnchor: 'end', fontFamily: C.MONO, fontSize: 14, fill: C.G }, 'nominal'),
        txt(cx, 296, 'N virtual neurons · one node · one fiber', { textAnchor: 'middle', fontSize: 13, fill: C.G }));
    }
    prime() { this.k = 0; for (let i = 0; i < 400; i++) this.paint(1.5 + i * .012); this.paint(6.9); }
    paint(t) {
      const E = this.el, phi = mod(t * 90, 360);
      E.bars.setAttribute('transform', `rotate(${phi.toFixed(2)} ${cx} ${cy})`);
      const k = Math.round(mod(360 - phi, 360) / (360 / M)) % M, u = uIn(t);
      let g = 0;
      while (this.k !== k && g++ < M) {
        const p = this.k; this.k = (this.k + 1) % M; const j = this.k;
        this.x[j] = .5 + .5 * Math.sin(2.3 * this.x[p] + 1.7 * this.mask[j] * u + .5 * this.x[j]);
        this.fresh[j] = 1;
      }
      const kids = E.bars.children;
      for (let i = 0; i < M; i++) {
        const v = this.x[i], f = this.fresh[i], el = kids[i];
        el.setAttribute('y2', (cy - inR + 4 + 34 * v).toFixed(1));
        el.setAttribute('opacity', (.28 + .62 * v + .1 * f).toFixed(2));
        el.setAttribute('stroke', f > .55 ? C.W : C.G);
        this.fresh[i] = f * .965;
      }
      E.glow.setAttribute('r', (18 + 9 * Math.abs(u)).toFixed(1));
      let d = '';
      for (let x = 20; x <= cx - 14; x += 3) d += (d ? ' L ' : 'M ') + x + ' ' + (cy - r - 16 * uIn(t - (cx - 14 - x) / 200) * Math.min(1, (cx - 14 - x) / 60)).toFixed(1);
      E.inP.setAttribute('d', d);
      d = '';
      for (let x = 380; x <= 500; x += 3) d += (d ? ' L ' : 'M ') + x + ' ' + (cy - 60 * (yOut(t - (x - 380) / 200) - .12) * Math.min(1, (x - 380) / 30)).toFixed(1);
      E.outP.setAttribute('d', d);
      const hit = yOut(t) > .51;
      E.st.textContent = hit ? 'anomaly detected' : 'nominal';
      E.st.setAttribute('fill', hit ? C.R : C.G);
    }
  }
  customElements.get('alta-prc') || customElements.define('alta-prc', AltaPrc);
})();
