// Dara in plain JavaScript: rules, feature planes, network inference and MCTS.
// A line-for-line port of dara/engine.cpp + dara/model.py so the trained
// network can be played in a browser.  tests/test_web.py checks it against
// the C++ engine and PyTorch.
const Dara = (() => {
  const R = 5, C = 6, NC = 30, NA = 180, NP = 10, MAX_PLY = 200;
  const DR = [-1, 1, 0, 0], DC = [0, 0, -1, 1];
  const DROP = 0, MOVE = 1, CAPTURE = 2;

  const newState = () => ({ b: [0, 0], hand: [12, 12], turn: 0, phase: DROP, winner: -1, ply: 0 });
  const clone = (s) => ({ b: [s.b[0], s.b[1]], hand: [s.hand[0], s.hand[1]], turn: s.turn,
                          phase: s.phase, winner: s.winner, ply: s.ply });
  const has = (m, r, c) => r >= 0 && r < R && c >= 0 && c < C && ((m >> (r * C + c)) & 1) === 1;
  function run(m, x, dr, dc) {
    const r = (x / C) | 0, c = x % C;
    let n = 1;
    for (let k = 1; has(m, r + k * dr, c + k * dc); k++) n++;
    for (let k = 1; has(m, r - k * dr, c - k * dc); k++) n++;
    return n;
  }
  const longest = (m, x) => Math.max(run(m, x, 0, 1), run(m, x, 1, 0));
  const inThree = (m, x) => run(m, x, 0, 1) === 3 || run(m, x, 1, 0) === 3;
  const popcount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

  // Cells of the three(s) through x, for highlighting.
  function threeCells(m, x) {
    const out = [];
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      if (run(m, x, dr, dc) !== 3) continue;
      const r = (x / C) | 0, c = x % C;
      out.push(x);
      for (let k = 1; has(m, r + k * dr, c + k * dc); k++) out.push((r + k * dr) * C + c + k * dc);
      for (let k = 1; has(m, r - k * dr, c - k * dc); k++) out.push((r - k * dr) * C + c - k * dc);
    }
    return out;
  }

  function legalActions(s) {
    const out = [];
    if (s.winner >= 0) return out;
    const me = s.turn, op = 1 - me, occ = s.b[0] | s.b[1];
    if (s.phase === DROP) {
      for (const limit of [2, 3, 30]) {
        for (let x = 0; x < NC; x++)
          if (!((occ >> x) & 1) && longest(s.b[me] | (1 << x), x) <= limit) out.push(x);
        if (out.length) break;
      }
    } else if (s.phase === MOVE) {
      for (let x = 0; x < NC; x++) {
        if (!((s.b[me] >> x) & 1)) continue;
        for (let d = 0; d < 4; d++) {
          const r = ((x / C) | 0) + DR[d], c = (x % C) + DC[d];
          if (r < 0 || r >= R || c < 0 || c >= C) continue;
          const y = r * C + c;
          if ((occ >> y) & 1) continue;
          if (longest((s.b[me] ^ (1 << x)) | (1 << y), y) >= 4) continue;
          out.push(30 + d * 30 + x);
        }
      }
    } else {
      for (let x = 0; x < NC; x++)
        if (((s.b[op] >> x) & 1) && !inThree(s.b[op], x)) out.push(150 + x);
      if (!out.length)
        for (let x = 0; x < NC; x++) if ((s.b[op] >> x) & 1) out.push(150 + x);
    }
    return out;
  }

  function endTurn(s) {
    s.turn ^= 1;
    if (s.winner >= 0) return;
    if (s.phase === MOVE && legalActions(s).length === 0) { s.winner = 1 - s.turn; return; }
    if (s.ply >= MAX_PLY) {
      const a = popcount(s.b[0]), b = popcount(s.b[1]);
      s.winner = a > b ? 0 : b > a ? 1 : 2;
    }
  }

  const moveTarget = (a) => {
    const d = ((a - 30) / 30) | 0, x = (a - 30) % 30;
    return [x, (((x / C) | 0) + DR[d]) * C + (x % C) + DC[d]];
  };

  function applyAction(s, a) {   // mutates s
    const me = s.turn, op = 1 - me;
    s.ply++;
    if (a < 30) {
      s.b[me] |= 1 << a;
      s.hand[me]--;
      if (s.hand[0] === 0 && s.hand[1] === 0) s.phase = MOVE;
      endTurn(s);
    } else if (a < 150) {
      const [x, y] = moveTarget(a);
      s.b[me] = (s.b[me] ^ (1 << x)) | (1 << y);
      if (inThree(s.b[me], y)) s.phase = CAPTURE; else endTurn(s);
    } else {
      s.b[op] &= ~(1 << (a - 150));
      s.phase = MOVE;
      if (popcount(s.b[op]) < 3) s.winner = me;
      endTurn(s);
    }
    return s;
  }

  function features(s, f) {      // f: Float32Array(30 * NP), layout [cell][plane]
    f.fill(0);
    const me = s.turn, op = 1 - me;
    const nme = popcount(s.b[me]) / 12, nop = popcount(s.b[op]) / 12;
    for (let i = 0; i < NC; i++) {
      const o = i * NP;
      f[o] = (s.b[me] >> i) & 1;
      f[o + 1] = (s.b[op] >> i) & 1;
      f[o + 2 + s.phase] = 1;
      f[o + 5] = s.hand[me] / 12;
      f[o + 6] = s.hand[op] / 12;
      f[o + 7] = nme;
      f[o + 8] = nop;
      f[o + 9] = s.ply / MAX_PLY;
    }
    return f;
  }

  // ------------------------------------------------------------ network --
  function decodeHalf(b64) {
    const bin = atob(b64), n = bin.length >> 1, out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const h = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      const sgn = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
      out[i] = sgn * (e === 0 ? m * 2 ** -24 : e === 31 ? Infinity : (1024 + m) * 2 ** (e - 25));
    }
    return out;
  }

  function makeNet(spec) {
    const CH = spec.channels, data = decodeHalf(spec.data);
    let off = 0;
    const take = (n) => { const a = data.subarray(off, off + n); off += n; return a; };
    const conv = (k, ic, oc) => ({ k, ic, oc, w: take(k * k * ic * oc), b: take(oc) });
    const stem = conv(3, NP, CH), blocks = [];
    for (let i = 0; i < spec.blocks; i++) blocks.push([conv(3, CH, CH), conv(3, CH, CH)]);
    const pConv = conv(1, CH, 32), pOut = conv(1, 32, 6), vConv = conv(1, CH, 8);
    const fc1 = { w: take(240 * 64), b: take(64) }, fc2 = { w: take(64), b: take(1) };
    if (off !== data.length) throw new Error("weight size mismatch");

    // Scatter-style convolution over channels-last buffers; skips zero inputs
    // (about half of them after a ReLU).
    function apply(L, inp, out) {
      const { k, ic, oc, w, b } = L, half = k >> 1;
      for (let p = 0; p < NC; p++) out.set(b, p * oc);
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const ib = (r * C + c) * ic;
        for (let i = 0; i < ic; i++) {
          const x = inp[ib + i];
          if (x === 0) continue;
          for (let ky = 0; ky < k; ky++) {
            const orow = r - ky + half;
            if (orow < 0 || orow >= R) continue;
            for (let kx = 0; kx < k; kx++) {
              const ocol = c - kx + half;
              if (ocol < 0 || ocol >= C) continue;
              const wb = ((ky * k + kx) * ic + i) * oc, ob = (orow * C + ocol) * oc;
              for (let o = 0; o < oc; o++) out[ob + o] += x * w[wb + o];
            }
          }
        }
      }
    }
    const relu = (a) => { for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0; };
    const feat = new Float32Array(NC * NP);
    const x = new Float32Array(NC * CH), y = new Float32Array(NC * CH), z = new Float32Array(NC * CH);
    const p1 = new Float32Array(NC * 32), p2 = new Float32Array(NC * 6), v1 = new Float32Array(NC * 8);
    const h = new Float32Array(64);

    // Returns { logits: Float32Array(180) (reused between calls), value }.
    const logits = new Float32Array(NA);
    function evaluate(s) {
      features(s, feat);
      apply(stem, feat, x); relu(x);
      for (const [c1, c2] of blocks) {
        apply(c1, x, y); relu(y);
        apply(c2, y, z);
        for (let i = 0; i < x.length; i++) { const t = x[i] + z[i]; x[i] = t > 0 ? t : 0; }
      }
      apply(pConv, x, p1); relu(p1);
      apply(pOut, p1, p2);
      for (let p = 0; p < NC; p++) for (let k = 0; k < 6; k++) logits[k * NC + p] = p2[p * 6 + k];
      apply(vConv, x, v1); relu(v1);
      h.set(fc1.b);
      for (let i = 0; i < 240; i++) {
        const t = v1[i];
        if (t === 0) continue;
        const wb = i * 64;
        for (let o = 0; o < 64; o++) h[o] += t * fc1.w[wb + o];
      }
      let v = fc2.b[0];
      for (let o = 0; o < 64; o++) if (h[o] > 0) v += h[o] * fc2.w[o];
      return { logits, value: Math.tanh(v) };
    }
    return { evaluate };
  }

  // ------------------------------------------------------------- search --
  const terminalValue = (s) => (s.winner === 2 ? 0 : s.winner === s.turn ? 1 : -1);

  // PUCT search from `root`.  Call step(n) repeatedly, then read result().
  function makeSearch(net, root, cpuct = 1.5, fpu = 0.25) {
    const mk = (s) => ({ s, n: 0, w: 0, edges: null });
    const top = mk(clone(root));
    let done = 0;

    function simulate() {
      const path = [];
      let node = top;
      while (true) {
        if (node.s.winner >= 0) return backup(path, node, terminalValue(node.s));
        if (!node.edges) break;
        const sq = Math.sqrt(Math.max(node.n, 1));
        const fq = (node.n > 0 ? node.w / node.n : 0) - fpu;
        let best = null, bs = -Infinity;
        for (const e of node.edges) {
          const sc = (e.n > 0 ? e.w / e.n : fq) + cpuct * e.p * sq / (1 + e.n);
          if (sc > bs) { bs = sc; best = e; }
        }
        path.push([node, best]);
        if (!best.child) best.child = mk(applyAction(clone(node.s), best.a));
        node = best.child;
      }
      const { logits, value } = net.evaluate(node.s);
      const acts = legalActions(node.s);
      let mx = -Infinity, sum = 0;
      for (const a of acts) mx = Math.max(mx, logits[a]);
      const pr = acts.map((a) => Math.exp(logits[a] - mx));
      for (const p of pr) sum += p;
      node.edges = acts.map((a, i) => ({ a, p: pr[i] / sum, n: 0, w: 0, child: null }));
      backup(path, node, value);
    }
    function backup(path, leaf, v) {
      leaf.n++; leaf.w += v;
      for (let i = path.length - 1; i >= 0; i--) {
        const [par, e] = path[i];
        const pv = par.s.turn === leaf.s.turn ? v : -v;
        e.n++; e.w += pv; par.n++; par.w += pv;
      }
      done++;
    }
    return {
      step(n) { for (let i = 0; i < n; i++) simulate(); return done; },
      result() {
        let best = null;
        for (const e of top.edges || []) if (!best || e.n > best.n) best = e;
        return { action: best ? best.a : -1, value: top.n ? top.w / top.n : 0, sims: done,
                 visits: (top.edges || []).map((e) => [e.a, e.n]) };
      },
    };
  }

  return { R, C, NC, NA, NP, MAX_PLY, DROP, MOVE, CAPTURE, newState, clone, legalActions,
           applyAction, features, moveTarget, threeCells, inThree, popcount, makeNet, makeSearch };
})();
if (typeof module !== "undefined") module.exports = Dara;
