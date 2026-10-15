/* <alta-downlink> — Step 04 Laser downlink: raw frames are judged on board; only the decision is sent down the laser link. */
(() => {
  const { h, C, txt, ease, win, mod, clamp, glow, Base } = ALTA;
  const P = 9, COLS = 6, ROWS = 4, TS = 22, GAP = 8, TX = 54, TY = 48, N = COLS * ROWS;
  const TERM = [232, 168], GS = [432, 232];
  const tileXY = i => [TX + (i % COLS) * (TS + GAP), TY + Math.floor(i / COLS) * (TS + GAP)];
  class AltaDownlink extends Base {
    get still() { return 3.9; }
    get label() { return 'Laser downlink: the satellite captures raw frames, ALTA judges them on board, and only the decision travels down the laser link to the ground station.'; }
    build(s) {
      const id = n => this.id(n);
      const tiles = [];
      for (let i = 0; i < N; i++) { const [x, y] = tileXY(i); tiles.push(h('rect', { ref: this.ref('t', i), x, y, width: TS, height: TS, rx: 3, fill: C.S, opacity: 0 })); }
      s.append(
        h('defs', null, glow(id('g'), C.G), glow(id('gs'), C.G),
          h('clipPath', { id: id('earth') }, h('rect', { x: 0, y: 0, width: 520, height: 300 }))),
        txt(40, 30, 'on board · ALTA', { fontSize: 13, fill: C.MUTED }),
        h('rect', { x: 40, y: 40, width: 200, height: 128, rx: 10, fill: 'rgba(138,147,200,.04)', stroke: C.S, strokeWidth: 1.3, opacity: .85 }),
        h('rect', { x: 14, y: 84, width: 20, height: 40, rx: 2, fill: 'none', stroke: C.S, opacity: .5 }),
        h('rect', { x: 246, y: 84, width: 20, height: 40, rx: 2, fill: 'none', stroke: C.S, opacity: .5 }),
        tiles,
        h('line', { ref: this.ref('sweep'), y1: 44, y2: 164, stroke: C.G, strokeWidth: 2, opacity: 0 }),
        h('path', { d: 'M 250 300 Q 430 206 540 244 L 540 300 Z', fill: 'rgba(6,12,131,.22)', stroke: C.I, strokeWidth: 1.2, opacity: .7, 'clip-path': `url(#${id('earth')})` }),
        h('line', { ref: this.ref('beam'), x1: TERM[0], y1: TERM[1], x2: GS[0], y2: GS[1], stroke: C.G, strokeWidth: 1.6, strokeDasharray: '5 6', opacity: .35 }),
        txt(338, 188, '10 Gbps · 1550 nm', { textAnchor: 'middle', fontSize: 12, fill: C.G, transform: 'rotate(17.7 338 188)' }),
        h('circle', { cx: TERM[0], cy: TERM[1], r: 5, fill: C.G }),
        h('path', { d: `M ${GS[0] - 12} ${GS[1] - 6} A 12 12 0 0 0 ${GS[0] + 12} ${GS[1] - 6} Z`, fill: C.BG, stroke: C.INK, strokeWidth: 1.4 }),
        h('line', { x1: GS[0], y1: GS[1], x2: GS[0], y2: GS[1] + 10, stroke: C.INK, strokeWidth: 1.4 }),
        h('circle', { ref: this.ref('ring'), cx: GS[0], cy: GS[1] - 6, r: 10, fill: 'none', stroke: C.G, strokeWidth: 1.5, opacity: 0 }),
        txt(GS[0], GS[1] + 32, 'ground station', { textAnchor: 'middle', fontSize: 12 }),
        h('circle', { ref: this.ref('pkt'), r: 13, fill: `url(#${id('g')})`, opacity: 0 }),
        h('text', { ref: this.ref('cap'), x: 500, y: 52, textAnchor: 'end', fontFamily: C.MONO, fontSize: 13, fill: C.INK }, ''),
        h('text', { ref: this.ref('dis'), x: 500, y: 76, textAnchor: 'end', fontFamily: C.MONO, fontSize: 13, fill: C.R }, ''),
        h('text', { ref: this.ref('dn'), x: 500, y: 100, textAnchor: 'end', fontFamily: C.MONO, fontSize: 13, fill: C.G }, ''),
        h('text', { ref: this.ref('rx'), x: 500, y: 134, textAnchor: 'end', fontFamily: C.MONO, fontSize: 14, fill: C.G, opacity: 0 }, 'decision received'),
        txt(40, 204, '≈ 95 % of raw volume', { fontSize: 13, fill: C.MUTED }),
        txt(40, 222, 'eliminated on board', { fontSize: 13, fill: C.MUTED }));
    }
    paint(t) {
      const E = this.el, ph = mod(t, P), cyc = Math.floor(t / P);
      const keep = (cyc * 7 + 9) % N, out = 1 - win(ph, 7.8, 8.6);
      const sx = 50 + 182 * win(ph, 1.8, 3.2);
      E.sweep.setAttribute('x1', sx.toFixed(1)); E.sweep.setAttribute('x2', sx.toFixed(1));
      E.sweep.setAttribute('opacity', ph > 1.8 && ph < 3.25 ? '.9' : '0');
      let cap = 0, dis = 0;
      for (let i = 0; i < N; i++) {
        const el = E.t[i], [x] = tileXY(i), a = .06 * i, judged = win(ph, 1.8 + (x - 50) / 182 * 1.4, 2.0 + (x - 50) / 182 * 1.4);
        const shown = win(ph, a, a + .25);
        if (shown > 0) cap++;
        let fill = C.S, op = .5 * shown;
        if (i === keep) { if (judged > 0) { fill = C.G; op = ph > 3.4 ? .9 * (1 - win(ph, 3.4, 3.7)) + .15 : .95; } }
        else if (judged > 0) { dis++; fill = judged < .6 ? C.R : C.R; op = .5 * (1 - ease(win(ph, 2.0 + (x - 50) / 182 * 1.4, 2.6 + (x - 50) / 182 * 1.4))) + .05; }
        el.setAttribute('fill', fill); el.setAttribute('opacity', (op * out).toFixed(2));
      }
      const fly = win(ph, 3.4, 4.6), [kx, ky] = tileXY(keep);
      let px, py;
      if (fly < .3) { const f = ease(fly / .3); px = kx + TS / 2 + (TERM[0] - kx - TS / 2) * f; py = ky + TS / 2 + (TERM[1] - ky - TS / 2) * f; }
      else { const f = ease((fly - .3) / .7); px = TERM[0] + (GS[0] - TERM[0]) * f; py = TERM[1] + (GS[1] - 6 - TERM[1]) * f; }
      E.pkt.setAttribute('cx', px.toFixed(1)); E.pkt.setAttribute('cy', py.toFixed(1));
      E.pkt.setAttribute('opacity', ph > 3.4 && ph < 4.65 ? '1' : '0');
      E.beam.setAttribute('opacity', ph > 3.7 && ph < 4.8 ? '.95' : '.35');
      const rr = win(ph, 4.6, 5.6);
      E.ring.setAttribute('r', (10 + 22 * rr).toFixed(1)); E.ring.setAttribute('opacity', rr > 0 && rr < 1 ? (1 - rr).toFixed(2) : '0');
      E.rx.setAttribute('opacity', (win(ph, 4.6, 4.9) * out).toFixed(2));
      E.cap.textContent = `captured   ${String(Math.round(cap * out)).padStart(2, ' ')} / ${N}`;
      E.dis.textContent = `discarded  ${String(Math.round(dis * out)).padStart(2, ' ')}`;
      E.dn.textContent = `downlinked ${ph > 4.6 && out > .5 ? 1 : 0}`;
    }
  }
  customElements.get('alta-downlink') || customElements.define('alta-downlink', AltaDownlink);
})();
