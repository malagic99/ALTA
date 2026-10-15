/* <alta-wdm> — Step 03 Fiber-optic backbone: a copper harness collapses into one WDM fiber; six wavelengths share one strand. */
(() => {
  const { h, C, txt, ease, win, mod, clamp, glow, Base } = ALTA;
  const LX = 104, RX = 416, MX0 = 150, MX1 = 190, DX0 = 330, DX1 = 370, FY = 150, P = 12;
  const NODE_Y = [70, 150, 230], LBL_L = ['power', 'attitude', 'payload'], LBL_R = ['comms', 'thermal', 'guidance'];
  const CH = [C.G, C.R, C.P, C.I, C.O, C.W];
  const lerp = (a, b, m) => a + (b - a) * m;
  const along = (pts, u) => {
    const seg = []; let L = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; }
    let d = u * L;
    for (let i = 0; i < seg.length; i++) { if (d <= seg[i]) { const f = d / seg[i]; return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)]; } d -= seg[i]; }
    return pts[pts.length - 1];
  };
  class AltaWdm extends Base {
    get still() { return 8; }
    get label() { return 'Fiber-optic backbone: a heavy copper harness collapses into a single fiber. Six subsystems travel on different wavelengths through one strand.'; }
    build(s) {
      const cu = [];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) cu.push(h('path', { ref: this.ref('cu', i * 6 + j), fill: 'none', stroke: C.S, strokeWidth: 1.1 }));
      const leads = [];
      NODE_Y.forEach(y => { leads.push(h('line', { x1: LX, y1: y, x2: MX0, y2: FY, stroke: C.S, strokeWidth: 1.4 })); leads.push(h('line', { x1: DX1, y1: FY, x2: RX, y2: y, stroke: C.S, strokeWidth: 1.4 })); });
      const box = (x0, x1, label) => h('g', null, h('rect', { x: x0, y: FY - 17, width: x1 - x0, height: 34, rx: 7, fill: C.BG, stroke: C.G, strokeWidth: 1.6 }), txt((x0 + x1) / 2, FY + 4, label, { textAnchor: 'middle', fontSize: 11, fill: C.G }));
      s.append(
        h('defs', null, CH.map((c, i) => glow(this.id('c' + i), c))),
        NODE_Y.map((y, i) => [
          txt(LX - 14, y + 4, LBL_L[i], { textAnchor: 'end', fontSize: 13 }), h('circle', { cx: LX, cy: y, r: 4.5, fill: CH[i] }),
          txt(RX + 14, y + 4, LBL_R[i], { fontSize: 13 }), h('circle', { cx: RX, cy: y, r: 4.5, fill: CH[i + 3] })]),
        h('g', { ref: this.ref('cuG') }, cu),
        h('g', { ref: this.ref('fiG') },
          leads,
          h('line', { x1: MX1, y1: FY, x2: DX0, y2: FY, stroke: C.G, strokeWidth: 3, strokeLinecap: 'round', opacity: .55 }),
          box(MX0, MX1, 'MUX'), box(DX0, DX1, 'DEMUX'),
          txt(260, FY - 16, 'λ₁ … λ₆', { textAnchor: 'middle', fontSize: 12, fill: C.G })),
        h('g', { ref: this.ref('pulseG') },
          CH.map((c, i) => [0, 1].map(k => h('circle', { ref: this.ref('pu', i * 2 + k), r: 8, fill: `url(#${this.id('c' + i)})` })))),
        h('text', { ref: this.ref('cap'), x: 260, y: 290, textAnchor: 'middle', fontFamily: C.MONO, fontSize: 13 }, ''));
    }
    paint(t) {
      const E = this.el, ph = mod(t, P);
      const m = ease(win(ph, 3.4, 5.4)) * (1 - ease(win(ph, 11, 12)));
      const noise = 1 - m;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) {
        const o = (j - 2.5) * 4, y0 = NODE_Y[i] + o, jit = Math.sin(t * 19 + j * 2.1 + i) * 2.6 * noise;
        const ym = lerp(y0 + jit, FY + o * .25, m);
        E.cu[i * 6 + j].setAttribute('d', `M ${LX} ${y0} C ${LX + 50} ${y0} ${MX0 - 10} ${ym} ${MX1} ${ym} L ${DX0} ${ym} C ${DX1 + 10} ${ym} ${RX - 50} ${y0} ${RX} ${y0}`);
      }
      E.cuG.setAttribute('opacity', (.6 * (1 - win(m, .55, 1))).toFixed(2));
      E.fiG.setAttribute('opacity', win(m, .6, 1).toFixed(2));
      const pv = win(ph, 5.3, 5.8) * (1 - win(ph, 10.6, 11));
      E.pulseG.setAttribute('opacity', pv.toFixed(2));
      if (pv > 0) for (let c = 0; c < 6; c++) {
        const i = c % 3, fwd = c < 3;
        const path = [[LX, NODE_Y[i]], [MX0, FY], [DX1, FY], [RX, NODE_Y[i]]];
        if (!fwd) path.reverse();
        for (let k = 0; k < 2; k++) {
          const u = mod(t * .32 + c * .17 + k * .5, 1), [x, y] = along(path, u), el = E.pu[c * 2 + k];
          el.setAttribute('cx', x.toFixed(1)); el.setAttribute('cy', y.toFixed(1));
          el.setAttribute('opacity', clamp(Math.min(u, 1 - u) * 10).toFixed(2));
        }
      }
      const fiber = m > .5;
      E.cap.textContent = fiber ? 'one fiber · WDM-multiplexed · 100 Gbps' : 'copper harness · ~100 conductors · heavy, EMI-coupled';
      E.cap.setAttribute('fill', fiber ? C.G : C.MUTED);
    }
  }
  customElements.get('alta-wdm') || customElements.define('alta-wdm', AltaWdm);
})();
