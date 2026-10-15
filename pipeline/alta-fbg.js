/* <alta-fbg> — Step 01 Sensing: Fiber Bragg grating. Heat stretches the grating; the reflected peak shifts (Δλ ∝ ΔT). */
(() => {
  const { h, C, txt, stop, glow, ease, win, mod, clamp, Base } = ALTA;
  const CY = 186, G0 = 204, N = 13, X0 = 24, X1 = 496;
  const gauss = (x, c) => Math.exp(-Math.pow((x - c) / 7, 2));
  const curve = (a, b, f) => { let d = ''; for (let x = a; x <= b; x += 2) d += (d ? ' L ' : 'M ') + x + ' ' + f(x).toFixed(1); return d; };
  const edge = (x, a, b) => clamp(Math.min(x - a, b - x) / 30).toFixed(2);
  class AltaFbg extends Base {
    get still() { return 4.5; }
    get label() { return 'Fiber Bragg grating: broadband light enters the fiber and the grating reflects one wavelength. Heat stretches the grating, shifting the reflected wavelength.'; }
    build(s) {
      const id = n => this.id(n);
      const lines = [];
      for (let i = 0; i < N; i++) lines.push(h('line', { ref: this.ref('lines', i), y1: CY - 10, y2: CY + 10, stroke: C.G, strokeWidth: 2, strokeLinecap: 'round' }));
      const dot = (k, grad, key) => h('g', { ref: this.ref(key, k) }, h('circle', { r: 11, fill: `url(#${id(grad)})` }), h('circle', { r: 2.4, fill: '#fff' }));
      s.append(
        h('defs', null,
          h('radialGradient', { id: id('heat') }, stop(0, C.R, .6), stop(.6, '#FF5A1F', .18), stop(1, C.R, 0)),
          glow(id('w'), C.W), glow(id('g'), C.G), glow(id('o'), C.O)),
        txt(30, 34, 'reflected', { fill: C.G }), txt(220, 34, '← back', { textAnchor: 'end', fontSize: 12, fill: C.MUTED }),
        txt(300, 34, 'transmitted', { fill: C.INK }), txt(490, 34, '→', { textAnchor: 'end', fontSize: 12, fill: C.MUTED }),
        h('line', { x1: 30, y1: 112, x2: 220, y2: 112, stroke: C.S, opacity: .45 }),
        h('line', { x1: 300, y1: 112, x2: 490, y2: 112, stroke: C.S, opacity: .45 }),
        h('line', { x1: 125, y1: 50, x2: 125, y2: 112, stroke: C.G, opacity: .35, strokeDasharray: '2 3' }),
        txt(125, 130, 'λ_B', { textAnchor: 'middle', fontSize: 12, fill: C.G, opacity: .8 }),
        h('path', { ref: this.ref('refl'), fill: 'none', strokeWidth: 2.2, strokeLinejoin: 'round' }),
        h('path', { ref: this.ref('trans'), fill: 'none', stroke: C.INK, strokeWidth: 2, strokeLinejoin: 'round', opacity: .85 }),
        h('ellipse', { ref: this.ref('heat'), cy: CY, rx: 96, ry: 52, fill: `url(#${id('heat')})`, opacity: 0 }),
        h('text', { ref: this.ref('dT'), y: CY - 34, textAnchor: 'middle', fontFamily: C.MONO, fontSize: 13, fill: C.R, opacity: 0 }, 'heat · strain'),
        h('rect', { x: X0, y: CY - 13, width: X1 - X0, height: 26, rx: 13, fill: 'rgba(234,186,1,.04)', stroke: C.G, strokeWidth: 1.2, opacity: .4 }),
        h('line', { x1: X0 + 8, y1: CY, x2: X1 - 8, y2: CY, stroke: C.G, strokeWidth: 1.4, opacity: .45 }),
        lines,
        [0, 1, 2].map(k => dot(k, 'w', 'fw')),
        [0, 1].map(k => dot(k, 'g', 'bk')),
        txt(X0, CY + 40, 'broadband in →', { fontSize: 12, fill: C.MUTED }),
        txt(260, 252, 'Δ temp · Δ strain · Δ radiation  →  Δλ', { textAnchor: 'middle', fontSize: 13, fill: C.MUTED }),
        h('text', { ref: this.ref('read'), x: 260, y: 282, textAnchor: 'middle', fontFamily: C.MONO, fontSize: 15, fill: C.G }, ''));
    }
    paint(t) {
      const E = this.el, ph = mod(t, 8);
      const s = ease(win(ph, 1.5, 3)) * (1 - ease(win(ph, 5.5, 7)));
      const hot = s > .5, sp = 9 * (1 + .22 * s), gc = G0 + (N - 1) / 2 * sp, sh = 40 * s;
      E.lines.forEach((l, i) => { const x = (G0 + i * sp).toFixed(1); l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('stroke', hot ? C.O : C.G); });
      E.heat.setAttribute('cx', gc.toFixed(1)); E.heat.setAttribute('opacity', (s * .95).toFixed(3));
      E.dT.setAttribute('x', gc.toFixed(1)); E.dT.setAttribute('opacity', s.toFixed(2));
      E.refl.setAttribute('d', curve(30, 220, x => 112 - 60 * gauss(x, 125 + sh)));
      E.refl.setAttribute('stroke', hot ? C.O : C.G);
      E.trans.setAttribute('d', curve(300, 490, x => 54 + 58 * gauss(x, 395 + sh)));
      E.fw.forEach((d, k) => { const x = X0 + mod(t * 130 + k * 157, X1 - X0); d.setAttribute('transform', `translate(${x.toFixed(1)} ${CY})`); d.setAttribute('opacity', edge(x, X0, X1)); });
      const L = gc - X0;
      E.bk.forEach((d, k) => {
        const x = gc - mod(t * 130 + k * L / 2, L);
        d.setAttribute('transform', `translate(${x.toFixed(1)} ${CY})`); d.setAttribute('opacity', edge(x, X0, gc + 30));
        d.firstChild.setAttribute('fill', `url(#${this.id(hot ? 'o' : 'g')})`);
      });
      const dT = Math.round(40 * s);
      E.read.textContent = dT ? `ΔT +${dT} °C  →  Δλ +${(dT * .01).toFixed(2)} nm` : 'λ_B steady · cell nominal';
      E.read.setAttribute('fill', hot ? C.O : C.G);
    }
  }
  customElements.get('alta-fbg') || customElements.define('alta-fbg', AltaFbg);
})();
