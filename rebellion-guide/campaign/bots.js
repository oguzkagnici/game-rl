/* Campaign: scripted opponents for both sides, also used by the coach to suggest moves.
 * Every decision returns a short reason written from public information plus the bot's own
 * secrets; the Insurgent bot never mentions where its base is. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"));
  else root.CampaignBots = factory(root.Campaign);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  var SYS = C.SYS, DIST = C.DIST, U = C.UNITS, N = SYS.length, M = C.MISSIONS;
  var est = C.makeRng(4242);
  function nm(i) { return SYS[i].n; }
  function noise(lvl) { return lvl === "recruit" ? (est() - 0.5) * 2.2 : (est() - 0.5) * 0.15; }
  function val(st) { var v = 0; for (var t in st) v += (U[t].special ? 6 : U[t].cost) * st[t]; return v; }
  function sumVal(list) { return list.reduce(function (a, t) { return a + (U[t].special ? 6 : U[t].cost); }, 0); }

  // ------------------------------------------------------------ battle estimates
  // a attacks b (unit stacks). Returns win chance for a, chance a holds the ground, expected value lost each side.
  function estBattle(a, b, opts, n) {
    opts = opts || {}; n = n || 60;
    var win = 0, ground = 0, la = 0, lb = 0, cap = 0, kills = 0;
    for (var k = 0; k < n; k++) {
      var units = { I: C.expand(a), D: C.expand(b) };
      var mods = { I: { bonus: { space: opts.tacA || 0, ground: opts.tacA || 0 } }, D: { bonus: { space: opts.tacB || 0, ground: opts.tacB || 0 } } };
      var lostA = [], lostB = [];
      for (var r = 0; r < 8; r++) {
        var res = C.combatRound(units, mods, opts.atBase && opts.baseDefender === "D", opts.plans, est);
        lostA = lostA.concat(res.lost.I); lostB = lostB.concat(res.lost.D);
        if (!contestedL(units)) break;
      }
      var aLeft = units.I.length, bLeft = units.D.length;
      if (aLeft && !bLeft) win++;
      var ag = units.I.some(function (x) { return U[x.t].dom === "ground"; }), bg = units.D.some(function (x) { return U[x.t].dom === "ground"; });
      if (ag && !bg) ground++;
      la += sumVal(lostA); lb += sumVal(lostB); kills += lostB.length;
      cap += lostB.filter(function (t) { return U[t].heavy && U[t].dom === "space"; }).length;
    }
    return { pWin: win / n, pGround: ground / n, lossA: la / n, lossB: lb / n, capB: cap / n, killsB: kills / n };
  }
  function contestedL(units) {
    var f = function (side, dom) { return units[side].some(function (x) { return U[x.t].dom === dom; }); };
    return (f("I", "space") && f("D", "space")) || (f("I", "ground") && f("D", "ground"));
  }
  // Estimate from side's point of view (attacker = side).
  function estFor(g, side, mine, theirs, sys, tacMine, tacTheirs) {
    var s = g.s, atBase = s.baseRevealed && sys === s.base;
    if (side === "I") return estBattle(mine, theirs, { tacA: tacMine, tacB: tacTheirs, plans: s.plans });
    // the estimator always treats side "I" slot as attacker; for the Dominion swap roles
    var r = estBattleSwap(theirs, mine, { tacI: tacTheirs, tacD: tacMine, atBase: atBase, plans: s.plans });
    return r;
  }
  function estBattleSwap(iSt, dSt, o, n) {
    n = n || 60;
    var win = 0, ground = 0, la = 0, lb = 0;
    for (var k = 0; k < n; k++) {
      var units = { I: C.expand(iSt), D: C.expand(dSt) }, lostI = [], lostD = [];
      var mods = { I: { bonus: { space: o.tacI || 0, ground: o.tacI || 0 } }, D: { bonus: { space: o.tacD || 0, ground: o.tacD || 0 } } };
      for (var r = 0; r < 8; r++) { var res = C.combatRound(units, mods, o.atBase, o.plans, est); lostI = lostI.concat(res.lost.I); lostD = lostD.concat(res.lost.D); if (!contestedL(units)) break; }
      if (units.D.length && !units.I.length) win++;
      var dg = units.D.some(function (x) { return U[x.t].dom === "ground"; }), ig = units.I.some(function (x) { return U[x.t].dom === "ground"; });
      if (dg && !ig) ground++;
      la += sumVal(lostD); lb += sumVal(lostI);
    }
    return { pWin: win / n, pGround: ground / n, lossA: la / n, lossB: lb / n, capB: 0, killsB: 0 };
  }

  // ------------------------------------------------------------ belief (Dominion's view)
  function belief(g) {
    var c = C.hunterCandidates(g), w = {}, tot = 0;
    c.forEach(function (i) { var x = 1 + 0.3 * C.HOME_DIST[i] + (SYS[i].p ? 0 : 0.4); w[i] = x; tot += x; });
    c.forEach(function (i) { w[i] /= tot; });
    return { cands: c, p: w };
  }
  function minDistTo(i, pred) { var best = 99; for (var j = 0; j < N; j++) if (pred(j)) best = Math.min(best, DIST[i][j]); return best; }

  // ------------------------------------------------------------ movement planning
  // Send capital ships, then fill their capacity (ground first for the hunter, fighters next),
  // leaving one ground unit to hold your own productive, threatened systems.
  function planMoves(g, side, sys, opts) {
    opts = opts || {};
    var s = g.s, moves = [], tot = {};
    C.origins(g, side, sys).forEach(function (o) {
      if (o.from === "base" && !opts.allowBase) return;
      var st = o.units, keepG = 0;
      if (o.from !== "base" && SYS[o.from].p && s.loy[o.from] === side) {
        var threat = minDistTo(o.from, function (j) { return C.anyUnits(g, j, C.other(side)); });
        if (SYS[o.from].throne || threat <= 2) keepG = 1;
      }
      var mv = {}, cap = 0;
      Object.keys(st).forEach(function (t) { if (U[t].cap > 0 || (!U[t].carry && U[t].dom === "space")) { mv[t] = st[t]; cap += U[t].cap * st[t]; } });
      if (opts.capitalsOnly) { if (C.total(mv)) moves.push({ from: o.from, units: mv }); return; }
      var ground = Object.keys(st).filter(function (t) { return U[t].dom === "ground"; }).sort(function (a, b) { return U[b].cost - U[a].cost; });
      var fighters = Object.keys(st).filter(function (t) { return U[t].dom === "space" && U[t].carry; });
      var gAvail = ground.reduce(function (a, t) { return a + st[t]; }, 0) - keepG;
      var order = side === "D" || opts.groundFirst ? ground.concat(fighters) : fighters.concat(ground);
      order.forEach(function (t) {
        var n = st[t];
        if (U[t].dom === "ground") n = Math.min(n, Math.max(0, gAvail));
        n = Math.min(n, cap);
        if (n > 0) { mv[t] = n; cap -= n; if (U[t].dom === "ground") gAvail -= n; }
      });
      if (C.total(mv)) { moves.push({ from: o.from, units: mv }); for (var t in mv) C.addU(tot, t, mv[t]); }
    });
    return { moves: moves, units: tot };
  }
  // A small search party for an empty system: one capital ship from the best origin and the
  // ground units it can carry. Leaves the rest of the fleet free for other activations.
  function planDetachment(g, side, sys) {
    var s = g.s, best = null, bv = -1;
    C.origins(g, side, sys).forEach(function (o) {
      if (o.from === "base") return;
      var st = o.units, caps = Object.keys(st).filter(function (t) { return U[t].cap > 0; }).sort(function (a, c) { return U[c].cap - U[a].cap; });
      var gr = Object.keys(st).filter(function (t) { return U[t].dom === "ground"; }).sort(function (a, c) { return U[a].cost - U[c].cost; });
      var gAvail = gr.reduce(function (a, t) { return a + st[t]; }, 0);
      if (SYS[o.from].p && s.loy[o.from] === side && (SYS[o.from].throne || minDistTo(o.from, function (j) { return C.anyUnits(g, j, C.other(side)); }) <= 2)) gAvail--;
      if (!caps.length || gAvail <= 0) return;
      var cap = U[caps[0]].cap, mv = {}, n = 0;
      mv[caps[0]] = 1;
      gr.forEach(function (t) { var k = Math.min(st[t], cap - n, gAvail - n); if (k > 0) { mv[t] = k; n += k; } });
      if (n > bv) { bv = n; best = { from: o.from, units: mv }; }
    });
    return best ? { moves: [best], units: Object.assign({}, best.units) } : { moves: [], units: {} };
  }
  function mergeSt(a, b) { var o = Object.assign({}, a); for (var t in b) C.addU(o, t, b[t]); return o; }
  function bestLeader(g, side, key, exclude) {
    var pool = C.leadersOf(g, side, "pool").filter(function (L) { return !exclude || exclude.indexOf(L.id) < 0; });
    pool.sort(function (a, b) { return b[key] - a[key] || a.id.localeCompare(b.id); });
    return pool[0] || null;
  }
  function tacOf(L) { return L.sp + L.gr; }

  // ------------------------------------------------------------ assignment (shared)
  // values: {cardId: {v, why}}; picks the best cards and the cheapest leaders that meet each skill need.
  function chooseAssignment(g, side, values, nMis, lvl) {
    var s = g.s, hand = s.hands[side].slice(), used = [], list = [], notes = [];
    var opts = hand.map(function (c) { var x = values[c.id]; return x ? { c: c, v: x.v + noise(lvl), why: x.why } : null; }).filter(function (o) { return o && o.v > 0.3; });
    opts.sort(function (a, b) { return b.v - a.v; });
    var seenId = {};
    for (var i = 0; i < opts.length && list.length < nMis; i++) {
      var c = opts[i].c, Mi = M[c.id];
      if (seenId[c.id] && !(values[c.id] && values[c.id].multi)) continue;
      var pool = C.leadersOf(g, side, "pool").filter(function (L) { return used.indexOf(L.id) < 0 && L[Mi.skill] > 0; });
      if (!pool.length) continue;
      // prefer the leader whose skill is enough but who matters least in battle
      pool.sort(function (a, b) { return (b[Mi.skill] >= Mi.need) - (a[Mi.skill] >= Mi.need) || b[Mi.skill] - a[Mi.skill] || tacOf(a) - tacOf(b); });
      var team = [pool[0].id], sum = pool[0][Mi.skill];
      if (sum < Mi.need && pool[1]) { team.push(pool[1].id); sum += pool[1][Mi.skill]; }
      if (sum < Mi.need) continue;
      // a second leader adds dice to important opposed missions
      if (team.length === 1 && Mi.opp && opts[i].v > 2.5 && pool[1] && C.leadersOf(g, side, "pool").length - used.length - 1 > nMis) { team.push(pool[1].id); }
      team.forEach(function (id) { used.push(id); });
      seenId[c.id] = 1;
      list.push({ card: c.uid, leaders: team });
      notes.push(team.map(function (id) { return C.leader(g, id).name; }).join(" + ") + " on " + Mi.name + ": " + opts[i].why + ".");
    }
    return { list: list, notes: notes };
  }

  // ============================================================ DOMINION
  var Dom = {};
  function domMissionValues(g) {
    var s = g.s, b = belief(g), v = {}, t;
    var has = function (id) { return C.missionTargetsById ? true : true; };
    if (s.probeDeck.length && b.cands.length > 2) v.probe = { v: 3 + b.cands.length * 0.05, why: "two more probe cards" };
    var dec = targetsFor(g, "D", "decree");
    if (dec.length) v.decree = { v: 1.2 + Math.max.apply(null, dec.map(function (x) { return (b.p[x] || 0) * 7; })), why: "loyalty that builds and can expose the base" };
    if (C.leadersOf(g, "D", "pool").length >= 4) v.seize = { v: 1.6, why: "Insurgent leaders who act near our units can be captured" };
    if (!s.usedOnce.project) v.project = { v: s.round >= 2 ? 3.6 : 2.5, why: "the superweapon takes two rounds to build" };
    if (s.captives.length) v.interrogate = { v: 4.2, why: "a captive is worth three probe cards", multi: true };
    if (targetsFor(g, "D", "conscript").length) v.conscript = { v: 1.6, why: "two troopers now, with no build delay" };
    if (targetsFor(g, "D", "crackdown").length) v.crackdown = { v: 1.4, why: "takes a loyal system away from the Insurgents" };
    if (b.cands.length >= 4 && !s.baseRevealed) v.scan = { v: 3.8, why: "one scan rules out a whole region or pins the base to one" };
    if (s.queue.some(function (q) { return q.side === "D" && q.type !== "superweapon"; })) v.rapid = { v: 1.3, why: "units waiting in the queue arrive now" };
    t = targetsFor(g, "D", "annihilate");
    if (t.length) { var bv = Math.max.apply(null, t.map(function (x) { return (b.p[x] || 0) * 14 + (C.total(s.u[x].I) ? 1.5 : 0) + (s.loy[x] === "I" ? 1.2 : 0); })); if (bv > 0.5) v.annihilate = { v: 1.5 + bv, why: "the superweapon can search or destroy where it stands" }; }
    return v;
  }
  function targetsFor(g, side, id) {
    var c = g.s.hands[side].filter(function (x) { return x.id === id; })[0];
    if (!c) return [];
    return C.missionTargets(g, side, c.uid);
  }

  Dom.assign = function (g, lvl) {
    var s = g.s, L = C.leadersOf(g, "D", "pool").length;
    var nMis = s.baseRevealed ? 1 : (L <= 4 ? 2 : (L <= 6 ? 2 : 3));
    var r = chooseAssignment(g, "D", domMissionValues(g), nMis, lvl);
    var res = L - r.list.reduce(function (a, x) { return a + x.leaders.length; }, 0);
    return { list: r.list, why: "Keeps " + res + " of " + L + " leaders in reserve to move troops and oppose. " + r.notes.join(" ") };
  };

  function domMissionOptions(g, lvl) {
    var s = g.s, b = belief(g), out = [];
    C.hiddenMissions(g, "D").forEach(function (m) {
      var c = C.card(g, "D", m.card), t = C.missionTargets(g, "D", m.card), names = m.leaders.map(function (id) { return C.leader(g, id).name; }).join(" and ");
      if (!t.length) return;
      var best = t[0], v = 0, why = "";
      switch (c.id) {
        case "probe":
          t.sort(function (a, c2) { return (C.hasLeaderAt(g, "D", c2) - C.hasLeaderAt(g, "D", a)) || (C.total(s.u[a].D) - C.total(s.u[c2].D)); });
          best = t[0]; v = s.probeDeck.length ? 3.4 : 0.1; why = names + " run a Probe Sweep early, so later moves use the new information."; break;
        case "decree":
          v = -1; t.forEach(function (x) { var vv = (b.p[x] || 0) * 9 + (s.loy[x] === "I" ? 1.4 : 1); if (vv > v) { v = vv; best = x; } });
          why = names + " decree " + nm(best) + (b.p[best] ? ": Dominion loyalty there would expose the base, or rule the system out." : ": more production for us."); break;
        case "seize": best = t[0].leader; v = 3; why = names + " move to seize " + C.leader(g, t[0].leader).name + ", standing next to our units in " + nm(t[0].sys) + "."; break;
        case "project": v = 3; why = names + " start the superweapon project."; break;
        case "interrogate": v = 4; why = names + " interrogate a captive for three probe cards."; break;
        case "conscript":
          v = -1; t.forEach(function (x) { var dd = b.cands.length ? Math.min.apply(null, b.cands.map(function (c2) { return DIST[x][c2]; })) : 3; var vv = 2 - dd * 0.2; if (vv > v) { v = vv; best = x; } });
          why = names + " conscript troopers at " + nm(best) + ", close to where the search is."; break;
        case "crackdown": v = 1.4; why = names + " crack down on " + nm(best) + "."; break;
        case "scan":
          v = -1; t.forEach(function (x) { var reg = SYS[x].r, mass = 0, cnt = 0; b.cands.forEach(function (c2) { if (SYS[c2].r === reg) { mass += b.p[c2]; cnt++; } }); var vv = cnt ? 4 * (1 - Math.abs(0.5 - mass)) + cnt * 0.1 : 0; if (vv > v) { v = vv; best = x; } });
          why = names + " scan the " + C.REGIONS[SYS[best].r] + ": either the base is there or the whole region is ruled out."; break;
        case "rapid": v = 1.5; why = names + " rush the build queue."; break;
        case "annihilate":
          v = -1; t.forEach(function (x) { var vv = (b.p[x] || 0) * 9 + (C.total(s.u[x].I) ? 1.5 : 0); if (vv > v) { v = vv; best = x; } });
          why = names + " fire the superweapon on " + nm(best) + "."; break;
      }
      out.push({ type: "mission", card: m.card, target: best, v: v + noise(lvl), why: why });
    });
    return out;
  }

  function domActivationOptions(g, lvl) {
    var s = g.s, b = belief(g), out = [];
    var fighter = bestLeader(g, "D", "gr"), cheap = C.leadersOf(g, "D", "pool").slice().sort(function (a, c) { return tacOf(a) - tacOf(c); })[0];
    if (!fighter) return out;
    var gap = s.rep - s.time, urgency = gap <= 3 ? 1.6 : 1;
    for (var T = 0; T < N; T++) {
      if (!C.activatable(g, "D", T)) continue;
      var safe = !SYS[T].adj.some(function (x) { return C.total(s.u[x].I) > 0; });
      var small = !C.total(s.u[T].I) && !(s.baseRevealed && T === s.base) && safe && (b.p[T] || 0) < 0.15;
      var plan = small ? planDetachment(g, "D", T) : planMoves(g, "D", T), v = 0, why = [];
      if (s.sab[T] && s.loy[T] === "D") { v += 1.1; why.push("clears the sabotage on " + nm(T)); }
      if (!C.total(plan.units) && v === 0) continue;
      var atk = mergeSt(s.u[T].D, plan.units), I = s.u[T].I, gIn = C.total(plan.units, function (x) { return x.dom === "ground"; });
      if (C.total(I)) {
        var atBase = s.baseRevealed && T === s.base;
        var e = estFor(g, "D", atk, I, T, Math.max(fighter.sp, fighter.gr) / 2, 1);
        var bv = 0.5 * e.lossB - 0.4 * e.lossA;
        if (atBase) { bv += 16 * e.pGround; why.push("assaults the revealed base (about " + Math.round(e.pGround * 100) + "% to take it)"); }
        else if (e.pWin > 0.55) why.push("attacks " + C.unitList(I) + " at " + nm(T) + " (about " + Math.round(e.pWin * 100) + "% to win)");
        else why.push("trades with the Insurgents at " + nm(T));
        if (s.loy[T] === "I" && SYS[T].p) bv += 1.6 * e.pGround;
        if (!atBase && e.pWin < 0.35) bv -= 2;
        v += bv;
      } else if (gIn > 0) {
        if (!s.baseRevealed && b.p[T] != null) { v += (0.6 + 8 * b.p[T]) * urgency; why.push("lands troops on " + nm(T) + ", one of " + b.cands.length + " systems the base could be in"); }
        if (SYS[T].p && s.loy[T] !== "D" && !s.ruined[T]) { v += s.loy[T] === "I" ? 1.8 : 1.1; why.push("takes " + nm(T) + (s.loy[T] === "I" ? " from the Insurgents" : " for its build icons")); }
      }
      var tgt = s.baseRevealed ? (function () { var o = {}; o[s.base] = 1; return o; })() : b.p, pos = 0;
      plan.moves.forEach(function (m) {
        var gm = C.total(m.units, function (x) { return x.dom === "ground"; }) + (m.units.superweapon ? 7 : 0);
        if (!gm) return;
        Object.keys(tgt).forEach(function (c) { pos += gm * tgt[c] * (1 / (1 + DIST[T][c]) - 1 / (1 + DIST[m.from][c])); });
      });
      if (pos > 0.02) { v += pos * (s.baseRevealed ? 9 : (b.cands.length <= 3 ? 8 : 4)) * urgency; if (!why.length) why.push("moves troops toward the systems still in question"); }
      plan.moves.forEach(function (m) {
        if (s.loy[m.from] === "D" && C.groundAt(g, m.from, "D") - C.total(m.units, function (x) { return x.dom === "ground"; }) === 0 && minDistTo(m.from, function (j) { return C.groundAt(g, j, "I") > 0; }) <= 1) v -= 0.6;
      });
      if (v <= 0) continue;
      var who = C.total(I) ? fighter : cheap;
      out.push({ type: "activate", leader: who.id, sys: T, moves: plan.moves, v: v + noise(lvl), why: who.name + " " + why.join("; ") + "." });
    }
    return out;
  }

  // March the superweapon (with any destroyers beside it) toward the systems still in question.
  function superweaponOptions(g, lvl) {
    var s = g.s, b = belief(g), out = [], L = C.leadersOf(g, "D", "pool").slice().sort(function (a, c) { return tacOf(a) - tacOf(c); })[0];
    if (!L) return out;
    var ed = function (x) { if (s.baseRevealed) return DIST[x][s.base]; var d = 0; b.cands.forEach(function (c) { d += b.p[c] * DIST[x][c]; }); return d; };
    for (var o = 0; o < N; o++) {
      if (!C.cnt(s.u[o].D, "superweapon") || C.hasLeaderAt(g, "D", o)) continue;
      SYS[o].adj.forEach(function (T) {
        if (!C.activatable(g, "D", T) || C.total(s.u[T].I)) return;
        var mv = { superweapon: 1 }; if (C.cnt(s.u[o].D, "destroyer")) mv.destroyer = C.cnt(s.u[o].D, "destroyer");
        var v = (ed(o) - ed(T)) * 1.4 + (b.p[T] || 0) * 3;
        if (v > 0.3) out.push({ type: "activate", leader: L.id, sys: T, moves: [{ from: o, units: mv }], v: v + noise(lvl), why: L.name + " moves the superweapon to " + nm(T) + ", closer to where the base could be." });
      });
    }
    return out;
  }

  Dom.command = function (g, lvl) {
    var opts = domMissionOptions(g, lvl).concat(domActivationOptions(g, lvl), superweaponOptions(g, lvl));
    var pool = C.leadersOf(g, "D", "pool").length;
    var keep = C.hiddenMissions(g, "I").length > 0 && pool === 1 ? 2.6 : 0;
    opts.forEach(function (o) { if (o.type === "activate") o.v -= keep; });
    opts.sort(function (a, b) { return b.v - a.v; });
    if (opts[0] && opts[0].v > 0.45) return opts[0];
    return { type: "pass", why: keep ? "Keeps the last reserve leader to oppose a hidden mission." : "Nothing worth a leader right now." };
  };

  Dom.oppose = function (g, lvl) {
    var s = g.s, p = s.pending, pool = C.leadersOf(g, "D", "pool");
    if (!pool.length) return { leader: null, why: "" };
    var Mi = M[p.id], value = { rally: s.loy[p.sys] === "D" ? 1.9 : 1.3, sabotage: 1.4, uprising: 2.4, plans: 3.6, breakout: 3, decoy: 1.6, supply: 1.5, inspire: 4 }[p.id] || 0;
    var best = null, bv = -9;
    pool.forEach(function (O) {
      var stop = 1 - C.missionOdds(p.dice, O[Mi.skill]);
      var cost = 0.55 + (pool.length === 1 ? 0.5 : 0) + 0.2 * tacOf(O);
      if (typeof p.sys === "number" && C.anyUnits(g, p.sys, "D")) cost += 0.3;
      var v = stop * value - cost;
      if (v > bv) { bv = v; best = { O: O, stop: stop }; }
    });
    if (lvl === "recruit" && est() < 0.35) bv = -1;
    if (best && bv > 0) return { leader: best.O.id, why: best.O.name + " opposes (" + Math.round(best.stop * 100) + "% to stop it)." };
    return { leader: null, why: "" };
  };

  Dom.build = function (g, lvl) {
    var s = g.s, pts = s.points.D, b = belief(g), orders = [];
    var siteNear = function (sites) {
      var best = sites[0], bv = 99;
      sites.forEach(function (x) { var d = s.baseRevealed ? DIST[x][s.base] : b.cands.reduce(function (a, c) { return a + b.p[c] * DIST[x][c]; }, 0); if (d < bv) { bv = d; best = x; } });
      return best;
    };
    var all = { carry: 0, cap: 0, walkers: 0, troopers: 0 };
    for (var i = 0; i < N; i++) { var st = s.u[i].D; all.carry += C.carryOf(st); all.cap += C.capOf(st); all.walkers += C.cnt(st, "walker"); all.troopers += C.cnt(st, "trooper"); }
    if (pts.ground) {
      var gs = siteNear(pts.sites.ground), gp = pts.ground;
      while (gp >= 2 && all.walkers * 4 < all.troopers) { orders.push({ type: "walker", sys: gs, n: 1 }); gp -= 2; all.walkers++; all.carry++; }
      if (gp) { orders.push({ type: "trooper", sys: gs, n: gp }); all.carry += gp; }
    }
    if (pts.space) {
      var ss = siteNear(pts.sites.space), sp = pts.space;
      while (sp >= 2 && all.carry > all.cap - 2) { orders.push({ type: "carrier", sys: ss, n: 1 }); sp -= 2; all.cap += 4; }
      while (sp >= 3) { orders.push({ type: "destroyer", sys: ss, n: 1 }); sp -= 3; }
      if (sp >= 2) { orders.push({ type: "carrier", sys: ss, n: 1 }); sp -= 2; }
      if (sp) orders.push({ type: "fighter", sys: ss, n: sp });
    }
    return { orders: merge(orders), why: "Troopers to search with, carriers to move them, near the systems still in question." };
  };
  function merge(orders) {
    var m = {}; orders.forEach(function (o) { var k = o.type + "@" + o.sys; if (m[k]) m[k].n += o.n; else m[k] = { type: o.type, sys: o.sys, n: o.n }; });
    return Object.keys(m).map(function (k) { return m[k]; });
  }

  // ============================================================ INSURGENTS
  var Ins = {};
  Ins.placeBase = function (g) {
    var sites = C.validBaseSites(g), tot = 0;
    var w = sites.map(function (i) {
      var x = Math.pow(C.HOME_DIST[i], 2) * (SYS[i].p ? 1 : 1.6);
      if (SYS[i].adj.some(function (a) { return C.anyUnits(g, a, "I"); })) x *= 0.6;
      tot += x; return x;
    });
    var r = est() * tot, k = 0;
    for (; k < sites.length - 1; k++) { r -= w[k]; if (r <= 0) break; }
    return { sys: sites[k], why: "Far from the Throne Reach" + (SYS[sites[k]].p ? "" : ", in a remote system nobody fights over") + ", and not next to your fleet." };
  };

  function danger(g) {
    var s = g.s;
    if (s.baseRevealed) return { lvl: 3, why: "the base is revealed", c: 1 };
    var c = C.hunterCandidates(g).length, near = 99;
    for (var j = 0; j < N; j++) if (C.groundAt(g, j, "D") > 0 && C.capOf(s.u[j].D) > 0) near = Math.min(near, DIST[s.base][j]);
    if (c <= 2) return { lvl: 3, why: "the Dominion is down to " + c + " possible system" + (c === 1 ? "" : "s"), c: c, near: near };
    if (near <= 1 && c <= 6) return { lvl: 3, why: "Dominion troop ships are one jump away and only " + c + " systems remain in question", c: c, near: near };
    if (c <= 5 || near <= 1) return { lvl: 2, why: "the hunter is closing in (" + c + " systems still in question)", c: c, near: near };
    return { lvl: c <= 8 ? 1 : 0, why: "", c: c, near: near };
  }
  Ins.danger = danger;
  function candidatesAfterRelocation(g) { var s = g.s; return s.probeDeck.filter(function (i) { return i !== s.base && !C.anyUnits(g, i, "D") && !s.ruined[i]; }).length; }
  Ins.candidatesAfterRelocation = candidatesAfterRelocation;
  function relocationHelps(g, dg) {
    if (!targetsFor(g, "I", "redeploy").length) return false;
    if (g.s.baseRevealed) return true;
    var after = candidatesAfterRelocation(g);
    return after > (dg.c || 0) + 1 || (dg.lvl >= 3 && after >= 2);
  }
  function bestRelocation(g) {
    var s = g.s, t = targetsFor(g, "I", "redeploy"), best = null, bv = -99;
    t.forEach(function (x) { var dd = minDistTo(x, function (j) { return C.groundAt(g, j, "D") > 0; }); var v = Math.min(dd, 4) * 1.2 + C.HOME_DIST[x] * 0.4 + (SYS[x].p ? 0 : 0.5) + est() * 0.8; if (v > bv) { bv = v; best = x; } });
    return best;
  }
  function swayTargets(g, id) {
    var s = g.s;
    return targetsFor(g, "I", id).map(function (x) {
      var dd = minDistTo(x, function (j) { return C.groundAt(g, j, "D") > 0; });
      var v = (s.loy[x] === "D" ? 1.2 : 1.5) + 0.35 * Math.min(dd, 3) + SYS[x].ic.length * 0.2;
      if (C.anyUnits(g, x, "D")) v -= 0.6;
      return { sys: x, v: v, dd: dd };
    }).sort(function (a, b) { return b.v - a.v; });
  }

  function insMissionValues(g) {
    var s = g.s, hand = s.objHand, dg = danger(g), v = {}, has = function (o) { return hand.indexOf(o) >= 0; };
    var loyObj = has("spark") || has("uprise") || has("wide");
    if (dg.lvl >= 2 && relocationHelps(g, dg)) v.redeploy = { v: 10, why: dg.why + ", so a relocation stands ready" };
    if (targetsFor(g, "I", "rally").length) v.rally = { v: 1.5 + (loyObj ? 0.7 : 0), why: "loyal systems build units and feed loyalty objectives", multi: true };
    if (targetsFor(g, "I", "sabotage").length) v.sabotage = { v: 1.1 + (has("lines") ? 0.9 : 0), why: "the Dominion must spend an activation to fix it or lose the production", multi: true };
    if (hand.length < 3 && s.objDeck.length) v.gather = { v: 1.0, why: "more objectives to choose from" };
    if (targetsFor(g, "I", "uprising").length) v.uprising = { v: 2.1 + (loyObj ? 0.5 : 0), why: "a loyal system and a fresh infantry in one mission" };
    if (targetsFor(g, "I", "plans").length) v.plans = { v: has("intel") ? 2.8 : 2.0, why: "without the plans the superweapon cannot be hurt" };
    if (s.captives.length) v.breakout = { v: 3, why: "captured leaders are lost actions" };
    if (targetsFor(g, "I", "ally").length) v.ally = { v: 2.6, why: "one more leader means one more action every round" };
    v.decoy = { v: dg.lvl >= 1 ? 2.1 : 0.7, why: "jams the Dominion's free probe cards this round" };
    if (targetsFor(g, "I", "supply").length) v.supply = { v: 1.6, why: "units in the Dominion build queue can be destroyed before they deploy" };
    v.cache = { v: 1.3, why: "free defenders at the base" };
    if (targetsFor(g, "I", "inspire").length) v.inspire = { v: 3.5, why: "a reputation point is a round off the clock" };
    return v;
  }

  Ins.assign = function (g, lvl) {
    var s = g.s, L = C.leadersOf(g, "I", "pool").length;
    var nMis = L <= 3 ? 2 : (L <= 5 ? 3 : 4);
    if (danger(g).lvl >= 2) nMis++;
    nMis = Math.min(nMis, Math.max(1, L - 1));
    var r = chooseAssignment(g, "I", insMissionValues(g), nMis, lvl);
    var res = L - r.list.reduce(function (a, x) { return a + x.leaders.length; }, 0);
    return { list: r.list, why: "Keeps " + res + " in reserve to oppose a Dominion mission or strike when a fight pays. " + r.notes.join(" ") };
  };

  function insMissionOptions(g, lvl) {
    var s = g.s, out = [], dg = danger(g);
    C.hiddenMissions(g, "I").forEach(function (m) {
      var c = C.card(g, "I", m.card), t = C.missionTargets(g, "I", m.card), names = m.leaders.map(function (id) { return C.leader(g, id).name; }).join(" and ");
      if (!t.length) return;
      var best = t[0], v = 1, why = names + " carry out " + M[c.id].name + ".";
      switch (c.id) {
        case "redeploy": best = bestRelocation(g); v = !relocationHelps(g, dg) ? 0.1 : (dg.lvl >= 3 ? 10 : (dg.lvl === 2 ? 3 : 0.3)); why = names + " relocate the base" + (dg.why ? " because " + dg.why : "") + ", before troops arrive rather than after."; break;
        case "rally": case "uprising": var sw = swayTargets(g, c.id)[0]; best = sw.sys; v = sw.v + (c.id === "uprising" ? 0.6 : 0); why = names + " " + (c.id === "rally" ? "rally " : "start an uprising on ") + nm(best) + (sw.dd >= 2 ? ", " + sw.dd + " jumps from the nearest Dominion troops." : "."); break;
        case "sabotage":
          var sb = t.map(function (x) { return { x: x, v: SYS[x].ic.length * 0.5 + (C.anyUnits(g, x, "D") ? -0.3 : 0.2) + est() * 0.3 }; }).sort(function (a, b2) { return b2.v - a.v; })[0];
          best = sb.x; v = 1.2 + sb.v; why = names + " sabotage " + nm(best) + ": it builds nothing until the Dominion spends an activation there."; break;
        case "inspire": v = 3.5; why = names + " inspire the galaxy at " + nm(best) + "."; break;
        case "plans": v = 2.5; why = names + " go after the superweapon plans."; break;
        case "breakout": v = 3; why = names + " break out the captives."; break;
        case "supply": var bq = 0; t.forEach(function (x) { var n = g.s.queue.filter(function (q) { return q.side === "D" && q.sys === x; }).length; if (n > bq) { bq = n; best = x; } }); v = 1 + bq * 0.5; why = names + " hit the build queue at " + nm(best) + "."; break;
        case "decoy": v = 2; break;
        default: v = 1.8;
      }
      out.push({ type: "mission", card: m.card, target: best, v: v + noise(lvl), why: why });
    });
    return out;
  }

  function insActivationOptions(g, lvl) {
    var s = g.s, out = [], hand = s.objHand, has = function (o) { return hand.indexOf(o) >= 0; };
    var actor = bestLeader(g, "I", "gr"), spaceL = bestLeader(g, "I", "sp");
    if (!actor) return out;
    for (var T = 0; T < N; T++) {
      if (!C.activatable(g, "I", T)) continue;
      var plan = planMoves(g, "I", T, { groundFirst: true });
      if (!C.total(plan.units)) continue;
      var Dm = s.u[T].D, v = 0, why = [], who = actor;
      if (C.total(Dm)) {
        var mine = mergeSt(s.u[T].I, plan.units);
        var spaceFight = C.total(Dm, function (x) { return x.dom === "space"; }) > 0;
        who = spaceFight && spaceL ? spaceL : actor;
        var e = estFor(g, "I", mine, Dm, T, Math.max(who.sp, who.gr) / 2, 1);
        v = 0.6 * e.lossB - 0.8 * e.lossA;
        if (has("hitrun") && C.total(Dm) >= 2) v += 1.6 * e.pWin;
        if (has("raid")) v += 1.5 * Math.min(1, e.killsB / 3);
        if (has("ambush")) v += 1.8 * Math.min(1, e.capB);
        if (has("rout")) v += 2.5 * Math.min(1, e.capB / 2);
        if (has("liberty") && s.loy[T] === "D" && !SYS[T].throne) v += 2.2 * e.pGround;
        if (has("core") && SYS[T].home) v += 3 * e.pWin;
        if (Dm.superweapon && s.plans) v += 3 * e.pWin;
        if (s.loy[T] === "D" && SYS[T].p) v += 0.5 * e.pGround;
        if (e.pWin < 0.45 && v < 1.2) v -= 1.2;
        why.push("strikes " + C.unitList(Dm) + " at " + nm(T) + " (about " + Math.round(e.pWin * 100) + "% to win)");
      } else {
        var gIn = C.total(plan.units, function (x) { return x.dom === "ground"; });
        if (s.loy[T] === "D" && gIn > 0 && !SYS[T].throne) { v += 1.4 + (has("liberty") ? 2.2 : 0); why.push("walks into undefended " + nm(T) + " and takes it back"); }
        plan.moves.forEach(function (m) {
          if (m.from === "base") return;
          var threat = 0, threatT = 0;
          SYS[m.from].adj.forEach(function (a) { threat += C.total(s.u[a].D); });
          SYS[T].adj.forEach(function (a) { threatT += C.total(s.u[a].D); });
          if (threat > C.total(s.u[m.from].I) * 1.5 && threatT < threat * 0.5) { v += 0.7; why.push("pulls units out of reach of a bigger Dominion force"); }
        });
        if (s.loy[T] === "I" && SYS[T].adj.some(function (a) { return C.groundAt(g, a, "D") > 0; }) && C.groundAt(g, T, "I") === 0 && gIn > 0) { v += 0.6; why.push("garrisons loyal " + nm(T)); }
      }
      if (s.baseRevealed && T === s.base) { var gi = C.total(plan.units, function (x) { return x.dom === "ground"; }); if (gi) { v += 2 + gi * 0.5; why.push("reinforces the exposed base"); } }
      if (v <= 0) continue;
      out.push({ type: "activate", leader: who.id, sys: T, moves: plan.moves, v: v + noise(lvl), why: who.name + " " + why.join("; ") + "." });
    }
    return out;
  }

  Ins.command = function (g, lvl) {
    var opts = insMissionOptions(g, lvl).concat(insActivationOptions(g, lvl));
    var pool = C.leadersOf(g, "I", "pool").length;
    var keep = C.hiddenMissions(g, "D").length > 0 && pool === 1 ? 1.4 : 0;
    opts.forEach(function (o) { if (o.type === "activate") o.v -= keep; });
    opts.sort(function (a, b) { return b.v - a.v; });
    if (opts[0] && opts[0].v > 0.45) return opts[0];
    return { type: "pass", why: keep ? "Keeps the last reserve leader to oppose a hidden mission." : "Nothing worth a leader right now." };
  };

  Ins.oppose = function (g, lvl) {
    var s = g.s, p = s.pending, pool = C.leadersOf(g, "I", "pool");
    if (!pool.length) return { leader: null, why: "" };
    var Mi = M[p.id], c = C.hunterCandidates(g).length, value = 0;
    switch (p.id) {
      case "seize": value = 3; break;
      case "probe": value = c <= 6 ? 2.4 : 1.0; break;
      case "interrogate": value = 2.6; break;
      case "scan": value = SYS[p.sys].r === SYS[s.base].r && !s.baseRevealed ? 6 : 1.6; if (lvl !== "recruit" && value < 2 && est() < 0.45) value = 2.5; break;
      case "decree": value = p.sys === s.base && !s.baseRevealed ? 12 : (s.loy[p.sys] === "I" ? 1.5 : 0.7); if (lvl !== "recruit" && value < 1 && est() < 0.4) value = 2; break;
      case "crackdown": value = 1.5; break;
      case "project": value = 2; break;
      case "annihilate": value = p.sys === s.base ? 3 : 1.5 + C.total(s.u[p.sys].I) * 0.3; break;
    }
    var best = null, bv = -9;
    pool.forEach(function (O) {
      var stop = 1 - C.missionOdds(p.dice, O[Mi.skill]);
      var cost = 0.5 + (pool.length === 1 && C.hiddenMissions(g, "D").length ? 0.5 : 0) + 0.15 * tacOf(O);
      if (typeof p.sys === "number" && C.anyUnits(g, p.sys, "D") && C.hiddenMissions(g, "D").length) cost += 0.3;
      var v = stop * value - cost;
      if (v > bv) { bv = v; best = { O: O, stop: stop }; }
    });
    if (lvl === "recruit" && est() < 0.3) bv = -1;
    // one reason for every case, so opposing never points at the base
    if (best && bv > 0) return { leader: best.O.id, why: best.O.name + " opposes (" + Math.round(best.stop * 100) + "% to stop it)." };
    return { leader: null, why: "" };
  };

  Ins.build = function (g, lvl) {
    var s = g.s, pts = s.points.I, orders = [];
    var fleetSys = null, fv = -1;
    for (var i = 0; i < N; i++) { var v = C.total(s.u[i].I); if (v > fv && pts.sites.space.indexOf(i) >= 0) { fv = v; fleetSys = i; } }
    var site = function (dom) {
      if (dom === "ground") return C.total(s.baseBox, function (x) { return x.dom === "ground"; }) < 6 && pts.sites.ground.indexOf("base") >= 0 ? "base" : (pts.sites.ground.filter(function (x) { return x !== "base"; })[0] || "base");
      return fleetSys != null ? fleetSys : (pts.sites.space.filter(function (x) { return x !== "base"; })[0] || "base");
    };
    var dWalkers = 0, dCaps = 0; for (var j = 0; j < N; j++) { dWalkers += C.cnt(s.u[j].D, "walker"); dCaps += C.cnt(s.u[j].D, "destroyer") + C.cnt(s.u[j].D, "carrier"); }
    var gp = pts.ground, k = 0;
    while (gp > 0) { orders.push({ type: (dWalkers > 1 && k % 2) ? "skimmer" : "infantry", sys: site("ground"), n: 1 }); gp--; k++; }
    var sp = pts.space, all = { carry: 0, cap: 0 };
    for (var m = 0; m < N; m++) { all.carry += C.carryOf(s.u[m].I); all.cap += C.capOf(s.u[m].I); }
    all.carry += C.carryOf(s.baseBox); all.cap += C.capOf(s.baseBox);
    var ss = site("space");
    while (sp > 0) {
      if (all.carry > all.cap - 1) { orders.push({ type: "transport", sys: ss, n: 1 }); sp -= 1; all.cap += 3; }
      else if (sp >= 3 && s.round >= 4) { orders.push({ type: "cruiser", sys: ss, n: 1 }); sp -= 3; all.cap += 2; }
      else if (sp >= 2) { orders.push({ type: "corvette", sys: ss, n: 1 }); sp -= 2; all.cap += 1; }
      else { orders.push({ type: dCaps > 3 ? "bomber" : "interceptor", sys: ss, n: 1 }); sp -= 1; all.carry++; }
    }
    return { orders: merge(orders), why: "Ground units to the hidden base for defense, ships with the fleet, and enough transports to carry them." };
  };

  // ============================================================ battle decisions (both sides)
  function battleCards(g, side) {
    var s = g.s, b = s.battle, foe = C.other(side), pick = { space: null, ground: null };
    ["space", "ground"].forEach(function (dom) {
      var hand = b.hands[side][dom]; if (!hand.length) return;
      var mine = b.units[side].filter(function (x) { return U[x.t].dom === dom; }), theirs = b.units[foe].filter(function (x) { return U[x.t].dom === dom; });
      if (!mine.length || !theirs.length) return;
      var foeHeavy = theirs.filter(function (x) { return U[x.t].heavy; }).length, foeLight = theirs.length - foeHeavy;
      var behind = mine.length < theirs.length * 0.8;
      var score = function (c) {
        switch (c) {
          case "focus": case "barrage": return foeHeavy ? 2 + foeHeavy * 0.3 : 0.2;
          case "strafe": case "charge": return foeLight ? 2 + foeLight * 0.2 : 0.2;
          case "holdfast": return mine.filter(function (x) { return U[x.t].L; }).length * 0.4 + 0.5;
          case "combined": return 1.8;
          case "evade": case "entrench": return behind ? 2.6 : 1.2;
          case "regroup": case "fallback": return behind && !C.hasLeaderAt(g, side, b.sys) ? 2.2 : 0.1;
        }
        return 0;
      };
      var bi = -1, bv = 0.5;
      hand.forEach(function (c, i) { var v = score(c); if (v > bv) { bv = v; bi = i; } });
      if (bi >= 0) pick[dom] = bi;
    });
    return { choice: pick };
  }
  function battleRetreat(g, side) {
    var s = g.s, b = s.battle, foe = C.other(side);
    var targets = C.retreatTargets(g, side);
    if (!targets.length) return { to: null };
    // never abandon a revealed base while the enemy has ground units there
    if (side === "I" && b.atBase && b.units.D.some(function (x) { return U[x.t].dom === "ground"; })) return { to: null, why: "Holds the base: retreating would hand it over." };
    var mine = C.collapse(b.units[side]), theirs = C.collapse(b.units[foe]);
    var e = side === "I" ? estBattle(mine, theirs, { plans: s.plans }, 40) : estBattleSwap(theirs, mine, { atBase: b.atBase, plans: s.plans }, 40);
    var threshold = side === "D" && b.atBase ? 0.08 : 0.3;
    if (e.pWin >= threshold) return { to: null };
    var best = targets[0], bv = -99;
    targets.forEach(function (t) { var v = (s.loy[t] === side ? 2 : 0) - SYS[t].adj.reduce(function (a, x) { return a + C.total(s.u[x][foe]); }, 0) * 0.1 + (C.anyUnits(g, t, side) ? 1 : 0); if (v > bv) { bv = v; best = t; } });
    return { to: best, why: "Retreats to " + nm(best) + ": the fight was lost (about " + Math.round(e.pWin * 100) + "% to win if it stayed)." };
  }

  // ============================================================ driver
  var BOT = { I: Ins, D: Dom };
  function act(g, side, a) {
    if (a.type === "activate") C.activate(g, side, a.leader, a.sys, a.moves);
    else if (a.type === "mission") C.revealMission(g, side, a.card, a.target);
    else if (a.type === "pass") C.pass(g, side);
    else throw new Error("unknown action " + a.type);
  }
  // Make one decision for `side`, whatever the game is waiting for. Returns {kind, why}.
  function step(g, side, lvl) {
    var s = g.s;
    if (s.phase === "setup") { var pb = Ins.placeBase(g); C.placeBase(g, pb.sys); return { kind: "setup", why: pb.why, private: true }; }
    if (s.phase === "assign") { var as = BOT[side].assign(g, lvl); C.submitAssignment(g, side, as.list); return { kind: "assign", why: as.why, private: true }; }
    if (s.phase === "build") { var bd = BOT[side].build(g, lvl); C.submitBuild(g, side, bd.orders); return { kind: "build", why: bd.why, private: true }; }
    if (s.battle) {
      if (s.battle.stage === "cards") { var bc = battleCards(g, side); C.battleCards(g, side, bc.choice); return { kind: "cards" }; }
      var br = battleRetreat(g, side); C.battleRetreat(g, side, br.to); return { kind: "retreat", why: br.to != null ? br.why : "" };
    }
    if (s.pending) { var op = BOT[side].oppose(g, lvl); C.oppose(g, side, op.leader); return { kind: "oppose", why: op.why }; }
    var a = BOT[side].command(g, lvl); act(g, side, a); return { kind: a.type, why: a.type === "pass" ? "" : a.why };
  }
  return { planDetachment: planDetachment, Dom: Dom, Ins: Ins, BOT: BOT, act: act, step: step, belief: belief, estBattle: estBattle, estFor: estFor, danger: danger, planMoves: planMoves, battleCards: battleCards, battleRetreat: battleRetreat };
});
