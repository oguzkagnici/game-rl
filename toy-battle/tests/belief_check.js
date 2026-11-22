// The page's belief tracking: in self-play, are its guesses of the hidden rack closer than uniform re-deals?
//   python web/build.py && node tests/belief_check.js web/dist/weights.json web/dist/index.html [games]
const fs = require("fs");
const TB = require("../web/toybattle.js");
const page = fs.readFileSync(process.argv[3], "utf8");
const data = JSON.parse(page.slice(page.indexOf("window.TB_DATA = ") + 17, page.indexOf(";\n", page.indexOf("window.TB_DATA = "))));
TB.setTerrains(data.terrains.map((t) => t.packed));
const evaluate = TB.loadNet(JSON.parse(fs.readFileSync(process.argv[2])));
let seed = 2024;
const rand32 = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
let errB = 0, errU = 0, n = 0, resets = 0, wins = [0, 0];
const games = +(process.argv[4] || 4);
for (let g = 0; g < games; g++) {
  const s = TB.newGame(g % 8, g & 1, rand32()), me = (g >> 1) & 1, B = TB.makeBelief(evaluate, me, rand32);
  while (s.winner < 0) {
    const acts = TB.legalActions(s);
    let a = acts[0];
    if (acts.length > 1) {
      const search = TB.makeSearch(s, evaluate, 16, 2, rand32, 1.5, 0.25, s.turn === me ? B.deals(s, 2) : null);
      search.step(1e9); a = search.best();
    }
    const before = TB.clone(s);
    TB.applyAction(s, a);
    B.observe(before, a, s); B.work();
    if (s.winner >= 0 || !B.parts()) continue;
    const op = 1 - me, dist = (rack) => { let d = 0; for (let t = 0; t < 8; t++) d += Math.abs(rack[t] - s.rack[op * 8 + t]); return d / 2; };
    for (const p of B.parts().slice(0, 57)) errB += dist(p.rack) / 57;      // the resampled ones (the rest are fresh uniform)
    for (let k = 0; k < 8; k++) { const c = TB.clone(s); TB.determinize(c, me, rand32); errU += dist(c.rack.slice(op * 8, op * 8 + 8)) / 8; }
    n++;
  }
  wins[s.winner === me ? 0 : 1]++; resets += B.resets;
}
console.log(`belief ${(errB / n).toFixed(2)} tiles wrong per guess, uniform ${(errU / n).toFixed(2)}; ${n} updates, ${resets} resets; believer won ${wins[0]} of ${games}`);
process.exit(errB < errU ? 0 : 1);
