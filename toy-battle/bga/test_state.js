// Round trip: engine state -> BGA-shaped gamedatas (shuffled ids, shifted and scaled coordinates) ->
// matchTerrain + buildState -> the same network input.  node bga/test_state.js
"use strict";
const { TB, TERR, bgaKind, matchTerrain, buildState, BLUE_COLOR } = require("./state.js");

let seed = 12345;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function fakeGamedatas(s, ter) {
  const T = TERR[ter], me = s.turn, op = 1 - me;
  const nodes = [];
  T.bases.forEach((b, i) => nodes.push({ key: `b${i}`, x: b.x, y: b.y }));
  T.hqs.forEach((hs, p) => hs.forEach((h, k) => nodes.push({ key: `h${p}${k}`, x: h.x, y: h.y })));
  const ids = shuffle(nodes.map((_, i) => 1 + i * 3));
  const idOf = {}; nodes.forEach((n, i) => { idOf[n.key] = ids[i]; });
  const adj = {}; nodes.forEach((n) => { adj[n.key] = []; });
  T.bases.forEach((b, i) => b.adj.forEach((j) => adj[`b${i}`].push(idOf[`b${j}`])));
  T.hqs.forEach((hs, p) => hs.forEach((h, k) => h.adj.forEach((j) => { adj[`h${p}${k}`].push(idOf[`b${j}`]); adj[`b${j}`].push(idOf[`h${p}${k}`]); })));
  const bases = {};
  for (const n of nodes) bases[idOf[n.key]] = { value: idOf[n.key], adjacents: adj[n.key], power: 0,
    left: 2 + n.x * 0.93 + (rand() - 0.5) * 1.5, top: 1 + (n.y / 166) * 97 + (rand() - 0.5) * 1.5 };
  const regions = {}, full = [];
  T.regions.forEach((r, j) => { regions[j + 10] = { value: j + 10, bases: r.bases.map((b) => idOf[`b${b}`]), medals: r.medals };
    if (!((s.taken >> j) & 1)) full.push(String(j + 10)); });
  let tid = 100;
  const board_troops = {};
  for (let b = 0; b < T.bases.length; b++) for (let k = 0; k < s.h[b]; k++) {
    const tile = s.st[b * TB.MAXH + k];
    board_troops[tid] = { id: tid, type: ((tile >> 3) + 1) * 10 + bgaKind(tile & 7), location_arg: idOf[`b${b}`], ordre: k + 1 }; tid++;
  }
  const tiles = (counts, p) => { const out = []; for (let t = 0; t < 8; t++) for (let k = 0; k < counts[p * 8 + t]; k++) out.push(t); return out; };
  let pinnedDone = false;
  const my_hand = tiles(s.rack, me).map((t) => {
    const pin = !pinnedDone && s.pin[me] === t + 1; if (pin) pinnedDone = true;
    return { id: String(tid++), type: String((me + 1) * 10 + bgaKind(t)), blocked: pin ? "1" : "0" };
  });
  const your_hand = tiles(s.rack, op).map(() => ({ type: String(op + 1), blocked: "0" }));
  const disc = (p) => tiles(s.disc, p).map((t) => ({ id: String(tid++), type: String((p + 1) * 10 + bgaKind(t)) }));
  const myId = 555, opId = 777;
  return { myId, gd: {
    board_id: String(ter + 1), board_name: T.name, bases, regions, board_troops, my_hand, your_hand,
    my_discard: disc(me), your_discard: disc(op), full_regions: full,
    nb_deck_blue: String(s.reserve[0]), nb_deck_red: String(s.reserve[1]),
    blue_blocked: op === 0 && s.pin[0] ? ["1"] : [], red_blocked: op === 1 && s.pin[1] ? ["1"] : [],
    players: { [myId]: { id: String(myId), color: me === 0 ? BLUE_COLOR : "d1553e", score: String(s.medals[me]) },
               [opId]: { id: String(opId), color: op === 0 ? BLUE_COLOR : "d1553e", score: String(s.medals[op]) } },
  } };
}

const G = TB.MB * 48;
const skip = new Set([G + 78, ...[0, 1, 2, 3, 4, 5, 6, 7].map((t) => G + 70 + t)]);   // turn clock, known tiles
let checked = 0, bad = 0;
for (let ter = 0; ter < 8; ter++) {
  for (let g = 0; g < 40; g++) {
    const s = TB.newGame(ter, g & 1, 1000 * ter + g);
    let moves = 0;
    while (s.winner < 0 && moves < 300) {
      if (s.phase === TB.MAIN && rand() < 0.3) {
        const { gd, myId } = fakeGamedatas(s, ter);
        const M = matchTerrain(gd);
        if (!M.ok) { console.log("match failed", TERR[ter].name, M.problems.slice(0, 5)); process.exit(1); }
        const t = buildState(gd, M, myId);
        const a = TB.features(s), b = TB.features(t);
        let diff = -1;
        for (let i = 0; i < a.length; i++) if (!skip.has(i) && Math.abs(a[i] - b[i]) > 1e-6) { diff = i; break; }
        const la = TB.legalActions(s).join(), lb = TB.legalActions(t).join();
        if (diff >= 0 || la !== lb) {
          if (bad++ < 5) console.log(TERR[ter].name, "feature", diff, a[diff], b[diff], "legal equal", la === lb);
        }
        checked++;
      }
      const acts = TB.legalActions(s);
      TB.applyAction(s, acts[Math.floor(rand() * acts.length)]);
      moves++;
    }
  }
}
console.log(`${checked} positions, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
