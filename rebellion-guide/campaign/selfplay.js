// Bot-vs-bot games for balancing the campaign: node selfplay.js [games] [levelI] [levelD]
"use strict";
var C = require("./engine.js"), B = require("./bots.js");

function playOne(seed, lvlI, lvlD) {
  var g = C.newGame({ seed: seed }), guard = 0, side;
  while ((side = C.decider(g)) && guard++ < 5000) B.step(g, side, side === "I" ? lvlI : lvlD);
  if (!g.s.winner) throw new Error("game stuck in phase " + g.s.phase + " round " + g.s.round);
  return g;
}

if (require.main === module) {
  var n = +process.argv[2] || 200, lvlI = process.argv[3] || "veteran", lvlD = process.argv[4] || "veteran";
  var st = { I: 0, D: 0, rounds: 0, reloc: 0, scored: 0, battles: 0, errors: 0, byRound: {}, how: {}, superBuilt: 0, superFired: 0, plans: 0, captures: 0 };
  var t0 = Date.now();
  for (var i = 0; i < n; i++) {
    var g;
    try { g = playOne(5000 + i, lvlI, lvlD); } catch (e) { st.errors++; if (st.errors < 4) console.error(e.stack); continue; }
    var s = g.s;
    st[s.winner]++; st.rounds += s.round; st.reloc += s.relocations; st.scored += s.objScored.length;
    st.byRound[s.round] = (st.byRound[s.round] || 0) + 1;
    st.battles += s.log.filter(function (e) { return e.kind === "battleEnd"; }).length;
    st.superBuilt += s.superBuilt ? 1 : 0; st.plans += s.plans ? 1 : 0;
    st.superFired += s.log.filter(function (e) { return e.kind === "annihilate"; }).length;
    st.captures += s.log.filter(function (e) { return e.kind === "capture"; }).length;
    var how = s.winner === "I" ? "clock" : "base taken";
    st.how[how] = (st.how[how] || 0) + 1;
  }
  var m = n - st.errors;
  console.log("games", m, "errors", st.errors, "| Insurgents", (st.I / m * 100).toFixed(1) + "%", "Dominion", (st.D / m * 100).toFixed(1) + "%", "|", ((Date.now() - t0) / m).toFixed(0), "ms/game");
  console.log("avg rounds", (st.rounds / m).toFixed(2), "| relocations", (st.reloc / m).toFixed(2), "| objectives", (st.scored / m).toFixed(2), "| battles", (st.battles / m).toFixed(1),
    "| superweapon built", (st.superBuilt / m * 100).toFixed(0) + "%", "fired", (st.superFired / m).toFixed(2), "| plans", (st.plans / m * 100).toFixed(0) + "%", "| captures", (st.captures / m).toFixed(2));
  console.log("ends in round", JSON.stringify(st.byRound), JSON.stringify(st.how));
}
module.exports = { playOne: playOne };
