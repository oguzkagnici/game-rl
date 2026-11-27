/* Sparring drill: scripted opponents and the coach's suggestions.
 *
 * Each side's bot scores every option with a few strategic terms (the same ideas the guide
 * teaches), picks the best one and returns a one-line reason. The coach uses the same
 * functions to suggest a move for the player, so the reasons double as teaching text.
 *
 * Reasons are written only from public information plus the bot's own secrets, and the
 * Insurgent bot never mentions its base location: the UI shows its reasons to the player.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"));
  else root.DrillBots = factory(root.Drill);
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";
  var SYS = D.SYS, DIST = D.DIST, N = SYS.length;
  var est = D.makeRng(12345);   // private dice for battle estimates; never touches the game's dice

  function nm(i) { return SYS[i].n; }
  function noise(g, lvl) { return lvl === "recruit" ? (est() - 0.5) * 2.2 : (est() - 0.5) * 0.15; }

  // ------------------------------------------------------------ estimates
  function estBattle(a, b, bonusA, bonusB, hitA, hitB, n) {
    n = n || 80;
    var win = 0, lossA = 0, lossB = 0, bShips = 0, ship3 = 0, groundWin = 0;
    for (var k = 0; k < n; k++) {
      var r = D.simBattle(a, b, bonusA, bonusB, hitA, hitB, est);
      if (r.a.s + r.a.t > 0 && r.b.s + r.b.t === 0) win++;
      if (r.a.t > 0 && r.b.t === 0) groundWin++;
      lossA += r.killedA.s + r.killedA.t; lossB += r.killedB.s + r.killedB.t;
      bShips += r.killedB.s; if (r.killedB.s >= 3) ship3++;
    }
    return { pWin: win / n, pGround: groundWin / n, lossA: lossA / n, lossB: lossB / n, bShips: bShips / n, p3ships: ship3 / n };
  }

  // Probability weights over the hunter's candidate systems. Hiders favour remote, far-away systems.
  function belief(g) {
    var c = D.hunterCandidates(g), w = {}, tot = 0;
    c.forEach(function (i) { var x = 1 + 0.35 * D.CORE_DIST[i] + (SYS[i].p ? 0 : 0.4); w[i] = x; tot += x; });
    c.forEach(function (i) { w[i] /= tot; });
    return { cands: c, p: w };
  }

  function sumUnits(g, side) { var s = 0, t = 0; for (var i = 0; i < N; i++) { var x = D.unitsAt(g, i, side); s += x.s; t += x.t; } return { s: s, t: t }; }
  function minDistTo(i, pred) { var best = 99; for (var j = 0; j < N; j++) if (pred(j)) best = Math.min(best, DIST[i][j]); return best; }
  function hiddenMissions(g, side) { return D.leadersOf(g, side, "mission").length; }

  // Plan which units to send into `sys`: all ships, as many troops as they can carry, leaving
  // one troop to hold productive systems of your own that the enemy could reach.
  function planMoves(g, side, sys, opts) {
    opts = opts || {};
    var s = g.s, moves = [], S = 0, T = 0;
    D.origins(g, side, sys).forEach(function (o) {
      if (o.from === "base" && !opts.allowBase) return;
      var keepT = 0;
      if (o.from !== "base" && SYS[o.from].p && s.loy[o.from] === side && o.t >= 1) {
        var threat = minDistTo(o.from, function (j) { return D.anyUnits(g, j, D.other(side)); });
        if (SYS[o.from].throne || threat <= 2) keepT = 1;
      }
      var mt = Math.max(0, o.t - keepT), ms = o.s;
      if (opts.troopsOnly && mt === 0) return;
      mt = Math.min(mt, ms * D.CFG.carry);
      if (ms + mt === 0) return;
      moves.push({ from: o.from, s: ms, t: mt });
      S += ms; T += mt;
    });
    return { moves: moves, s: S, t: T };
  }

  function bestLeader(g, side, key, exclude) {
    var pool = D.leadersOf(g, side, "pool").filter(function (L) { return !exclude || exclude.indexOf(L.id) < 0; });
    pool.sort(function (a, b) { return b[key] - a[key] || a.id.localeCompare(b.id); });
    return pool[0] || null;
  }
  function worstLeader(g, side, key) {
    var pool = D.leadersOf(g, side, "pool");
    pool.sort(function (a, b) { return a[key] - b[key] || a.id.localeCompare(b.id); });
    return pool[0] || null;
  }

  // ============================================================ DOMINION
  var Dom = {};

  Dom.assign = function (g, lvl) {
    var s = g.s, pool = D.leadersOf(g, "D", "pool"), L = pool.length, b = belief(g);
    var nMis = L >= 5 ? 2 : (L === 4 ? 2 : 1);
    if (s.baseRevealed) nMis = 0;                       // everything into the assault
    var opts = [];
    if (s.probeDeck.length && b.cands.length > 2) opts.push({ m: "probe", v: 3 + b.cands.length * 0.1, key: "int", why: "probe cards rule out " + D.CFG.probeMissionDraw + " more systems" });
    var dec = D.missionTargets(g, "D", "decree");
    if (dec.length) {
      var dv = 1 + Math.max.apply(null, dec.map(function (t) { return (b.p[t] || 0) * 6; }));
      opts.push({ m: "decree", v: dv, key: "int", why: "a Decree gains production and checks a system without landing troops" });
    }
    if (L >= 4) opts.push({ m: "hunt", v: 1.0, key: "int", why: "Insurgent leaders who act near our fleets can be captured" });
    opts.forEach(function (o) { o.v += noise(g, lvl); });
    opts.sort(function (a, c) { return c.v - a.v; });
    var list = [], used = [], notes = [];
    for (var i = 0; i < opts.length && list.length < nMis; i++) {
      var Ld = bestLeader(g, "D", "int", used.concat(pool.filter(function (x) { return x.tac >= 2 && x.int < 2; }).map(function (x) { return x.id; })));
      if (!Ld) Ld = bestLeader(g, "D", "int", used);
      if (!Ld) break;
      used.push(Ld.id); list.push({ leader: Ld.id, mission: opts[i].m });
      notes.push(Ld.name + " on " + D.MISSIONS[opts[i].m].name + ": " + opts[i].why + ".");
    }
    var reserve = L - list.length;
    var why = "Keeps " + reserve + " of " + L + " leaders in reserve: the hunt is won by moving troops, and one spare leader can oppose a mission. " + notes.join(" ");
    return { list: list, why: why };
  };

  function domActivationOptions(g, lvl) {
    var s = g.s, b = belief(g), out = [];
    var actor = bestLeader(g, "D", "tac");
    if (!actor) return out;
    var cheap = worstLeader(g, "D", "tac");
    for (var T = 0; T < N; T++) {
      if (!D.activatable(g, "D", T)) continue;
      var plan = planMoves(g, "D", T);
      var u = s.u[T], I = { s: u.Is, t: u.It };
      var v = 0, why = [];
      if (s.sab[T] && s.loy[T] === "D") { v += 1.0; why.push("clears the sabotage on " + nm(T) + " so it builds again"); }
      if (plan.s + plan.t === 0 && v === 0) continue;
      var atk = { s: u.Ds + plan.s, t: u.Dt + plan.t };
      if (I.s + I.t > 0) {
        var atBase = s.baseRevealed && T === s.base;
        var e = estBattle(atk, I, actor.tac, D.leaderTac(g, "I", T, null), D.CFG.hitOn, atBase ? D.CFG.baseHitOn : D.CFG.hitOn, 60);
        var bv = 0.8 * e.lossB - 0.55 * e.lossA;
        if (atBase) { bv += 14 * e.pGround; why.push("assaults the revealed base (about " + Math.round(e.pGround * 100) + "% to take it)"); }
        else if (e.pWin > 0.5) why.push("attacks " + D.unitStr(I.s, I.t) + " at " + nm(T) + " with good odds (" + Math.round(e.pWin * 100) + "%)");
        else why.push("trades with the Insurgents at " + nm(T));
        if (s.loy[T] === "I" && SYS[T].p) bv += 1.6 * e.pGround;
        if (!atBase && e.pWin < 0.35) bv -= 1.5;
        v += bv;
      } else if (plan.t > 0) {
        if (!s.baseRevealed && b.p[T] != null) { v += 0.5 + 7 * b.p[T]; why.push("lands troops on " + nm(T) + ", one of " + b.cands.length + " systems the base could be in"); }
        if (SYS[T].p && s.loy[T] !== "D") { v += s.loy[T] === "I" ? 1.8 : 1.1; why.push("takes " + nm(T) + (s.loy[T] === "I" ? " away from the Insurgents" : " for Dominion production")); }
      }
      // positioning: move troops closer to where the base could be (or to the revealed base)
      var tgt = s.baseRevealed ? (function () { var o = {}; o[s.base] = 1; return o; })() : b.p;
      var pos = 0;
      plan.moves.forEach(function (m) {
        if (m.from === "base" || m.t === 0) return;
        Object.keys(tgt).forEach(function (c) { pos += m.t * tgt[c] * (1 / (1 + DIST[T][c]) - 1 / (1 + DIST[m.from][c])); });
      });
      if (pos > 0.02) { v += pos * (s.baseRevealed ? 9 : 4); if (!why.length) why.push("moves troops toward the systems still in question"); }
      // leaving a productive home undefended near Insurgent units is a risk
      plan.moves.forEach(function (m) {
        if (m.from !== "base" && s.loy[m.from] === "D" && s.u[m.from].Dt - m.t === 0 && minDistTo(m.from, function (j) { return s.u[j].It > 0; }) <= 1) v -= 0.6;
      });
      if (v <= 0) continue;
      var who = I.s + I.t > 0 ? actor : cheap;
      out.push({ type: "activate", leader: who.id, sys: T, moves: plan.moves, v: v + noise(g, lvl), why: who.name + " " + why.join("; ") + "." });
    }
    return out;
  }

  function domMissionOptions(g, lvl) {
    var s = g.s, b = belief(g), out = [];
    D.leadersOf(g, "D", "mission").forEach(function (L) {
      var t = D.missionTargets(g, "D", L.mission);
      if (!t.length) return;
      if (L.mission === "probe") {
        // prefer a target where an opposer pins nothing we need: a system whose units already moved or hold a leader
        t.sort(function (a, c) { return (D.hasLeaderAt(g, "D", c) - D.hasLeaderAt(g, "D", a)) || ((s.u[a].Ds + s.u[a].Dt) - (s.u[c].Ds + s.u[c].Dt)); });
        var pv = s.probeDeck.length ? (b.cands.length > 1 ? 3.2 : 0.2) : 0;
        out.push({ type: "mission", leader: L.id, target: t[0], v: pv + noise(g, lvl), why: L.name + " runs a Probe from " + nm(t[0]) + ": two more systems ruled out, and it is done early so later moves use the new information." });
      } else if (L.mission === "decree") {
        var best = null, bv = -1;
        t.forEach(function (x) { var v = (b.p[x] || 0) * 9 + (s.loy[x] === "I" ? 1.4 : 1.0); if (v > bv) { bv = v; best = x; } });
        out.push({ type: "mission", leader: L.id, target: best, v: bv + noise(g, lvl), why: L.name + " issues a Decree on " + nm(best) + (b.p[best] ? ": if the base is there, Dominion loyalty exposes it; if not, it is ruled out and builds for us." : ": more production, and one less loyal system for the Insurgents.") });
      } else if (L.mission === "hunt") {
        var tg = t[0];
        out.push({ type: "mission", leader: L.id, target: tg.leader, v: 3 + noise(g, lvl), why: L.name + " hunts " + D.leader(g, tg.leader).name + ", who is standing in " + nm(tg.sys) + " next to Dominion units. A captured leader is one less Insurgent action for two rounds." });
      }
    });
    return out;
  }

  Dom.command = function (g, lvl) {
    var s = g.s;
    var opts = domMissionOptions(g, lvl).concat(domActivationOptions(g, lvl));
    var pool = D.leadersOf(g, "D", "pool").length;
    var keepForOpp = hiddenMissions(g, "I") > 0 && pool === 1 ? 1.6 : 0;
    opts.forEach(function (o) { if (o.type === "activate") o.v -= keepForOpp; });
    opts.sort(function (a, b) { return b.v - a.v; });
    var best = opts[0];
    if (best && best.v > 0.45) return best;
    if (keepForOpp && opts.length) return { type: "pass", why: "Passes and keeps the last reserve leader to oppose the Insurgents' remaining mission." };
    return { type: "pass", why: "Nothing worth a leader right now." };
  };

  Dom.oppose = function (g, lvl) {
    var s = g.s, p = s.pending, A = D.leader(g, p.leader);
    var pool = D.leadersOf(g, "D", "pool");
    if (!pool.length) return { leader: null, why: "" };
    var val = 0, what = "";
    if (p.type === "sway") { val = s.loy[p.sys] === "D" ? 1.9 : 1.3; what = s.loy[p.sys] === "D" ? "it would cost us production at " + nm(p.sys) : "a loyal " + nm(p.sys) + " builds for the Insurgents every round"; }
    else if (p.type === "sabotage") { val = 1.3 + (SYS[p.sys].core ? 0.7 : 0); what = "a sabotaged " + nm(p.sys) + " stops building until we spend an activation there"; }
    var best = null, bv = -9;
    pool.forEach(function (O) {
      var stop = 1 - D.missionOdds(A.int, O.int);
      var cost = 0.55 + (pool.length === 1 ? 0.5 : 0) + 0.25 * O.tac;
      if (s.u[p.sys].Ds + s.u[p.sys].Dt > 0) cost += 0.3;   // the opposer pins our units there
      var v = stop * val - cost;
      if (v > bv) { bv = v; best = { O: O, stop: stop }; }
    });
    if (lvl === "recruit" && est() < 0.35) bv = -1;
    if (best && bv > 0) return { leader: best.O.id, why: best.O.name + " opposes (" + Math.round(best.stop * 100) + "% to stop it): " + what + "." };
    return { leader: null, why: "Lets it through: not worth a leader that could move troops instead." };
  };

  // ============================================================ INSURGENTS
  var Ins = {};

  Ins.placeBase = function (g, lvl) {
    var sites = D.validBaseSites(g), tot = 0;
    var w = sites.map(function (i) {
      var x = Math.pow(D.CORE_DIST[i], 2) * (SYS[i].p ? 1 : 1.6);
      if (g.s.u[i].Is + g.s.u[i].It > 0 || SYS[i].adj.some(function (a) { return g.s.u[a].Is > 0; })) x *= 0.6;   // away from our own fleet
      tot += x; return x;
    });
    var r = est() * tot, k = 0;
    for (; k < sites.length - 1; k++) { r -= w[k]; if (r <= 0) break; }
    return { sys: sites[k], why: "Far from the Dominion home systems" + (SYS[sites[k]].p ? "" : ", in a remote system that nobody fights over") + ", and away from where your fleet will operate." };
  };

  // How close is the hunter? (Computed from public information plus our own base location.)
  function danger(g) {
    var s = g.s;
    if (s.baseRevealed) return { lvl: 3, why: "the base is revealed" };
    var c = D.hunterCandidates(g).length, b = s.base;
    var near = 99;
    for (var j = 0; j < N; j++) if (s.u[j].Dt > 0 && s.u[j].Ds > 0) near = Math.min(near, DIST[b][j]);
    if (c <= 2) return { lvl: 3, why: "the Dominion has narrowed the search to " + c + " system" + (c === 1 ? "" : "s"), c: c, near: near };
    if (near <= 1 && c <= 5) return { lvl: 3, why: "Dominion troop ships are one jump from the base and only " + c + " systems are still in question", c: c, near: near };
    if (c <= 4 || near <= 1) return { lvl: 2, why: "the hunter is closing in (" + c + " systems still in question)", c: c, near: near };
    return { lvl: c <= 6 ? 1 : 0, why: "", c: c, near: near };
  }
  Ins.danger = danger;

  // After a relocation the hunter's candidates are the probe-deck systems with no Dominion units.
  function candidatesAfterRelocation(g) {
    var s = g.s;
    return s.probeDeck.filter(function (i) { return i !== s.base && s.u[i].Ds + s.u[i].Dt === 0; }).length;
  }
  function relocationHelps(g, dg) {
    var after = candidatesAfterRelocation(g);
    if (!D.missionTargets(g, "I", "relocate").length) return false;
    if (g.s.baseRevealed) return true;
    return after > (dg.c || 0) + 1 || (dg.lvl >= 3 && after >= 2);
  }
  Ins.candidatesAfterRelocation = candidatesAfterRelocation;

  function bestRelocation(g) {
    var s = g.s, t = D.missionTargets(g, "I", "relocate"), best = null, bv = -99;
    t.forEach(function (x) {
      var dd = minDistTo(x, function (j) { return s.u[j].Dt > 0; });
      var v = Math.min(dd, 4) * 1.2 + D.CORE_DIST[x] * 0.5 + (SYS[x].p ? 0 : 0.5) + est() * 0.8;
      if (v > bv) { bv = v; best = x; }
    });
    return best;
  }

  function swayTargets(g) {
    var s = g.s;
    return D.missionTargets(g, "I", "sway").map(function (x) {
      var dd = minDistTo(x, function (j) { return s.u[j].Dt > 0; });
      var v = (s.loy[x] === "D" ? 1.1 : 1.5) + 0.35 * Math.min(dd, 3);
      if (s.u[x].Ds > 0) v -= 0.6;                     // a leader there can be hunted
      return { sys: x, v: v, dd: dd };
    }).sort(function (a, b) { return b.v - a.v; });
  }
  function sabTargets(g) {
    var s = g.s, hand = s.objHand;
    return D.missionTargets(g, "I", "sabotage").map(function (x) {
      var v = 1.0 + (hand.indexOf("lines") >= 0 ? 0.8 : 0) + (0) + (SYS[x].throne ? 0.4 : 0);
      if (s.u[x].Ds + s.u[x].Dt > 0) v -= 0.35;      // leader exposed to Hunt there
      return { sys: x, v: v };
    }).sort(function (a, b) { return b.v - a.v; });
  }

  Ins.assign = function (g, lvl) {
    var s = g.s, pool = D.leadersOf(g, "I", "pool"), L = pool.length, hand = s.objHand;
    var list = [], used = [], notes = [];
    var dg = danger(g);
    if (dg.lvl >= 2 && relocationHelps(g, dg)) {
      var cand = pool.filter(function (x) { return x.int >= 2; }).sort(function (a, b) { return a.int - b.int; })[0];
      if (cand) { list.push({ leader: cand.id, mission: "relocate" }); used.push(cand.id); notes.push(cand.name + " stands ready to Relocate because " + dg.why + "."); }
    }
    var reserve = 1;
    if (L >= 4) reserve = 2;
    var free = L - list.length - reserve;
    var wantSab = hand.indexOf("lines") >= 0;
    var wantSway = hand.indexOf("spark") >= 0 || hand.indexOf("uprise") >= 0 || D.countLoyal(s, "I") < 3;
    var sw = swayTargets(g), sb = sabTargets(g), nSway = 0, nSab = 0;
    for (var k = 0; k < free; k++) {
      var Ld = bestLeader(g, "I", "int", used.concat(["i2"]));
      if (!Ld) break;
      var m;
      var swV = sw[nSway] ? sw[nSway].v + (wantSway ? 0.6 : 0) : -9, sbV = sb[nSab] ? sb[nSab].v + (wantSab ? 0.4 : 0) : -9;
      swV += noise(g, lvl); sbV += noise(g, lvl);
      if (swV < 0 && sbV < 0) break;
      if (swV >= sbV) { m = "sway"; nSway++; } else { m = "sabotage"; nSab++; }
      used.push(Ld.id); list.push({ leader: Ld.id, mission: m });
      notes.push(Ld.name + " (intrigue " + Ld.int + ") on " + D.MISSIONS[m].name + (m === "sway" ? ": loyal systems build units and feed loyalty objectives." : ": denies Dominion production" + (wantSab ? " and works toward an objective." : ".")));
    }
    var res = L - list.length;
    var why = "Keeps " + res + " in reserve (" + (res ? "to oppose a Dominion mission or strike when a fight pays" : "none") + "). " + notes.join(" ");
    return { list: list, why: why };
  };

  function insActivationOptions(g, lvl) {
    var s = g.s, out = [], hand = s.objHand;
    var actor = bestLeader(g, "I", "tac");
    if (!actor) return out;
    for (var T = 0; T < N; T++) {
      if (!D.activatable(g, "I", T)) continue;
      var plan = planMoves(g, "I", T);
      if (plan.s + plan.t === 0) continue;
      var u = s.u[T], Dm = { s: u.Ds, t: u.Dt }, v = 0, why = [];
      if (Dm.s + Dm.t > 0) {
        var att = { s: u.Is + plan.s, t: u.It + plan.t };
        var e = estBattle(att, Dm, actor.tac, D.leaderTac(g, "D", T, null), D.CFG.hitOn, D.CFG.hitOn, 60);
        v = 0.7 * e.lossB - 0.9 * e.lossA;
        if (hand.indexOf("hitrun") >= 0) { v += 1.6 * e.pWin; }
        if (hand.indexOf("raid") >= 0 && Dm.t >= 2) { v += 1.4 * Math.min(1, e.lossB / Math.max(1, Dm.s + Dm.t)) ; }
        if (hand.indexOf("ambush") >= 0) { v += 2.5 * e.p3ships; }
        if (hand.indexOf("liberty") >= 0 && s.loy[T] === "D" && !SYS[T].throne) v += 2.4 * e.pGround;
        if (hand.indexOf("throne") >= 0 && SYS[T].core) v += 2.4 * e.pWin;
        if (s.loy[T] === "D" && SYS[T].p) v += 0.6 * e.pGround;
        if (e.pWin < 0.45 && v < 1.2) v -= 1.0;
        why.push("strikes " + D.unitStr(Dm.s, Dm.t) + " at " + nm(T) + " (about " + Math.round(e.pWin * 100) + "% to win)" + (v > 1 ? " because the win scores or the trade is cheap" : ""));
      } else {
        if (s.loy[T] === "D" && plan.t > 0 && !SYS[T].throne) { v += 1.4 + (hand.indexOf("liberty") >= 0 ? 2.2 : 0); why.push("walks into undefended " + nm(T) + " and takes it back from the Dominion"); }
        // retreat from a stack we cannot hold
        plan.moves.forEach(function (m) {
          if (m.from === "base") return;
          var threat = 0;
          SYS[m.from].adj.forEach(function (a) { threat += s.u[a].Ds + s.u[a].Dt; });
          var mine = s.u[m.from].Is + s.u[m.from].It;
          var threatT = 0; SYS[T].adj.forEach(function (a) { threatT += s.u[a].Ds + s.u[a].Dt; });
          if (threat > mine * 1.5 && threatT < threat * 0.5) { v += 0.7; why.push("pulls units out of reach of a bigger Dominion force"); }
        });
        if (s.loy[T] === "I" && SYS[T].adj.some(function (a) { return s.u[a].Dt > 0; }) && u.It === 0 && plan.t > 0) { v += 0.6; why.push("puts troops on loyal " + nm(T) + " so a landing has to fight for it"); }
      }
      if (s.baseRevealed && T === s.base && plan.t > 0) { v += 2 + plan.t * 0.5; why.push("reinforces the exposed base"); }
      if (v <= 0) continue;
      out.push({ type: "activate", leader: actor.id, sys: T, moves: plan.moves, v: v + noise(g, lvl), why: actor.name + " " + why.join("; ") + "." });
    }
    return out;
  }

  function insMissionOptions(g, lvl) {
    var s = g.s, out = [], dg = danger(g);
    D.leadersOf(g, "I", "mission").forEach(function (L) {
      if (L.mission === "relocate") {
        var t = bestRelocation(g);
        if (t == null) return;
        var v = !relocationHelps(g, dg) ? 0.1 : (dg.lvl >= 3 ? 10 : (dg.lvl === 2 ? 3 : 0.25));
        out.push({ type: "mission", leader: L.id, target: t, v: v, why: L.name + " relocates the base" + (dg.why ? " because " + dg.why : "") + ". The old site will be exposed, so it is done before troops arrive, not after." });
      } else if (L.mission === "sway") {
        var sw = swayTargets(g)[0];
        if (sw) out.push({ type: "mission", leader: L.id, target: sw.sys, v: sw.v + noise(g, lvl), why: L.name + " sways " + nm(sw.sys) + ", " + (sw.dd >= 2 ? sw.dd + " jumps from the nearest Dominion troops, so it is hard to take back" : "contested, but worth the production") + "." });
      } else if (L.mission === "sabotage") {
        var sb = sabTargets(g)[0];
        if (sb) out.push({ type: "mission", leader: L.id, target: sb.sys, v: sb.v + noise(g, lvl), why: L.name + " sabotages " + nm(sb.sys) + ": the Dominion must spend an activation there or lose its production" + (SYS[sb.sys].core ? ", and it is a home system" : "") + "." });
      }
    });
    return out;
  }

  Ins.command = function (g, lvl) {
    var opts = insMissionOptions(g, lvl).concat(insActivationOptions(g, lvl));
    var pool = D.leadersOf(g, "I", "pool").length;
    var keep = hiddenMissions(g, "D") > 0 && pool === 1 ? 1.4 : 0;
    opts.forEach(function (o) { if (o.type === "activate") o.v -= keep; });
    opts.sort(function (a, b) { return b.v - a.v; });
    var best = opts[0];
    if (best && best.v > 0.45) return best;
    if (keep && opts.length) return { type: "pass", why: "Passes and keeps the last reserve leader to oppose the Dominion's remaining mission." };
    return { type: "pass", why: "Nothing worth a leader right now." };
  };

  Ins.oppose = function (g, lvl) {
    var s = g.s, p = s.pending, A = D.leader(g, p.leader);
    var pool = D.leadersOf(g, "I", "pool");
    if (!pool.length) return { leader: null, why: "" };
    var val = 0, what = "", c = D.hunterCandidates(g).length;
    if (p.type === "hunt") { val = 3; what = "losing " + D.leader(g, p.huntLeader).name + " for two rounds costs two actions"; }
    else if (p.type === "probe") { val = c <= 5 ? 2.4 : 0.9; what = c <= 5 ? "only " + c + " systems are still in question, every card matters" : "fewer probe cards means a slower search"; }
    else if (p.type === "decree") {
      // the reason text is the same in every case, so the choice to oppose does not point at the base
      what = "a Decree gives the Dominion production and information";
      if (p.sys === s.base && !s.baseRevealed) val = 12;
      else if (s.loy[p.sys] === "I") val = 1.5;
      else val = 0.7;
      if (lvl !== "recruit" && val < 1 && est() < 0.4) val = 2;   // oppose decoys too, so opposition is not a tell
    }
    var best = null, bv = -9;
    pool.forEach(function (O) {
      var stop = 1 - D.missionOdds(A.int, O.int);
      var cost = 0.5 + (pool.length === 1 && hiddenMissions(g, "D") > 0 ? 0.5 : 0) + 0.2 * O.tac;
      if (s.u[p.sys].Ds + s.u[p.sys].Dt > 0 && hiddenMissions(g, "D") > 0) cost += 0.3;   // our opposer could be hunted there
      var v = stop * val - cost;
      if (v > bv) { bv = v; best = { O: O, stop: stop }; }
    });
    if (lvl === "recruit" && est() < 0.3) bv = -1;
    if (best && bv > 0) return { leader: best.O.id, why: best.O.name + " opposes (" + Math.round(best.stop * 100) + "% to stop it): " + what + "." };
    return { leader: null, why: "Lets it through and keeps the leader for something better." };
  };

  // ============================================================ driver
  var BOT = { I: Ins, D: Dom };

  function act(g, side, a) {
    if (a.type === "activate") D.activate(g, side, a.leader, a.sys, a.moves);
    else if (a.type === "mission") D.revealMission(g, side, a.leader, a.target);
    else if (a.type === "pass") D.pass(g, side);
    else throw new Error("unknown action " + a.type);
  }

  // Advance the game while it is the bot's decision. Returns the reasons it gave, in order.
  function runBot(g, botSide, lvl) {
    var s = g.s, notes = [], guard = 0;
    while (!s.winner && guard++ < 200) {
      if (s.phase === "setup") {
        if (botSide !== "I") break;
        var pb = Ins.placeBase(g, lvl); D.placeBase(g, pb.sys); notes.push({ side: "I", why: "Base placed." });
      } else if (s.phase === "assign") {
        if (s.assigned[botSide]) break;
        var as = BOT[botSide].assign(g, lvl);
        D.submitAssignment(g, botSide, as.list); notes.push({ side: botSide, kind: "assign", why: as.why, private: true });
        break;   // the human assigns next (or both are done)
      } else if (s.phase === "command") {
        if (s.pending) {
          if (D.other(s.pending.side) !== botSide) break;
          var op = BOT[botSide].oppose(g, lvl); D.oppose(g, botSide, op.leader); if (op.why) notes.push({ side: botSide, kind: "oppose", why: op.why });
          continue;
        }
        if (s.turn !== botSide) break;
        var a = BOT[botSide].command(g, lvl);
        act(g, botSide, a); notes.push({ side: botSide, kind: a.type, why: a.why });
      } else break;
    }
    return notes;
  }

  return { Dom: Dom, Ins: Ins, BOT: BOT, act: act, runBot: runBot, belief: belief, estBattle: estBattle, danger: danger, planMoves: planMoves };
});
