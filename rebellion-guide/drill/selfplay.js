// Bot-vs-bot games for balancing the drill: node selfplay.js [games] [levelI] [levelD]
"use strict";
var D = require("./engine.js"), B = require("./bots.js");

function playOne(seed, lvlI, lvlD) {
  var g = D.newGame({ seed: seed }), s = g.s, guard = 0;
  var pb = B.Ins.placeBase(g, lvlI); D.placeBase(g, pb.sys);
  while (!s.winner && guard++ < 2000) {
    if (s.phase === "assign") {
      D.submitAssignment(g, "D", B.Dom.assign(g, lvlD).list);
      D.submitAssignment(g, "I", B.Ins.assign(g, lvlI).list);
    } else if (s.phase === "command") {
      if (s.pending) {
        var side = D.other(s.pending.side);
        var op = B.BOT[side].oppose(g, side === "I" ? lvlI : lvlD);
        D.oppose(g, side, op.leader);
      } else {
        var t = s.turn;
        B.act(g, t, B.BOT[t].command(g, t === "I" ? lvlI : lvlD));
      }
    } else throw new Error("stuck in phase " + s.phase);
  }
  return g;
}

if (require.main === module) {
  var n = +process.argv[2] || 400, lvlI = process.argv[3] || "veteran", lvlD = process.argv[4] || "veteran";
  var stats = { I: 0, D: 0, rounds: 0, reloc: 0, scored: 0, revealed: 0, errors: 0, byRound: {}, how: {} };
  for (var i = 0; i < n; i++) {
    var g;
    try { g = playOne(1000 + i, lvlI, lvlD); } catch (e) { stats.errors++; if (stats.errors < 4) console.error(e.stack); continue; }
    var s = g.s;
    stats[s.winner]++; stats.rounds += s.round; stats.reloc += s.relocations; stats.scored += s.objScored.length;
    stats.byRound[s.round] = (stats.byRound[s.round] || 0) + 1;
    var how = s.winner === "D" ? (s.log.some(function (e) { return e.kind === "reveal" && /loyalty|control/.test(e.text); }) ? "D:decree/control" : "D:troops") : "I:clock";
    stats.how[how] = (stats.how[how] || 0) + 1;
  }
  var m = n - stats.errors;
  console.log("games", m, "errors", stats.errors, "| Insurgents", (stats.I / m * 100).toFixed(1) + "%", "Dominion", (stats.D / m * 100).toFixed(1) + "%");
  console.log("avg rounds", (stats.rounds / m).toFixed(2), "| relocations/game", (stats.reloc / m).toFixed(2), "| objectives/game", (stats.scored / m).toFixed(2));
  console.log("game ends in round", JSON.stringify(stats.byRound), "| how", JSON.stringify(stats.how));
}
module.exports = { playOne: playOne };
