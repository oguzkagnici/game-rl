// Board Game Arena <-> engine: match a BGA board to one of our terrains and turn BGA's `gamedatas`
// into an engine state for the player to move.  Pure functions, no browser; bot.js drives the page.
"use strict";
const path = require("path");
const TB = require(path.join(__dirname, "..", "web", "toybattle.js"));
const TERR = require(path.join(__dirname, "terrains.json"));
TB.setTerrains(TERR.map((t) => t.packed));

const BLUE_COLOR = "4f66a2";
const MEDALS_TO_WIN = [7, 6, 8, 7, 7, 5, 7, 8];   // from BGA's client, board ids 1..8

// BGA troop type = (colour + 1) * 10 + kind; kind 1..7 = Skully..Roxy, 8 = Kwak.  Engine: 0 = Kwak.
const kindOf = (type) => { const k = +type % 10; return k === 8 ? 0 : k; };
const colourOf = (type) => Math.floor(+type / 10) - 1;
const bgaKind = (t) => (t === 0 ? 8 : t);

// Minimum-cost assignment (Hungarian, O(n^3)); cost[i][j], square.
function assign(cost) {
  const n = cost.length, INF = 1e18, u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Array(n + 1).fill(INF), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = new Array(n);
  for (let j = 1; j <= n; j++) res[p[j] - 1] = j - 1;
  return res;                                        // res[i] = column given to row i
}

function normalise(pts) {
  const out = pts.map((q) => ({ ...q }));
  for (const k of ["x", "y"]) {
    const m = out.reduce((a, q) => a + q[k], 0) / out.length;
    const sd = Math.sqrt(out.reduce((a, q) => a + (q[k] - m) ** 2, 0) / out.length) || 1;
    for (const q of out) q[k] = (q[k] - m) / sd;
  }
  return out;
}

// Match BGA's board (gamedatas.bases / regions) to our terrain by position, then check that paths,
// H.Q.s, regions and medals agree.  Returns the mapping; `problems` lists every disagreement.
function matchTerrain(gd) {
  // BGA's "Christmas" board (9) has Castle Field's effect; accept it only if its graph is Castle Field's
  const bid = +gd.board_id === 9 ? 1 : +gd.board_id, problems = [];
  if (!(bid >= 1 && bid <= 8)) return { ok: false, problems: [`board ${gd.board_name} (${bid}) is not one of the 8 trained terrains`] };
  const ter = bid - 1, T = TERR[ter];
  const ours = [];
  T.bases.forEach((b, i) => ours.push({ kind: "base", i, x: b.x, y: b.y / 1.66 }));
  T.hqs.forEach((hs, p) => hs.forEach((h, k) => ours.push({ kind: "hq", p, k, x: h.x, y: h.y / 1.66 })));
  const theirs = Object.values(gd.bases).map((b) => ({ id: +b.value, x: +b.left, y: +b.top, adj: b.adjacents.map(Number), power: +b.power }));
  if (ours.length !== theirs.length) return { ok: false, problems: [`${T.name}: BGA has ${theirs.length} bases + H.Q., ours ${ours.length}`] };

  const A = normalise(theirs), B = normalise(ours);
  const cost = A.map((a) => B.map((b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2));
  const col = assign(cost);
  const nodeOf = {};                                  // BGA id -> our node
  theirs.forEach((t, r) => { nodeOf[t.id] = ours[col[r]]; });
  const key = (n) => (n.kind === "base" ? `b${n.i}` : `h${n.p}${n.k}`);

  // paths
  const ourEdges = new Set();
  T.bases.forEach((b, i) => b.adj.forEach((j) => ourEdges.add([`b${i}`, `b${j}`].sort().join("-"))));
  T.hqs.forEach((hs, p) => hs.forEach((h, k) => h.adj.forEach((j) => ourEdges.add([`h${p}${k}`, `b${j}`].sort().join("-")))));
  const theirEdges = new Set();
  for (const t of theirs) for (const j of t.adj) {
    if (!nodeOf[j]) { problems.push(`BGA base ${t.id} lists unknown neighbour ${j}`); continue; }
    theirEdges.add([key(nodeOf[t.id]), key(nodeOf[j])].sort().join("-"));
  }
  for (const e of theirEdges) if (!ourEdges.has(e)) problems.push(`path ${e} on BGA, not in ours`);
  for (const e of ourEdges) if (!theirEdges.has(e)) problems.push(`path ${e} in ours, not on BGA`);

  // H.Q. colours: Blue's H.Q. is at the bottom in both
  const hqIds = [[], []], baseId = new Array(T.bases.length), idxOf = {};
  for (const t of theirs) {
    const n = nodeOf[t.id];
    if (n.kind === "hq") hqIds[n.p][n.k] = t.id; else { baseId[n.i] = t.id; idxOf[t.id] = n.i; }
  }

  // regions and medals
  const regionMap = {};                               // BGA region id -> our region index
  const ourRegs = T.regions.map((r) => ({ set: [...r.bases].sort((a, b) => a - b).join(","), medals: r.medals }));
  for (const [rid, r] of Object.entries(gd.regions || {})) {
    const set = r.bases.map((x) => idxOf[+x]);
    if (set.some((x) => x === undefined)) { problems.push(`BGA region ${rid} includes an H.Q. or unknown base`); continue; }
    const s = set.sort((a, b) => a - b).join(",");
    const j = ourRegs.findIndex((q, j2) => q.set === s && !Object.values(regionMap).includes(j2));
    if (j < 0) { problems.push(`BGA region ${rid} (bases ${s}, ${r.medals} medals) has no match in ours`); continue; }
    if (ourRegs[j].medals !== +r.medals) problems.push(`region ${rid} (bases ${s}): BGA ${r.medals} medals, ours ${ourRegs[j].medals}`);
    regionMap[rid] = j;
  }
  if (Object.keys(gd.regions || {}).length !== T.regions.length)
    problems.push(`BGA has ${Object.keys(gd.regions || {}).length} regions, ours ${T.regions.length}`);
  if (T.objective !== MEDALS_TO_WIN[ter]) problems.push(`objective: BGA ${MEDALS_TO_WIN[ter]}, ours ${T.objective}`);

  return { ok: problems.length === 0, problems, ter, T, nodeOf, baseId, hqIds, idxOf, regionMap,
           power: theirs.map((t) => ({ id: t.id, node: key(nodeOf[t.id]), power: t.power })) };
}

function myColour(gd, myId) { return gd.players[myId].color === BLUE_COLOR ? 0 : 1; }

// Engine state for `me` to move, at the start of a turn (phase MAIN); the caller sets phase / src /
// placed for the steps inside a turn.  `mem.known[t]`: opponent's rack tiles we have seen go back to it.
function buildState(gd, M, myId, mem = {}) {
  const s = TB.newState(), me = myColour(gd, myId), op = 1 - me;
  s.ter = M.ter; s.turn = me; s.phase = TB.MAIN; s.winner = -1;
  const onBoard = new Uint8Array(16);
  const stacks = {};
  for (const tr of Object.values(gd.board_troops || {})) (stacks[+tr.location_arg] ||= []).push(tr);
  for (const [bid, list] of Object.entries(stacks)) {
    const b = M.idxOf[+bid];
    if (b === undefined) throw new Error(`troop on BGA base ${bid}, which is not a base of ours`);
    list.sort((x, y) => +x.ordre - +y.ordre);
    for (const tr of list) {
      const c = colourOf(tr.type), k = kindOf(tr.type);
      s.st[b * TB.MAXH + s.h[b]++] = (c << 3) | k;
      onBoard[c * 8 + k]++;
    }
  }
  for (const tr of Object.values(gd.my_discard || {})) s.disc[me * 8 + kindOf(tr.type)]++;
  for (const tr of Object.values(gd.your_discard || {})) s.disc[op * 8 + kindOf(tr.type)]++;
  for (const tr of Object.values(gd.my_hand || {})) {
    const k = kindOf(tr.type);
    s.rack[me * 8 + k]++;
    if (+tr.blocked > 0) s.pin[me] = k + 1;
  }
  // our own tiles we have not seen: 3 of each, minus board, discard, rack
  for (let t = 0; t < 8; t++) s.pool[me * 8 + t] = 3 - onBoard[me * 8 + t] - s.disc[me * 8 + t] - s.rack[me * 8 + t];
  // opponent: known rack tiles, the rest dealt arbitrarily (every search re-deals them)
  const opHand = Object.values(gd.your_hand || {}).length;
  const known = (mem.known || []).slice(0, 8);
  for (let t = 0; t < 8; t++) {
    const free = 3 - onBoard[op * 8 + t] - s.disc[op * 8 + t];
    const kn = Math.max(0, Math.min(known[t] || 0, free));
    s.known[op * 8 + t] = kn; s.rack[op * 8 + t] = kn; s.pool[op * 8 + t] = free - kn;
  }
  let left = opHand - TB.total(s.rack, op);
  for (let t = 0; t < 8 && left > 0; t++) {
    const n = Math.min(left, s.pool[op * 8 + t]);
    s.pool[op * 8 + t] -= n; s.rack[op * 8 + t] += n; left -= n;
  }
  const opPinned = (op === 0 ? gd.blue_blocked : gd.red_blocked) || [];
  if (opPinned.length) for (let t = 0; t < 8; t++) if (s.rack[op * 8 + t]) { s.pin[op] = t + 1; break; }
  s.reserve = [+gd.nb_deck_blue, +gd.nb_deck_red];
  // BGA's score is the medal count; regions no longer in full_regions have been taken.
  for (const id of Object.keys(gd.players)) s.medals[myColour(gd, id)] = +gd.players[id].score;
  const full = new Set((gd.full_regions || []).map(String));
  for (const [rid, j] of Object.entries(M.regionMap)) if (!full.has(String(rid))) s.taken |= 1 << j;
  // turns so far, for the network's clock: one per placement, one per double draw (approximate)
  const placed = TB.total(onBoard, 0) + TB.total(onBoard, 1) + TB.total(s.disc, 0) + TB.total(s.disc, 1);
  const drawn = Math.max(0, 40 - s.reserve[0] - s.reserve[1] - 7);
  s.nturn = Math.min(TB.MAXTURN - 1, placed + Math.floor(drawn / 2));
  s.rng = ((Math.random() * 4294967296) >>> 0) || 1;
  return s;
}

module.exports = { TB, TERR, kindOf, colourOf, bgaKind, matchTerrain, buildState, myColour, BLUE_COLOR };
