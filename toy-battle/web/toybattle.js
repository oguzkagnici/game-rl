// Toy Battle in JavaScript: the same rules, features, search and network as toybattle/engine.cpp and
// toybattle/model.py, for the browser page.  tests/test_web.py checks it against the C++ engine and PyTorch.
(function (root) {
"use strict";
const MB = 15, MR = 14, NT = 8, NA = 161, MAXH = 12, MAXTURN = 200, MAXPLACED = 6;
const A_DRAW = 0, A_SKIP = 1, A_PLACE = 2, A_BASE = 138, A_TYPE = 153;
const FB = 48, FG = 96, FEAT = MB * FB + FG;
const MAIN = 0, EXTRA = 1, JUMBO = 2, RECALL = 3, ERUPT_SRC = 4, ERUPT_DST = 5, EXHUME = 6;
const E_RECALL = 1, E_DRAW = 3, E_ERUPT = 4, E_EXHUME = 5, E_SHIELD = 6, E_SNIPER = 7;
const TER = [];

function setTerrains(list) {            // list of the int arrays made by terrains.packed()
  TER.length = 0;
  for (const a of list) {
    const T = { nb: a[0], effect: a[1], objective: a[2], nreg: a[3], adj: [], special: [], gate: [],
                nhq: [0, 0], hqadj: [[0, 0], [0, 0]], hqgate: [[0, 0], [0, 0]], allhq: [0, 0], reg: [], regmed: [], dist: [[], []] };
    let i = 4;
    for (let b = 0; b < MB; b++) { T.adj.push(a[i]); T.special.push(a[i + 1]); T.gate.push(a[i + 2]); i += 3; }
    for (let p = 0; p < 2; p++) {
      T.nhq[p] = a[i++];
      for (let j = 0; j < 2; j++) { T.hqadj[p][j] = a[i]; T.hqgate[p][j] = a[i + 1]; T.allhq[p] |= a[i]; i += 2; }
    }
    for (let r = 0; r < MR; r++) { T.reg.push(a[i]); T.regmed.push(a[i + 1]); i += 2; }
    for (let p = 0; p < 2; p++) {
      for (let b = 0; b < MB; b++) T.dist[p][b] = (T.allhq[p] >> b) & 1 ? 1 : 99;
      for (let it = 0; it < MB; it++)
        for (let b = 0; b < T.nb; b++)
          for (let c = 0; c < T.nb; c++)
            if (((T.adj[b] >> c) & 1) && T.dist[p][c] + 1 < T.dist[p][b]) T.dist[p][b] = T.dist[p][c] + 1;
    }
    // attention masks of the network
    T.madj = new Float32Array(MB * MB); T.mshare = new Float32Array(MB * MB);
    for (let b = 0; b < T.nb; b++) for (let c = 0; c < T.nb; c++) if ((T.adj[b] >> c) & 1) T.madj[b * MB + c] = 1;
    for (let r = 0; r < T.nreg; r++)
      for (let b = 0; b < T.nb; b++) for (let c = 0; c < T.nb; c++)
        if (((T.reg[r] >> b) & 1) && ((T.reg[r] >> c) & 1)) T.mshare[b * MB + c] = 1;
    TER.push(T);
  }
}

// rack, pool, disc, known are indexed [player * 8 + type]; st is [base * 12 + height]; a tile is owner << 3 | type.
function newState() {
  return { ter: 0, turn: 0, phase: MAIN, winner: -1, h: new Uint8Array(MB), st: new Uint8Array(MB * MAXH),
           rack: new Uint8Array(16), pool: new Uint8Array(16), disc: new Uint8Array(16), known: new Uint8Array(16),
           reserve: [0, 0], medals: [0, 0], pin: [0, 0], placed: new Uint8Array(MAXPLACED), nplaced: 0, qi: 0, src: 0,
           taken: 0, nturn: 0, rng: 1 };
}
function clone(s) {
  return { ter: s.ter, turn: s.turn, phase: s.phase, winner: s.winner, h: s.h.slice(), st: s.st.slice(),
           rack: s.rack.slice(), pool: s.pool.slice(), disc: s.disc.slice(), known: s.known.slice(),
           reserve: [s.reserve[0], s.reserve[1]], medals: [s.medals[0], s.medals[1]], pin: [s.pin[0], s.pin[1]],
           placed: s.placed.slice(), nplaced: s.nplaced, qi: s.qi, src: s.src, taken: s.taken, nturn: s.nturn, rng: s.rng };
}
function rnd(s) { let x = s.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.rng = x >>> 0; return s.rng; }
function owner(s, b) { return s.h[b] ? s.st[b * MAXH + s.h[b] - 1] >> 3 : -1; }
function type(s, b) { return s.st[b * MAXH + s.h[b] - 1] & 7; }
function total(c, p) { let n = 0; for (let t = 0; t < NT; t++) n += c[p * 8 + t]; return n; }
function covers(mine, theirs) { return mine === 0 || theirs === 0 || mine > theirs; }
function occupied(s, p) { let m = 0; for (let b = 0; b < TER[s.ter].nb; b++) if (owner(s, b) === p) m |= 1 << b; return m; }
function popcount(x) { let n = 0; while (x) { x &= x - 1; n++; } return n; }

// conn = bases p occupies that are linked to one of p's H.Q.; range = bases p may place on.
function reach(s, p) {
  const T = TER[s.ter], occ = occupied(s, p);
  let front = T.allhq[p] & occ, conn = 0, range = T.allhq[p];
  while (front) {
    const b = 31 - Math.clz32(front & -front); front &= front - 1;
    conn |= 1 << b; range |= T.adj[b];
    front |= T.adj[b] & occ & ~conn;
  }
  return [conn, range];
}
function canPlace(s, p, t, b, range) {
  const T = TER[s.ter];
  if (s.h[b] >= MAXH || !((T.gate[b] >> t) & 1)) return false;
  if (owner(s, b) === 1 - p && !covers(t, type(s, b))) return false;
  if ((range >> b) & 1) return true;
  return t === 4 && !(T.effect === E_SHIELD && T.special[b]);
}
function available(s, p, t) { return s.rack[p * 8 + t] - (s.pin[p] === t + 1 ? 1 : 0); }
function placements(s, out) {
  const T = TER[s.ter], me = s.turn, [conn, range] = reach(s, me);
  for (let t = 0; t < NT; t++) {
    if (available(s, me, t) <= 0) continue;
    for (let b = 0; b < T.nb; b++) if (canPlace(s, me, t, b, range)) out.push(A_PLACE + t * 17 + b);
    for (let k = 0; k < T.nhq[1 - me]; k++)
      if ((T.hqadj[1 - me][k] & conn) && ((T.hqgate[1 - me][k] >> t) & 1)) out.push(A_PLACE + t * 17 + 15 + k);
  }
}
function canDraw(s, p) { return s.reserve[p] > 0 && total(s.rack, p) < 8; }

function legalActions(s) {
  const out = [];
  if (s.winner >= 0) return out;
  const T = TER[s.ter], me = s.turn;
  switch (s.phase) {
    case MAIN: if (canDraw(s, me)) out.push(A_DRAW); placements(s, out); break;
    case EXTRA: out.push(A_SKIP); placements(s, out); break;
    case JUMBO: case ERUPT_SRC:
      out.push(A_SKIP);
      for (let b = 0; b < T.nb; b++)
        if (((T.adj[s.src] >> b) & 1) && owner(s, b) === 1 - me) {
          let ok = s.phase === JUMBO;
          for (let c = 0; c < T.nb && !ok; c++) ok = ((T.adj[b] >> c) & 1) === 1 && s.h[c] < MAXH;
          if (ok) out.push(A_BASE + b);
        }
      break;
    case RECALL:
      out.push(A_SKIP);
      for (let b = 0; b < T.nb; b++) if (b !== s.src && owner(s, b) === me) out.push(A_BASE + b);
      break;
    case ERUPT_DST:
      for (let b = 0; b < T.nb; b++) if (((T.adj[s.src] >> b) & 1) && s.h[b] < MAXH) out.push(A_BASE + b);
      break;
    case EXHUME:
      out.push(A_SKIP);
      for (let t = 0; t < NT; t++) if (s.disc[me * 8 + t]) out.push(A_TYPE + t);
      break;
  }
  return out;
}

function pick(s, counts, p) {            // a uniformly random tile of a multiset
  let r = rnd(s) % total(counts, p);
  for (let t = 0; t < NT; t++) { if (r < counts[p * 8 + t]) return t; r -= counts[p * 8 + t]; }
  return 0;
}
function draw(s, p, n) {
  for (let k = 0; k < n && canDraw(s, p); k++) {
    const t = pick(s, s.pool, p);
    s.pool[p * 8 + t]--; s.rack[p * 8 + t]++; s.reserve[p]--;
  }
}
function loseFromRack(s, p, t) {
  const i = p * 8 + t;
  s.rack[i]--;
  if (s.known[i] > s.rack[i]) s.known[i] = s.rack[i];
  if (s.pin[p] === t + 1 && s.rack[i] === 0) s.pin[p] = 0;
}
function checkRegions(s) {
  const T = TER[s.ter];
  for (let k = 0; k < 2; k++) {
    const p = k ? 1 - s.turn : s.turn, occ = occupied(s, p);
    for (let r = 0; r < T.nreg; r++)
      if (!((s.taken >> r) & 1) && (T.reg[r] & occ) === T.reg[r]) { s.taken |= 1 << r; s.medals[p] += T.regmed[r]; }
    if (s.winner < 0 && s.medals[p] >= T.objective) s.winner = p;
  }
}
function endTurn(s) {
  s.pin[s.turn] = 0;
  s.phase = MAIN; s.nplaced = s.qi = 0;
  s.turn ^= 1; s.nturn++;
  const a = s.medals[0], b = s.medals[1];
  if (s.nturn >= MAXTURN) { s.winner = a > b ? 0 : b > a ? 1 : 2; return; }
  if (legalActions(s).length === 0) s.winner = a > b ? 0 : b > a ? 1 : 1 - s.turn;
}
function advance(s) {
  const T = TER[s.ter], me = s.turn, op = 1 - me;
  s.phase = MAIN;
  while (s.qi < s.nplaced) {
    const b = s.placed[s.qi++];
    if (!T.special[b] || owner(s, b) !== me) continue;
    switch (T.effect) {
      case E_DRAW: draw(s, me, 1); break;
      case E_RECALL: case E_ERUPT: case E_EXHUME:
        if (T.effect !== E_ERUPT && total(s.rack, me) >= 8) break;
        s.phase = T.effect === E_RECALL ? RECALL : T.effect === E_ERUPT ? ERUPT_SRC : EXHUME; s.src = b;
        if (legalActions(s).length > 1) return;
        s.phase = MAIN;
        break;
      case E_SNIPER:
        if (!s.pin[op] && total(s.rack, op) > 0) s.pin[op] = pick(s, s.rack, op) + 1;
        break;
    }
  }
  endTurn(s);
}
function place(s, t, slot) {
  const T = TER[s.ter], me = s.turn, op = 1 - me;
  loseFromRack(s, me, t);
  if (slot >= 15) { s.winner = me; return; }
  s.st[slot * MAXH + s.h[slot]++] = (me << 3) | t;
  if (s.nplaced < MAXPLACED) s.placed[s.nplaced++] = slot;
  checkRegions(s);
  if (s.winner >= 0) return;
  if (!(T.effect === E_SHIELD && T.special[slot])) {
    switch (t) {
      case 1: draw(s, me, 2); break;
      case 6: draw(s, me, 1); break;
      case 5:
        if (total(s.rack, op) > 0) { const x = pick(s, s.rack, op); loseFromRack(s, op, x); s.disc[op * 8 + x]++; }
        break;
      case 2: case 3:
        s.phase = t === 2 ? EXTRA : JUMBO; s.src = slot;
        if (legalActions(s).length > 1) return;
        break;
    }
  }
  advance(s);
}
function applyAction(s, a) {
  const me = s.turn, op = 1 - me;
  if (a === A_DRAW) { draw(s, me, 2); endTurn(s); return; }
  if (a === A_SKIP) { advance(s); return; }
  if (a < A_BASE) { place(s, Math.floor((a - A_PLACE) / 17), (a - A_PLACE) % 17); return; }
  if (a >= A_TYPE) {
    const t = a - A_TYPE;
    s.disc[me * 8 + t]--; s.rack[me * 8 + t]++; s.known[me * 8 + t]++;
    advance(s); return;
  }
  const b = a - A_BASE;
  if (s.phase === ERUPT_SRC) { s.src = b; s.phase = ERUPT_DST; return; }
  if (s.phase === JUMBO) { s.disc[op * 8 + type(s, b)]++; s.h[b]--; }
  else if (s.phase === RECALL) { const t = type(s, b); s.h[b]--; s.rack[me * 8 + t]++; s.known[me * 8 + t]++; }
  else { s.st[b * MAXH + s.h[b]++] = s.st[s.src * MAXH + s.h[s.src] - 1]; s.h[s.src]--; }
  checkRegions(s);
  if (s.winner < 0) advance(s);
}
function newGame(ter, first, seed) {
  const s = newState();
  s.ter = ter; s.turn = first; s.rng = (Math.imul(seed >>> 0, 2654435761 | 0) + 12345) >>> 0;
  if (!s.rng) s.rng = 1;
  for (let k = 0; k < 8; k++) rnd(s);
  for (let p = 0; p < 2; p++) {
    for (let t = 0; t < NT; t++) s.pool[p * 8 + t] = 3;
    s.reserve[p] = 20;
    draw(s, p, p === first ? 3 : 4);
  }
  return s;
}
// Re-deal everything `pov` cannot see: the opponent's rack (and which of its troops is pinned).
function determinize(s, pov, rand32) {
  const op = 1 - pov, n = total(s.rack, op) - total(s.known, op);
  s.rng = (rand32() | 1) >>> 0;
  for (let t = 0; t < NT; t++) { const i = op * 8 + t; s.pool[i] += s.rack[i] - s.known[i]; s.rack[i] = s.known[i]; }
  for (let k = 0; k < n; k++) { const t = pick(s, s.pool, op); s.pool[op * 8 + t]--; s.rack[op * 8 + t]++; }
  if (s.pin[op]) s.pin[op] = pick(s, s.rack, op) + 1;
}

function features(s) {
  const f = new Float32Array(FEAT), T = TER[s.ter], me = s.turn, op = 1 - me;
  const rm = reach(s, me), ro = reach(s, op), conn = [rm[0], ro[0]], range = [rm[1], ro[1]];
  const occ = [occupied(s, me), occupied(s, op)];
  const gain = [new Float32Array(MB), new Float32Array(MB)], open = new Float32Array(MB);
  for (let r = 0; r < T.nreg; r++) {
    if ((s.taken >> r) & 1) continue;
    for (let b = 0; b < T.nb; b++) {
      if (!((T.reg[r] >> b) & 1)) continue;
      open[b] += T.regmed[r];
      const rest = T.reg[r] & ~(1 << b);
      for (let k = 0; k < 2; k++) if ((rest & occ[k]) === rest) gain[k][b] += T.regmed[r];
    }
  }
  for (let b = 0; b < T.nb; b++) {
    const x = b * FB, o = owner(s, b);
    f[x] = 1; f[x + 1] = T.special[b];
    if (o < 0) f[x + 4] = 1;
    else {
      f[x + (o === me ? 2 : 3)] = 1; f[x + 5 + type(s, b)] = 1;
      f[x + 13] = s.h[b] / 4;
      if (s.h[b] > 1) { const u = s.st[b * MAXH + s.h[b] - 2]; f[x + ((u >> 3) === me ? 14 : 15)] = 1; f[x + 16] = (u & 7) / 7; }
      for (let i = 0; i < s.h[b]; i++) f[x + ((s.st[b * MAXH + i] >> 3) === me ? 17 : 18)] += 0.25;
    }
    for (let k = 0; k < 2; k++) {
      const p = k ? op : me;
      f[x + 19 + k] = (conn[k] >> b) & 1; f[x + 21 + k] = (range[k] >> b) & 1;
      f[x + 23 + k] = (T.allhq[p] >> b) & 1; f[x + 25 + k] = T.dist[p][b] / 6;
      f[x + 35 + k] = gain[k][b] / 3;
    }
    for (let t = 0; t < NT; t++) { f[x + 27 + t] = (T.gate[b] >> t) & 1; f[x + 40 + t] = canPlace(s, me, t, b, range[0]) ? 1 : 0; }
    f[x + 37] = open[b] / 6;
    f[x + 38] = s.phase !== MAIN && s.phase !== EXHUME && s.src === b ? 1 : 0;
    for (let i = s.qi; i < s.nplaced; i++) if (s.placed[i] === b && T.special[b]) f[x + 39] = 1;
  }
  const g = MB * FB;
  f[g + s.ter] = 1; f[g + 8 + s.phase] = 1;
  f[g + 15] = s.medals[me] / 8; f[g + 16] = s.medals[op] / 8; f[g + 17] = T.objective / 8;
  f[g + 18] = total(s.rack, me) / 8; f[g + 19] = total(s.rack, op) / 8;
  f[g + 20] = s.reserve[me] / 20; f[g + 21] = s.reserve[op] / 20;
  for (let t = 0; t < NT; t++) {
    f[g + 22 + t] = s.rack[me * 8 + t] / 3; f[g + 38 + t] = s.disc[me * 8 + t] / 3; f[g + 46 + t] = s.disc[op * 8 + t] / 3;
    f[g + 54 + t] = s.pool[me * 8 + t] / 3; f[g + 62 + t] = (s.rack[op * 8 + t] + s.pool[op * 8 + t]) / 3;
    f[g + 70 + t] = s.known[op * 8 + t] / 3;
  }
  if (s.pin[me]) f[g + 30 + s.pin[me] - 1] = 1;
  f[g + 78] = s.nturn / MAXTURN; f[g + 79] = canDraw(s, me) ? 1 : 0;
  for (let k = 0; k < T.nhq[op]; k++) f[g + 80 + k] = (T.hqadj[op][k] & conn[0]) !== 0 ? 1 : 0;
  f[g + 82] = s.pin[op] !== 0 ? 1 : 0; f[g + 83] = T.nhq[me] === 2 ? 1 : 0; f[g + 84] = T.nhq[op] === 2 ? 1 : 0;
  f[g + 85] = (s.medals[me] - s.medals[op]) / T.objective;
  f[g + 86] = popcount(occ[0]) / 15; f[g + 87] = popcount(occ[1]) / 15;
  for (let k = 0; k < T.nhq[me]; k++) f[g + 88 + k] = (T.hqadj[me][k] & conn[1]) !== 0 ? 1 : 0;
  return f;
}

// Same int layout as tb_get / tb_set in engine.cpp.
function fromDump(o) {
  const s = newState();
  s.ter = o[0]; s.turn = o[1]; s.phase = o[2]; s.winner = o[3]; s.nturn = o[4]; s.medals = [o[5], o[6]];
  s.reserve = [o[7], o[8]]; s.taken = o[9]; s.src = o[10]; s.pin = [o[11], o[12]]; s.nplaced = o[13]; s.qi = o[14];
  s.rng = (o[15] >>> 0) || 1;
  let i = 16;
  for (let b = 0; b < MB; b++) s.h[b] = o[i++];
  for (let k = 0; k < MB * MAXH; k++) s.st[k] = o[i++];
  for (const key of ["rack", "pool", "disc", "known"]) for (let k = 0; k < 16; k++) s[key][k] = o[i++];
  for (let k = 0; k < MAXPLACED; k++) s.placed[k] = o[i++];
  return s;
}
function toDump(s) {
  const o = [s.ter, s.turn, s.phase, s.winner, s.nturn, s.medals[0], s.medals[1], s.reserve[0], s.reserve[1], s.taken,
             s.src, s.pin[0], s.pin[1], s.nplaced, s.qi, s.rng | 0];
  for (let b = 0; b < MB; b++) o.push(s.h[b]);
  for (let b = 0; b < MB; b++) for (let k = 0; k < MAXH; k++) o.push(k < s.h[b] ? s.st[b * MAXH + k] : 0);
  for (const key of ["rack", "pool", "disc", "known"]) for (let k = 0; k < 16; k++) o.push(s[key][k]);
  for (let k = 0; k < MAXPLACED; k++) o.push(k < s.nplaced ? s.placed[k] : 0);
  return o;
}

// ------------------------------------------------------------------ network --

function f16to32(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], sgn = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
    out[i] = sgn * (e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15));
  }
  return out;
}
function erf(x) {                        // Abramowitz-Stegun 7.1.26, error below 1.5e-7
  const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
}
function gelu(x) { return 0.5 * x * (1 + erf(x * Math.SQRT1_2)); }

function loadNet(spec) {
  const bin = typeof atob === "function" ? Uint8Array.from(atob(spec.data), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(spec.data, "base64"));
  const all = f16to32(new Uint16Array(bin.buffer, bin.byteOffset, bin.length >> 1));
  const d = spec.dim, H = spec.heads, L = spec.layers, dh = d / H;
  let off = 0;
  const take = (n) => { const a = all.subarray(off, off + n); off += n; return a; };
  const lin = (nin, nout) => ({ w: take(nin * nout), b: take(nout), nin, nout });
  const norm = () => ({ w: take(d), b: take(d) });
  const W = { base_in: lin(FB, d), glob_in: lin(FG, d), glob_tok: lin(FG, d), layers: [] };
  for (let l = 0; l < L; l++) W.layers.push({ n1: norm(), qkv: lin(d, 3 * d), out: lin(d, d), n2: norm(), f1: lin(d, 2 * d), f2: lin(2 * d, d) });
  W.rel = take(L * H * 2); W.norm = norm();
  W.p_base = lin(d, NT + 1); W.p_glob = lin(d, 2 + 3 * NT); W.v1 = lin(2 * d, d); W.v2 = lin(d, 1);
  if (off !== all.length) throw new Error("weight size mismatch");

  // y[n rows of nout] = x[n rows of nin] W^T + b
  function linear(l, x, n, y) {
    const { w, b, nin, nout } = l;
    for (let r = 0; r < n; r++) {
      const xo = r * nin, yo = r * nout;
      for (let o = 0; o < nout; o++) {
        let acc = b[o]; const wo = o * nin;
        for (let i = 0; i < nin; i++) acc += w[wo + i] * x[xo + i];
        y[yo + o] = acc;
      }
    }
    return y;
  }
  function layerNorm(nm, x, n, y) {
    for (let r = 0; r < n; r++) {
      const o = r * d; let mean = 0, v = 0;
      for (let i = 0; i < d; i++) mean += x[o + i];
      mean /= d;
      for (let i = 0; i < d; i++) { const c = x[o + i] - mean; v += c * c; }
      const inv = 1 / Math.sqrt(v / d + 1e-5);
      for (let i = 0; i < d; i++) y[o + i] = (x[o + i] - mean) * inv * nm.w[i] + nm.b[i];
    }
    return y;
  }
  const N = MB + 1;
  const x = new Float32Array(N * d), y = new Float32Array(N * d), qkv = new Float32Array(N * 3 * d), att = new Float32Array(N * d),
        hid = new Float32Array(N * 2 * d), tmp = new Float32Array(N * d), sc = new Float32Array(N);

  // feat: Float32Array(FEAT) -> {logits: Float32Array(NA), value}
  return function evaluate(feat) {
    const glob = feat.subarray(MB * FB), T = TER[glob.subarray(0, 8).indexOf(1)], nb = T.nb, n = nb + 1;
    linear(W.glob_tok, glob, 1, x);
    linear(W.glob_in, glob, 1, tmp);
    linear(W.base_in, feat, nb, x.subarray(d));
    for (let b = 0; b < nb; b++) for (let i = 0; i < d; i++) x[(b + 1) * d + i] += tmp[i];
    const scale = 1 / Math.sqrt(dh);
    for (let l = 0; l < L; l++) {
      const ly = W.layers[l];
      linear(ly.qkv, layerNorm(ly.n1, x, n, y), n, qkv);
      for (let h = 0; h < H; h++) {
        const ra = W.rel[(l * H + h) * 2], rs = W.rel[(l * H + h) * 2 + 1], ho = h * dh;
        for (let i = 0; i < n; i++) {
          const qo = i * 3 * d + ho; let mx = -1e30;
          for (let j = 0; j < n; j++) {
            const ko = j * 3 * d + d + ho; let acc = 0;
            for (let c = 0; c < dh; c++) acc += qkv[qo + c] * qkv[ko + c];
            acc *= scale;
            if (i > 0 && j > 0) { const m = (i - 1) * MB + (j - 1); acc += ra * T.madj[m] + rs * T.mshare[m]; }
            sc[j] = acc; if (acc > mx) mx = acc;
          }
          let sum = 0;
          for (let j = 0; j < n; j++) { sc[j] = Math.exp(sc[j] - mx); sum += sc[j]; }
          const ao = i * d + ho;
          for (let c = 0; c < dh; c++) att[ao + c] = 0;
          for (let j = 0; j < n; j++) {
            const wgt = sc[j] / sum, vo = j * 3 * d + 2 * d + ho;
            for (let c = 0; c < dh; c++) att[ao + c] += wgt * qkv[vo + c];
          }
        }
      }
      linear(ly.out, att, n, tmp);
      for (let i = 0; i < n * d; i++) x[i] += tmp[i];
      linear(ly.f1, layerNorm(ly.n2, x, n, y), n, hid);
      for (let i = 0; i < n * 2 * d; i++) hid[i] = gelu(hid[i]);
      linear(ly.f2, hid, n, tmp);
      for (let i = 0; i < n * d; i++) x[i] += tmp[i];
    }
    layerNorm(W.norm, x, n, y);
    const pg = linear(W.p_glob, y, 1, new Float32Array(2 + 3 * NT));
    const pb = linear(W.p_base, y.subarray(d), nb, new Float32Array(nb * (NT + 1)));
    const logits = new Float32Array(NA);
    logits[A_DRAW] = pg[0]; logits[A_SKIP] = pg[1];
    for (let t = 0; t < NT; t++) {
      for (let b = 0; b < nb; b++) logits[A_PLACE + t * 17 + b] = pb[b * (NT + 1) + t];
      logits[A_PLACE + t * 17 + 15] = pg[2 + t * 2]; logits[A_PLACE + t * 17 + 16] = pg[3 + t * 2];
      logits[A_TYPE + t] = pg[2 + 2 * NT + t];
    }
    for (let b = 0; b < nb; b++) logits[A_BASE + b] = pb[b * (NT + 1) + NT];
    const gm = new Float32Array(2 * d);
    for (let i = 0; i < d; i++) { gm[i] = y[i]; let m = 0; for (let b = 1; b < n; b++) m += y[b * d + i]; gm[d + i] = m / nb; }
    const v1 = linear(W.v1, gm, 1, new Float32Array(d));
    for (let i = 0; i < d; i++) v1[i] = gelu(v1[i]);
    return { logits, value: Math.tanh(linear(W.v2, v1, 1, new Float32Array(1))[0]) };
  };
}

// ------------------------------------------------------------------- search --
// `sims` simulations in each of `deals` re-deals of the tiles the player to move cannot see.
// step(budget) runs up to `budget` network evaluations and returns true when the search is finished.
function makeSearch(game, evaluate, sims, deals, rand32, cpuct = 1.5, fpu = 0.25) {
  const S = { visits: new Float64Array(NA), qsum: new Float64Array(NA), vsum: 0, vn: 0, dealsLeft: deals, evals: 0, total: sims * deals, simsDone: 0 };
  let nodes, done, path, leaf;
  const startDeal = () => {
    const root = { s: clone(game), n: 0, w: 0, edges: null };
    determinize(root.s, game.turn, rand32);
    nodes = root; done = 0;
  };
  const backup = (v) => {
    const tl = leaf.s.turn;
    leaf.n++; leaf.w += v;
    for (let i = path.length - 1; i >= 0; i--) {
      const [par, e] = path[i], pv = par.s.turn === tl ? v : -v;
      e.n++; e.w += pv; par.n++; par.w += pv;
    }
    done++; S.simsDone++;
  };
  const descend = () => {                 // true when a leaf waits for the network
    while (done < sims) {
      path = [];
      let nd = nodes;
      for (;;) {
        if (nd.s.winner >= 0) { leaf = nd; backup(nd.s.winner === 2 ? 0 : nd.s.winner === nd.s.turn ? 1 : -1); break; }
        if (!nd.edges) { leaf = nd; return true; }
        const sq = Math.sqrt(Math.max(nd.n, 1)), fq = (nd.n > 0 ? nd.w / nd.n : 0) - fpu;
        let best = null, bs = -1e30;
        for (const e of nd.edges) {
          const sc = (e.n > 0 ? e.w / e.n : fq) + cpuct * e.p * sq / (1 + e.n);
          if (sc > bs) { bs = sc; best = e; }
        }
        path.push([nd, best]);
        if (!best.child) { const cs = clone(nd.s); applyAction(cs, best.a); best.child = { s: cs, n: 0, w: 0, edges: null }; }
        nd = best.child;
      }
    }
    return false;
  };
  const expand = () => {
    const acts = legalActions(leaf.s), { logits, value } = evaluate(features(leaf.s));
    let mx = -1e30, sum = 0;
    for (const a of acts) if (logits[a] > mx) mx = logits[a];
    const pr = acts.map((a) => { const p = Math.exp(logits[a] - mx); sum += p; return p; });
    leaf.edges = acts.map((a, i) => ({ a, p: pr[i] / sum, n: 0, w: 0, child: null }));
    backup(value);
  };
  startDeal();
  S.step = (budget) => {
    while (S.dealsLeft > 0) {
      if (descend()) {
        if (budget-- <= 0) return false;
        expand(); S.evals++;
        continue;
      }
      for (const e of nodes.edges || []) { S.visits[e.a] += e.n; S.qsum[e.a] += e.w; }
      S.vsum += nodes.w; S.vn += nodes.n;
      if (--S.dealsLeft > 0) startDeal();
    }
    return true;
  };
  S.best = () => { let b = -1, bv = -1; for (let a = 0; a < NA; a++) if (S.visits[a] > bv) { bv = S.visits[a]; b = a; } return b; };
  S.value = () => (S.vn > 0 ? S.vsum / S.vn : 0);        // for the player to move, in [-1, 1]
  return S;
}

const TB = { MB, NT, NA, MAXH, MAXTURN, FEAT, A_DRAW, A_SKIP, A_PLACE, A_BASE, A_TYPE,
             MAIN, EXTRA, JUMBO, RECALL, ERUPT_SRC, ERUPT_DST, EXHUME, TER,
             setTerrains, newState, clone, newGame, legalActions, applyAction, features, determinize, owner, type, total,
             reach, canDraw, fromDump, toDump, loadNet, makeSearch };
if (typeof module !== "undefined" && module.exports) module.exports = TB; else root.TB = TB;
})(typeof self !== "undefined" ? self : this);
