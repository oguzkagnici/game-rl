// Replays positions recorded from the C++ engine and PyTorch through web/toybattle.js.
//   node tests/web_check.js cases.json
const TB = require("../web/toybattle.js");
const data = JSON.parse(require("fs").readFileSync(process.argv[2]));
TB.setTerrains(data.terrains.map((t) => t.packed));
const evaluate = TB.loadNet(data.net);
let bad = 0, featErr = 0, logitErr = 0, valueErr = 0;
for (const c of data.cases) {
  const s = TB.fromDump(c.dump);
  const legal = TB.legalActions(s).slice().sort((a, b) => a - b);
  if (JSON.stringify(legal) !== JSON.stringify(c.legal)) { bad++; if (bad < 4) console.log("legal differs", c.dump.slice(0, 5), legal, c.legal); }
  const f = TB.features(s);
  for (let i = 0; i < f.length; i++) featErr = Math.max(featErr, Math.abs(f[i] - c.feat[i]));
  if (c.logits) {
    const { logits, value } = evaluate(f);
    for (const a of c.legal) logitErr = Math.max(logitErr, Math.abs(logits[a] - c.logits[a]));
    valueErr = Math.max(valueErr, Math.abs(value - c.value));
  }
  TB.applyAction(s, c.action);
  const next = TB.toDump(s);
  if (JSON.stringify(next) !== JSON.stringify(c.next)) { bad++; if (bad < 4) console.log("next state differs after action", c.action, "\n", JSON.stringify(next), "\n", JSON.stringify(c.next)); }
}
// the search with the network against random play, a few games per terrain
let seed = 12345;
const rand32 = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
let wins = 0, games = 0, ms = 0, evals = 0;
for (let g = 0; g < 16; g++) {
  const s = TB.newGame(g % 8, (g >> 3) & 1, rand32()), net = g & 1;
  while (s.winner < 0) {
    const acts = TB.legalActions(s);
    let a = acts[rand32() % acts.length];
    if (s.turn === net && acts.length > 1) {
      const t0 = Date.now(), S = TB.makeSearch(s, evaluate, 20, 2, rand32);
      S.step(1e9); a = S.best(); ms += Date.now() - t0; evals += S.evals;
      if (!acts.includes(a)) { bad++; console.log("search returned an illegal action", a); break; }
    }
    TB.applyAction(s, a);
  }
  games++; wins += s.winner === net;
}
console.log(JSON.stringify({ cases: data.cases.length, mismatches: bad, featErr, logitErr, valueErr,
                             search_vs_random: `${wins}/${games}`, ms_per_eval: +(ms / evals).toFixed(2) }));
process.exit(bad || featErr > 1e-6 || logitErr > 0.02 || valueErr > 0.01 || wins < games - 1 ? 1 : 0);
