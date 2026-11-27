/* Sparring drill for the Rebellion Field Manual: rules engine.
 *
 * An original, deliberately small two-player game built to practise the core decisions of
 * Star Wars: Rebellion (a hidden base, a time/reputation clock, leaders as actions, opposed
 * missions, pinning, probes, objectives, relocation). It is not a copy of Rebellion: the map,
 * names, units, missions and objectives are invented and much simpler.
 *
 * Sides: "I" = Insurgents (the hiding side, plays like the Rebels)
 *        "D" = Dominion  (the hunting side, plays like the Empire)
 *
 * Works in the browser (window.Drill) and in Node (module.exports) for self-play tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Drill = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------- tunables
  var CFG = {
    startRep: 14,          // reputation marker start; time starts at 1
    objPerRound: 1,        // objectives the Insurgents may complete per round
    probesPerRound: 1,     // probe cards the Dominion draws each refresh
    probeMissionDraw: 2,   // extra cards from a successful Probe mission
    hitOn: 4,              // d6 value needed to hit / succeed
    baseHitOn: 3,          // Insurgent troops defending a revealed base
    captureRounds: 2,      // refreshes a captured leader sits out
    carry: 2               // troops each ship can carry
  };

  // ---------------------------------------------------------------- map
  // p = populous (can hold loyalty, produces units); core = Dominion home systems.
  var SYS = [
    { n: "Aurex",   x: 70,  y: 320, p: 1, core: 1, throne: 1 },
    { n: "Brannoc", x: 175, y: 160, p: 1, core: 1 },
    { n: "Cindra",  x: 185, y: 480, p: 1, core: 1 },
    { n: "Dovan",   x: 265, y: 320, p: 1, core: 1 },
    { n: "Elsk",    x: 320, y: 80,  p: 0 },
    { n: "Farrow",  x: 385, y: 225, p: 1 },
    { n: "Gethis",  x: 400, y: 415, p: 1 },
    { n: "Hallon",  x: 320, y: 565, p: 0 },
    { n: "Jorun",   x: 505, y: 115, p: 1 },
    { n: "Kesh",    x: 525, y: 320, p: 1 },
    { n: "Lirra",   x: 515, y: 520, p: 1 },
    { n: "Mavik",   x: 645, y: 210, p: 0 },
    { n: "Nolle",   x: 660, y: 425, p: 1 },
    { n: "Orrin",   x: 705, y: 70,  p: 1 },
    { n: "Pyrax",   x: 675, y: 585, p: 0 },
    { n: "Quessa",  x: 795, y: 300, p: 1 },
    { n: "Rhune",   x: 820, y: 490, p: 1 },
    { n: "Saltis",  x: 865, y: 130, p: 0 },
    { n: "Tovan",   x: 935, y: 315, p: 0 },
    { n: "Wend",    x: 935, y: 560, p: 1 }
  ];
  var EDGES = [
    "Aurex-Brannoc", "Aurex-Cindra", "Aurex-Dovan", "Brannoc-Dovan", "Brannoc-Elsk", "Brannoc-Farrow",
    "Cindra-Dovan", "Cindra-Gethis", "Cindra-Hallon", "Dovan-Farrow", "Dovan-Gethis", "Elsk-Farrow",
    "Elsk-Jorun", "Farrow-Jorun", "Farrow-Kesh", "Gethis-Kesh", "Gethis-Lirra", "Gethis-Hallon",
    "Hallon-Lirra", "Jorun-Mavik", "Jorun-Orrin", "Kesh-Mavik", "Kesh-Nolle", "Lirra-Nolle", "Lirra-Pyrax",
    "Mavik-Orrin", "Mavik-Quessa", "Nolle-Quessa", "Nolle-Rhune", "Nolle-Pyrax", "Orrin-Saltis",
    "Pyrax-Wend", "Quessa-Saltis", "Quessa-Tovan", "Quessa-Rhune", "Rhune-Wend", "Rhune-Tovan",
    "Saltis-Tovan", "Tovan-Wend"
  ];
  var N = SYS.length;
  var IDX = {};
  SYS.forEach(function (s, i) { s.id = i; s.adj = []; IDX[s.n] = i; });
  EDGES.forEach(function (e) {
    var ab = e.split("-"), a = IDX[ab[0]], b = IDX[ab[1]];
    SYS[a].adj.push(b); SYS[b].adj.push(a);
  });
  // all-pairs distances (BFS)
  var DIST = [];
  for (var i = 0; i < N; i++) {
    var d = new Array(N).fill(99); d[i] = 0; var q = [i];
    while (q.length) { var u = q.shift(); SYS[u].adj.forEach(function (v) { if (d[v] > d[u] + 1) { d[v] = d[u] + 1; q.push(v); } }); }
    DIST.push(d);
  }
  var CORE = SYS.filter(function (s) { return s.core; }).map(function (s) { return s.id; });
  var NONCORE = SYS.filter(function (s) { return !s.core; }).map(function (s) { return s.id; });
  var CORE_DIST = SYS.map(function (s) { return Math.min.apply(null, CORE.map(function (c) { return DIST[c][s.id]; })); });

  // ---------------------------------------------------------------- leaders
  // int = intrigue (mission dice), tac = tactics (bonus battle dice). from = round recruited.
  var LEADERS = [
    { id: "i1", side: "I", name: "Sera Vane",    int: 3, tac: 0, from: 1 },
    { id: "i2", side: "I", name: "Odo Brask",    int: 1, tac: 2, from: 1 },
    { id: "i3", side: "I", name: "Lin Tarro",    int: 2, tac: 1, from: 1 },
    { id: "i4", side: "I", name: "Mira Quell",   int: 2, tac: 1, from: 4 },
    { id: "d1", side: "D", name: "Marshal Dekk", int: 1, tac: 2, from: 1 },
    { id: "d2", side: "D", name: "Adjutant Vos", int: 3, tac: 0, from: 1 },
    { id: "d3", side: "D", name: "Prefect Halm", int: 2, tac: 1, from: 1 },
    { id: "d4", side: "D", name: "Captain Rusk", int: 1, tac: 2, from: 3 },
    { id: "d5", side: "D", name: "Agent Thale",  int: 2, tac: 1, from: 6 }
  ];

  // ---------------------------------------------------------------- missions
  var MISSIONS = {
    sway:     { side: "I", name: "Sway",     opp: true,  blurb: "Move a populous system one step toward Insurgent loyalty. Target must have no Dominion troops." },
    sabotage: { side: "I", name: "Sabotage", opp: true,  blurb: "A Dominion-loyal system stops producing until the Dominion activates it." },
    relocate: { side: "I", name: "Relocate", opp: false, blurb: "Move the base to a system the hunter has not ruled out. Needs intrigue 2+. Cannot be opposed. Units in the old base are left behind, exposed." },
    probe:    { side: "D", name: "Probe",    opp: true,  blurb: "Draw two extra probe cards. Target: any system with Dominion units." },
    decree:   { side: "D", name: "Decree",   opp: true,  blurb: "Move a populous system one step toward Dominion loyalty. Target must touch or hold Dominion units and have no Insurgent troops. Dominion loyalty in the base system reveals it." },
    hunt:     { side: "D", name: "Hunt",     opp: true,  blurb: "Capture an Insurgent leader standing in a system that holds Dominion units. Captives sit out two rounds." }
  };

  // ---------------------------------------------------------------- objectives
  // Checked automatically at the end of each round. Stage I cards are on top of the deck.
  var OBJECTIVES = [
    { id: "spark",   stage: 1, val: 1, name: "Spark of Defiance", text: "Hold 4 loyal systems.", test: function (s) { return countLoyal(s, "I") >= 4; } },
    { id: "hitrun",  stage: 1, val: 1, name: "Hit and Run",       text: "Win a battle this round.", test: function (s) { return s.flags.iWins > 0; } },
    { id: "lines",   stage: 1, val: 1, name: "Cut the Lines",     text: "Have 2 Dominion systems sabotaged at once.", test: function (s) { return countSab(s) >= 2; } },
    { id: "raid",    stage: 1, val: 1, name: "Supply Raid",       text: "Destroy 2 or more Dominion troops in one battle this round.", test: function (s) { return s.flags.maxTroopKill >= 2; } },
    { id: "uprise",  stage: 2, val: 2, name: "Uprising",          text: "Hold 6 loyal systems.", test: function (s) { return countLoyal(s, "I") >= 6; } },
    { id: "liberty", stage: 2, val: 2, name: "Liberation",        text: "Retake a Dominion-loyal system with your troops this round.", test: function (s) { return s.flags.liberated; } },
    { id: "ambush",  stage: 2, val: 2, name: "Ambush",            text: "Destroy 3 or more Dominion ships this round.", test: function (s) { return s.flags.domShipsLost >= 3; } },
    { id: "throne",  stage: 2, val: 2, name: "Strike the Core",   text: "Win a battle in a Dominion home system this round.", test: function (s) { return s.flags.coreWin; } }
  ];
  var OBJ = {}; OBJECTIVES.forEach(function (o) { OBJ[o.id] = o; });

  function countLoyal(s, side) { var c = 0; for (var i = 0; i < N; i++) if (s.loy[i] === side) c++; return c; }
  function countSab(s) { var c = 0; for (var i = 0; i < N; i++) if (s.sab[i] && s.loy[i] === "D") c++; return c; }

  // ---------------------------------------------------------------- rng
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // The dice live in the state (s.rs) so a saved game resumes with the same sequence.
  function stateRng(s) {
    return function () {
      var a = (s.rs | 0); a = (a + 0x6D2B79F5) | 0; s.rs = a;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function restore(s) { return { s: s, r: stateRng(s), cfg: CFG }; }
  function shuffle(arr, r) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  function d6(r) { return 1 + Math.floor(r() * 6); }

  // ---------------------------------------------------------------- state
  function emptyUnits() { var u = []; for (var i = 0; i < N; i++) u.push({ Is: 0, It: 0, Ds: 0, Dt: 0 }); return u; }

  function newGame(opts) {
    opts = opts || {};
    var seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
    var s = {
      seed: seed, rs: seed >>> 0, round: 1, time: 1, rep: CFG.startRep, phase: "setup", winner: null, winReason: "",
      u: emptyUnits(), loy: new Array(N).fill(null), sab: new Array(N).fill(false),
      base: null, baseRevealed: false, baseBox: { s: 1, t: 3 }, relocations: 0, baseHistory: [],
      probeDeck: [], probeHand: [],
      know: { cleared: [], leaks: [], excluded: [] },  // public deductions since the last relocation
      leaders: LEADERS.map(function (L) { return { id: L.id, side: L.side, name: L.name, int: L.int, tac: L.tac, from: L.from, status: L.from <= 1 ? "pool" : "future", loc: null, mission: null, capturedFor: 0 }; }),
      objDeck: [], objHand: [], objScored: [],
      assigned: { I: null, D: null },
      turn: "I", passes: 0, pending: null,
      flags: freshFlags(), lastBattle: null,
      log: [], events: []
    };
    // Dominion home systems
    CORE.forEach(function (c) { s.loy[c] = "D"; });
    s.u[IDX.Aurex].Ds = 2; s.u[IDX.Aurex].Dt = 3;
    s.u[IDX.Brannoc].Ds = 1; s.u[IDX.Brannoc].Dt = 2;
    s.u[IDX.Cindra].Ds = 1; s.u[IDX.Cindra].Dt = 2;
    s.u[IDX.Dovan].Ds = 2; s.u[IDX.Dovan].Dt = 2;
    // Insurgent start
    s.loy[IDX.Quessa] = "I"; s.loy[IDX.Wend] = "I";
    s.u[IDX.Quessa].Is = 2; s.u[IDX.Quessa].It = 2;
    var r = stateRng(s);
    // decks
    var st1 = OBJECTIVES.filter(function (o) { return o.stage === 1; }).map(function (o) { return o.id; });
    var st2 = OBJECTIVES.filter(function (o) { return o.stage === 2; }).map(function (o) { return o.id; });
    s.objDeck = shuffle(st1, r).concat(shuffle(st2, r));
    s.objHand.push(s.objDeck.shift());
    var g = restore(s);
    log(g, null, "setup", "Round 1. Time 1, reputation " + s.rep + ". The Insurgents pick a secret base.");
    return g;
  }

  function freshFlags() { return { iWins: 0, coreWin: false, coreMission: false, liberated: false, domShipsLost: 0, maxTroopKill: 0 }; }

  function log(g, side, kind, text, data) {
    var e = { round: g.s.round, side: side, kind: kind, text: text, data: data || null };
    g.s.log.push(e); g.s.events.push(e);
    return e;
  }
  function drainEvents(g) { var e = g.s.events; g.s.events = []; return e; }

  function other(side) { return side === "I" ? "D" : "I"; }
  function sideName(side) { return side === "I" ? "Insurgents" : "Dominion"; }
  function leader(g, id) { for (var i = 0; i < g.s.leaders.length; i++) if (g.s.leaders[i].id === id) return g.s.leaders[i]; return null; }
  function leadersOf(g, side, status) { return g.s.leaders.filter(function (L) { return L.side === side && (!status || L.status === status); }); }
  function hasLeaderAt(g, side, sys) { return g.s.leaders.some(function (L) { return L.side === side && L.loc === sys && (L.status === "placed"); }); }
  function unitsAt(g, sys, side) { var u = g.s.u[sys]; return side === "I" ? { s: u.Is, t: u.It } : { s: u.Ds, t: u.Dt }; }
  function anyUnits(g, sys, side) { var x = unitsAt(g, sys, side); return x.s + x.t > 0; }

  // ---------------------------------------------------------------- setup
  function validBaseSites(g) {
    return NONCORE.filter(function (i) {
      if (anyUnits(g, i, "D") || anyUnits(g, i, "I")) return false;
      return !SYS[i].adj.some(function (a) { return anyUnits(g, a, "D"); });
    });
  }
  function placeBase(g, sys) {
    var s = g.s;
    if (s.phase !== "setup") throw new Error("not setup");
    if (validBaseSites(g).indexOf(sys) < 0) throw new Error("invalid base site");
    s.base = sys; s.baseHistory.push({ round: 1, sys: sys });
    s.probeDeck = shuffle(NONCORE.filter(function (i) { return i !== sys; }), g.r);
    // publicly known: the base did not start next to Dominion units or on any unit
    s.know.excluded = NONCORE.filter(function (i) { return validBaseSites(g).indexOf(i) < 0; });
    s.phase = "assign";
    log(g, "I", "setup", "The Insurgent base is hidden. The Dominion knows only that it is not in or next to a Dominion system.");
    return true;
  }

  // ---------------------------------------------------------------- knowledge
  // What the Dominion can deduce from public information. The Insurgent side can compute the same.
  function hunterCandidates(g) {
    var s = g.s;
    if (s.baseRevealed) return [s.base];
    var k = s.know;
    return NONCORE.filter(function (i) {
      if (s.probeHand.indexOf(i) >= 0) return false;
      if (k.cleared.indexOf(i) >= 0) return false;
      if (k.excluded.indexOf(i) >= 0) return false;
      for (var j = 0; j < k.leaks.length; j++) if (k.leaks[j].indexOf(i) < 0) return false;
      return true;
    });
  }
  function ruledOutReason(g, i) {
    var s = g.s, k = s.know;
    if (SYS[i].core) return "home";
    if (s.probeHand.indexOf(i) >= 0) return "probe";
    if (k.cleared.indexOf(i) >= 0) return "searched";
    if (k.excluded.indexOf(i) >= 0) return "excluded";
    for (var j = 0; j < k.leaks.length; j++) if (k.leaks[j].indexOf(i) < 0) return "movement";
    return null;
  }
  function clearSystem(g, i) { if (g.s.know.cleared.indexOf(i) < 0) g.s.know.cleared.push(i); }

  // ---------------------------------------------------------------- assignment
  function missionTypes(side) { return Object.keys(MISSIONS).filter(function (k) { return MISSIONS[k].side === side; }); }

  // list: [{leader: id, mission: type}] ; leaders not listed stay in the pool
  function validateAssignment(g, side, list) {
    var seen = {}, reloc = 0;
    list.forEach(function (a) {
      var L = leader(g, a.leader);
      if (!L || L.side !== side || L.status !== "pool") throw new Error("leader not available: " + a.leader);
      if (seen[a.leader]) throw new Error("leader twice");
      seen[a.leader] = 1;
      var M = MISSIONS[a.mission];
      if (!M || M.side !== side) throw new Error("bad mission " + a.mission);
      if (a.mission === "relocate") { reloc++; if (L.int < 2) throw new Error("Relocate needs intrigue 2+"); }
    });
    if (reloc > 1) throw new Error("only one Relocate per round");
  }
  function submitAssignment(g, side, list) {
    var s = g.s;
    if (s.phase !== "assign") throw new Error("not assignment phase");
    validateAssignment(g, side, list);
    s.assigned[side] = list.slice();
    if (s.assigned.I && s.assigned.D) startCommand(g);
  }
  function startCommand(g) {
    var s = g.s;
    ["I", "D"].forEach(function (side) {
      s.assigned[side].forEach(function (a) { var L = leader(g, a.leader); L.status = "mission"; L.mission = a.mission; });
      var n = s.assigned[side].length, pool = leadersOf(g, side, "pool").length;
      log(g, side, "assign", sideName(side) + " send " + n + " leader" + (n === 1 ? "" : "s") + " on missions (face down) and keep " + pool + " in reserve.");
    });
    s.assigned = { I: null, D: null };
    s.phase = "command"; s.turn = "I"; s.passes = 0;
    autoPass(g);
  }

  // ---------------------------------------------------------------- command: helpers
  function canAct(g, side) {
    return leadersOf(g, side, "pool").length > 0 || leadersOf(g, side, "mission").length > 0;
  }
  function activatable(g, side, sys) {
    if (hasLeaderAt(g, side, sys)) return false;
    return true;
  }
  // Units that could move into sys for side: [{from: id|'base', s, t}]
  function origins(g, side, sys) {
    var s = g.s, out = [];
    SYS[sys].adj.forEach(function (o) {
      if (hasLeaderAt(g, side, o)) return;
      var x = unitsAt(g, o, side);
      if (x.s > 0) out.push({ from: o, s: x.s, t: x.t });
    });
    if (side === "I" && !s.baseRevealed && s.base != null && (sys === s.base || SYS[s.base].adj.indexOf(sys) >= 0)) {
      if (!baseBoxPinned(g) && s.baseBox.s > 0) out.push({ from: "base", s: s.baseBox.s, t: s.baseBox.t });
    }
    return out;
  }
  function baseBoxPinned(g) { return g.s.leaders.some(function (L) { return L.side === "I" && L.loc === "base" && L.status === "placed"; }); }
  // Can units go INTO the base box? Only by activating the base system itself.
  function canEnterBaseBox(g, sys) { return !g.s.baseRevealed && sys === g.s.base; }

  function validateMoves(g, side, sys, moves) {
    var avail = {};
    origins(g, side, sys).forEach(function (o) { avail[o.from] = o; });
    moves.forEach(function (m) {
      var o = avail[m.from];
      if (!o) throw new Error("cannot move from " + m.from);
      if (m.s < 0 || m.t < 0 || m.s > o.s || m.t > o.t) throw new Error("bad counts");
      if (m.t > m.s * CFG.carry) throw new Error("not enough ships to carry troops");
    });
  }

  function missionTargets(g, side, type, leaderId) {
    var s = g.s, out = [];
    if (type === "sway") {
      for (var i = 0; i < N; i++) if (SYS[i].p && s.loy[i] !== "I" && s.u[i].Dt === 0 && !SYS[i].throne) out.push(i);
    } else if (type === "sabotage") {
      for (var j = 0; j < N; j++) if (s.loy[j] === "D" && !s.sab[j]) out.push(j);
    } else if (type === "relocate") {
      out = s.probeDeck.filter(function (i) { return s.u[i].Ds + s.u[i].Dt === 0 && i !== s.base; });
    } else if (type === "probe") {
      for (var k = 0; k < N; k++) if (s.u[k].Ds + s.u[k].Dt > 0) out.push(k);
    } else if (type === "decree") {
      for (var m = 0; m < N; m++) {
        if (!SYS[m].p || s.loy[m] === "D" || s.u[m].It > 0) continue;
        var near = s.u[m].Ds + s.u[m].Dt > 0 || SYS[m].adj.some(function (a) { return s.u[a].Ds + s.u[a].Dt > 0; });
        if (near) out.push(m);
      }
    } else if (type === "hunt") {
      // targets are leaders, returned as {leader, sys}
      s.leaders.forEach(function (L) {
        if (L.side === "I" && L.status === "placed" && typeof L.loc === "number" && s.u[L.loc].Ds + s.u[L.loc].Dt > 0) out.push({ leader: L.id, sys: L.loc });
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- command: actions
  function assertTurn(g, side) {
    var s = g.s;
    if (s.phase !== "command") throw new Error("not command phase");
    if (s.pending) throw new Error("waiting for an opposition decision");
    if (s.turn !== side) throw new Error("not your turn");
  }

  function activate(g, side, leaderId, sys, moves) {
    var s = g.s; assertTurn(g, side);
    var L = leader(g, leaderId);
    if (!L || L.side !== side || L.status !== "pool") throw new Error("leader not in pool");
    if (!activatable(g, side, sys)) throw new Error("you already have a leader there");
    moves = (moves || []).filter(function (m) { return m.s + m.t > 0; });
    validateMoves(g, side, sys, moves);
    L.status = "placed"; L.loc = sys;
    var ms = 0, mt = 0, fromBase = false, parts = [];
    moves.forEach(function (m) {
      if (m.from === "base") { s.baseBox.s -= m.s; s.baseBox.t -= m.t; fromBase = true; }
      else { var o = s.u[m.from]; if (side === "I") { o.Is -= m.s; o.It -= m.t; } else { o.Ds -= m.s; o.Dt -= m.t; } }
      ms += m.s; mt += m.t;
      parts.push(unitStr(m.s, m.t) + " from " + (m.from === "base" ? "the base" : SYS[m.from].n));
    });
    var dst = s.u[sys];
    if (side === "I") { dst.Is += ms; dst.It += mt; } else { dst.Ds += ms; dst.Dt += mt; }
    log(g, side, "activate", L.name + " activates " + SYS[sys].n + (parts.length ? ": " + parts.join(", ") + "." : " (no units move)."), { leader: L.id, sys: sys, moves: moves, fromBase: fromBase });
    if (side === "D" && s.sab[sys]) { s.sab[sys] = false; log(g, "D", "sabotage", "Activating " + SYS[sys].n + " clears its sabotage."); }
    if (fromBase) {
      var leak = [sys].concat(SYS[sys].adj).filter(function (i) { return !SYS[i].core; });
      s.know.leaks.push(leak);
      log(g, "I", "leak", "Units came out of the hidden base, so the base is in " + SYS[sys].n + " or a system next to it.", { sys: sys });
    }
    if (side === "D" && mt > 0) dominionTroopsArrive(g, sys);
    if (s.winner) return;
    if (anyUnits(g, sys, "I") && anyUnits(g, sys, "D")) battle(g, sys, side, L);
    if (s.winner) return;
    updateControl(g, sys, side);
    checkBaseWin(g);
    if (!s.winner) endAction(g, side);
  }

  // Insurgent-only: move units into the hidden base by activating the base system.
  function reinforceBase(g, leaderId, moves) {
    var s = g.s; assertTurn(g, "I");
    if (s.baseRevealed) throw new Error("base is revealed; just activate the system");
    var sys = s.base, L = leader(g, leaderId);
    if (!L || L.side !== "I" || L.status !== "pool") throw new Error("leader not in pool");
    if (!activatable(g, "I", sys)) throw new Error("leader already there");
    moves = moves.filter(function (m) { return m.s + m.t > 0 && m.from !== "base"; });
    validateMoves(g, "I", sys, moves);
    L.status = "placed"; L.loc = sys;
    var parts = [];
    moves.forEach(function (m) { var o = s.u[m.from]; o.Is -= m.s; o.It -= m.t; s.baseBox.s += m.s; s.baseBox.t += m.t; parts.push(unitStr(m.s, m.t) + " from " + SYS[m.from].n); });
    log(g, "I", "activate", L.name + " activates " + SYS[sys].n + " and moves units into the base: " + parts.join(", ") + ".", { leader: L.id, sys: sys, intoBase: true });
    s.know.leaks.push([sys]);
    log(g, "I", "leak", "Units moved into the hidden base by activating " + SYS[sys].n + ". The Dominion now knows the base is there.", { sys: sys });
    endAction(g, "I");
  }

  function dominionTroopsArrive(g, sys) {
    var s = g.s;
    if (sys === s.base && !s.baseRevealed) revealBase(g, "Dominion troops landed in " + SYS[sys].n + ".");
    else if (!SYS[sys].core && !s.baseRevealed) {
      if (s.know.cleared.indexOf(sys) < 0) log(g, "D", "search", "Dominion troops search " + SYS[sys].n + ": no base there.", { sys: sys });
      clearSystem(g, sys);
    }
  }

  function revealBase(g, why) {
    var s = g.s;
    s.baseRevealed = true;
    s.u[s.base].Is += s.baseBox.s; s.u[s.base].It += s.baseBox.t;
    var bx = unitStr(s.baseBox.s, s.baseBox.t);
    s.baseBox = { s: 0, t: 0 };
    s.leaders.forEach(function (L) { if (L.side === "I" && L.loc === "base") L.loc = s.base; });
    log(g, "I", "reveal", why + " The Insurgent base is revealed in " + SYS[s.base].n + " (" + bx + " there).", { sys: s.base });
  }

  function unitStr(sh, tr) {
    var p = [];
    if (sh) p.push(sh + " ship" + (sh === 1 ? "" : "s"));
    if (tr) p.push(tr + " troop" + (tr === 1 ? "" : "s"));
    return p.length ? p.join(" + ") : "nothing";
  }

  // ---------------------------------------------------------------- battle
  function leaderTac(g, side, sys, activator) {
    var best = 0;
    g.s.leaders.forEach(function (L) { if (L.side === side && L.status === "placed" && L.loc === sys) best = Math.max(best, L.tac); });
    if (activator && activator.side === side) best = Math.max(best, activator.tac);
    return best;
  }
  // Pure battle simulator (used by the engine and by bots for estimates).
  // a, b: {s, t}; returns survivors and kills. bonusA/B: extra dice per round. hitA/B: threshold.
  function simBattle(a, b, bonusA, bonusB, hitA, hitB, r) {
    a = { s: a.s, t: a.t }; b = { s: b.s, t: b.t };
    var killedA = { s: 0, t: 0 }, killedB = { s: 0, t: 0 }, rounds = 0, rolls = [];
    function contested() { return (a.s > 0 && b.s > 0) || (a.t > 0 && b.t > 0); }
    while (contested() && rounds < 12) {
      rounds++;
      var space = a.s > 0 && b.s > 0, ground = a.t > 0 && b.t > 0;
      // bonus dice go where the fight is on the ground first (that is where systems are won)
      var aS = space ? a.s : 0, aG = ground ? a.t : 0, bS = space ? b.s : 0, bG = ground ? b.t : 0;
      if (ground) { aG += bonusA; bG += bonusB; } else { aS += bonusA; bS += bonusB; }
      var hAS = 0, hAG = 0, hBS = 0, hBG = 0, k;
      for (k = 0; k < aS; k++) if (d6(r) >= CFG.hitOn) hAS++;
      for (k = 0; k < aG; k++) if (d6(r) >= hitA) hAG++;
      for (k = 0; k < bS; k++) if (d6(r) >= CFG.hitOn) hBS++;
      for (k = 0; k < bG; k++) if (d6(r) >= hitB) hBG++;
      var dbs = Math.min(b.s, hAS), dbt = Math.min(b.t, hAG), das = Math.min(a.s, hBS), dat = Math.min(a.t, hBG);
      b.s -= dbs; b.t -= dbt; a.s -= das; a.t -= dat;
      killedB.s += dbs; killedB.t += dbt; killedA.s += das; killedA.t += dat;
      rolls.push({ aHits: hAS + hAG, bHits: hBS + hBG });
    }
    return { a: a, b: b, killedA: killedA, killedB: killedB, rounds: rounds, rolls: rolls };
  }

  function battle(g, sys, attacker, activatorLeader) {
    var s = g.s, u = s.u[sys];
    var I = { s: u.Is, t: u.It }, D = { s: u.Ds, t: u.Dt };
    var atBase = s.baseRevealed && sys === s.base;
    var bonusI = leaderTac(g, "I", sys, activatorLeader), bonusD = leaderTac(g, "D", sys, activatorLeader);
    var res = simBattle(I, D, bonusI, bonusD, atBase ? CFG.baseHitOn : CFG.hitOn, CFG.hitOn, g.r);
    u.Is = res.a.s; u.It = res.a.t; u.Ds = res.b.s; u.Dt = res.b.t;
    s.flags.domShipsLost += res.killedB.s;
    s.flags.maxTroopKill = Math.max(s.flags.maxTroopKill, res.killedB.t);
    var iLeft = u.Is + u.It, dLeft = u.Ds + u.Dt, winner = null;
    if (iLeft > 0 && dLeft === 0) winner = "I"; else if (dLeft > 0 && iLeft === 0) winner = "D";
    var txt = "Battle at " + SYS[sys].n + " (" + res.rounds + " round" + (res.rounds === 1 ? "" : "s") + "). Insurgents lose " + unitStr(res.killedA.s, res.killedA.t) +
      ", Dominion loses " + unitStr(res.killedB.s, res.killedB.t) + ". " +
      (winner ? sideName(winner) + " win." : "Both sides still hold units there.");
    if (winner === "I") { s.flags.iWins++; if (SYS[sys].core) s.flags.coreWin = true; }
    s.lastBattle = { sys: sys, attacker: attacker, I0: I, D0: D, res: res, winner: winner, bonusI: bonusI, bonusD: bonusD, atBase: atBase };
    log(g, attacker, "battle", txt, s.lastBattle);
    // leaders with no units left in a lost battle stay put; they are now exposed to Hunt if Dominion units remain
  }

  function updateControl(g, sys, actor) {
    var s = g.s, u = s.u[sys];
    if (!SYS[sys].p) return;
    if (u.Dt > 0 && u.It === 0 && s.loy[sys] !== "D") {
      var was = s.loy[sys];
      s.loy[sys] = "D";
      log(g, "D", "control", SYS[sys].n + " is now under Dominion control" + (was === "I" ? " (the Insurgents lose a loyal system)." : "."), { sys: sys });
      if (sys === s.base && !s.baseRevealed) revealBase(g, "Dominion control of " + SYS[sys].n + " exposes it.");
    } else if (u.It > 0 && u.Dt === 0 && s.loy[sys] === "D" && actor === "I") {
      s.loy[sys] = null; s.sab[sys] = false;
      s.flags.liberated = true;
      log(g, "I", "control", "Insurgent troops retake " + SYS[sys].n + ". It is no longer Dominion-loyal.", { sys: sys });
    }
  }

  function checkBaseWin(g) {
    var s = g.s;
    if (!s.baseRevealed || s.winner) return;
    var u = s.u[s.base];
    if (u.Dt > 0 && u.It === 0) {
      s.winner = "D"; s.phase = "over";
      s.winReason = "Dominion troops hold " + SYS[s.base].n + ". The Insurgent base has fallen.";
      log(g, "D", "win", s.winReason);
    }
  }

  // ---------------------------------------------------------------- missions
  function revealMission(g, side, leaderId, target) {
    var s = g.s; assertTurn(g, side);
    var L = leader(g, leaderId);
    if (!L || L.side !== side || L.status !== "mission") throw new Error("leader not on a mission");
    var type = L.mission, M = MISSIONS[type];
    var targets = missionTargets(g, side, type, leaderId);
    var sys, huntLeader = null;
    if (type === "hunt") {
      var t = targets.filter(function (x) { return x.leader === target; })[0];
      if (!t) throw new Error("no such hunt target");
      sys = t.sys; huntLeader = t.leader;
    } else {
      if (targets.indexOf(target) < 0) throw new Error("invalid target for " + M.name);
      sys = target;
    }
    if (type === "relocate" && L.int < 2) throw new Error("Relocate needs intrigue 2+");
    L.status = "placed"; L.loc = type === "relocate" ? "base" : sys; L.mission = null;
    var tName = type === "hunt" ? leader(g, huntLeader).name + " in " + SYS[sys].n : (type === "relocate" ? "a new location" : SYS[sys].n);
    log(g, side, "mission", L.name + " reveals " + M.name + (type === "relocate" ? "." : " targeting " + tName + "."), { leader: L.id, type: type, sys: type === "relocate" ? null : sys });
    var pend = { side: side, leader: L.id, type: type, sys: sys, huntLeader: huntLeader };
    if (M.opp && leadersOf(g, other(side), "pool").length > 0) {
      s.pending = pend;   // the other side must now call oppose()
      return pend;
    }
    resolveMission(g, pend, null);
    return null;
  }

  function oppose(g, side, leaderId) {
    var s = g.s, p = s.pending;
    if (!p) throw new Error("nothing to oppose");
    if (side !== other(p.side)) throw new Error("wrong side");
    var O = null;
    if (leaderId) {
      O = leader(g, leaderId);
      if (!O || O.side !== side || O.status !== "pool") throw new Error("opposer not in pool");
      O.status = "placed"; O.loc = p.sys;
    }
    s.pending = null;
    resolveMission(g, p, O);
  }

  // probability that `a` dice beat `b` dice (opposer wins ties)
  function missionOdds(a, b) {
    var p = 0;
    for (var i = 0; i <= a; i++) for (var j = 0; j <= b; j++) if (i > j) p += binom(a, i) * binom(b, j);
    return p / Math.pow(2, a + b);
  }
  function binom(n, k) { var r = 1; for (var i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }

  function resolveMission(g, p, O) {
    var s = g.s, L = leader(g, p.leader), ok = true, detail = "";
    if (O) {
      var a = 0, b = 0, k;
      for (k = 0; k < L.int; k++) if (d6(g.r) >= CFG.hitOn) a++;
      for (k = 0; k < O.int; k++) if (d6(g.r) >= CFG.hitOn) b++;
      ok = a > b;
      detail = O.name + " opposes. " + L.name + " rolls " + a + " success" + (a === 1 ? "" : "es") + " on " + L.int + " dice, " + O.name + " rolls " + b + " on " + O.int + ". " + (ok ? "The mission succeeds." : "The mission fails (the opposer wins ties).");
      log(g, O.side, "oppose", detail, { opposer: O.id, leader: L.id, a: a, b: b, ok: ok, sys: p.sys });
    } else if (MISSIONS[p.type].opp) {
      log(g, p.side, "mission", "Unopposed: " + MISSIONS[p.type].name + " succeeds automatically.", { type: p.type });
    }
    if (ok) applyMission(g, p);
    if (ok && p.side === "I" && SYS[p.sys] && SYS[p.sys].core && p.type !== "relocate") s.flags.coreMission = true;
    checkBaseWin(g);
    if (!s.winner) endAction(g, p.side);
  }

  function applyMission(g, p) {
    var s = g.s, sys = p.sys;
    if (p.type === "sway") {
      var before = s.loy[sys];
      s.loy[sys] = before === "D" ? null : "I";
      if (before === "D") s.sab[sys] = false;
      log(g, "I", "loyalty", SYS[sys].n + (before === "D" ? " breaks from the Dominion (now neutral)." : " becomes loyal to the Insurgents."), { sys: sys });
    } else if (p.type === "sabotage") {
      s.sab[sys] = true;
      log(g, "I", "sabotage", SYS[sys].n + " is sabotaged: no Dominion production there until they activate it.", { sys: sys });
    } else if (p.type === "relocate") {
      relocateBase(g, p.sys);
    } else if (p.type === "probe") {
      drawProbes(g, CFG.probeMissionDraw, "Probe mission");
    } else if (p.type === "decree") {
      var b = s.loy[sys];
      s.loy[sys] = b === "I" ? null : "D";
      log(g, "D", "loyalty", SYS[sys].n + (b === "I" ? " drops its Insurgent loyalty (now neutral)." : " declares for the Dominion."), { sys: sys });
      if (s.loy[sys] === "D") {
        if (sys === s.base && !s.baseRevealed) revealBase(g, "Dominion loyalty in " + SYS[sys].n + " exposes it.");
        else if (!s.baseRevealed) clearSystem(g, sys);
      }
    } else if (p.type === "hunt") {
      var T = leader(g, p.huntLeader);
      T.status = "captured"; T.loc = null; T.capturedFor = CFG.captureRounds;
      log(g, "D", "capture", T.name + " is captured and will miss the next " + CFG.captureRounds + " rounds.", { leader: T.id });
    }
  }

  function relocateBase(g, target) {
    var s = g.s, old = s.base;
    if (s.probeDeck.indexOf(target) < 0 || s.u[target].Ds + s.u[target].Dt > 0) throw new Error("bad relocation target");
    if (!s.baseRevealed) {
      s.u[old].Is += s.baseBox.s; s.u[old].It += s.baseBox.t;
      log(g, "I", "relocate", "The base relocates. Its old site, " + SYS[old].n + ", is exposed" + (s.baseBox.s + s.baseBox.t ? " and " + unitStr(s.baseBox.s, s.baseBox.t) + (s.baseBox.s + s.baseBox.t === 1 ? " is" : " are") + " left there." : ".") , { old: old });
    } else {
      log(g, "I", "relocate", "The base escapes " + SYS[old].n + " to a new hidden location.", { old: old });
    }
    s.baseBox = { s: 0, t: 0 };
    s.probeDeck.splice(s.probeDeck.indexOf(target), 1);
    s.probeHand.push(old);
    s.base = target; s.baseRevealed = false; s.relocations++;
    s.baseHistory.push({ round: s.round, sys: target });
    // what the hunter now knows: base is in a system whose probe card is still in the deck and had no Dominion units
    var excl = [];
    for (var i = 0; i < N; i++) if (!SYS[i].core && (s.u[i].Ds + s.u[i].Dt > 0)) excl.push(i);
    s.know = { cleared: [], leaks: [], excluded: excl };
  }

  function drawProbes(g, n, why) {
    var s = g.s, got = [];
    for (var i = 0; i < n && s.probeDeck.length; i++) { var c = s.probeDeck.shift(); s.probeHand.push(c); got.push(c); }
    if (got.length) log(g, "D", "probe", why + ": probe cards show no base in " + got.map(function (c) { return SYS[c].n; }).join(" and ") + ".", { cards: got });
    return got;
  }

  function pass(g, side) {
    var s = g.s; assertTurn(g, side);
    log(g, side, "pass", sideName(side) + " pass.");
    s.passes++;
    nextTurn(g);
  }

  function endAction(g, side) {
    g.s.passes = 0;
    nextTurn(g);
  }
  function nextTurn(g) {
    var s = g.s;
    if (s.winner || s.phase !== "command") return;
    if (s.passes >= 2) { endCommand(g); return; }
    var o = other(s.turn);
    if (canAct(g, o)) { s.turn = o; return; }
    // the other side has nothing left: the current side keeps going (the "last word") unless it just passed
    if (s.passes >= 1 || !canAct(g, s.turn)) endCommand(g);
  }
  // At the start of the phase, skip a side that has nothing to do.
  function autoPass(g) {
    var s = g.s;
    if (s.phase !== "command" || s.pending) return;
    if (!canAct(g, "I") && !canAct(g, "D")) { endCommand(g); return; }
    if (!canAct(g, s.turn)) s.turn = other(s.turn);
  }

  // ---------------------------------------------------------------- refresh
  function endCommand(g) {
    var s = g.s;
    // unrevealed missions are wasted
    s.leaders.forEach(function (L) { if (L.status === "mission") { log(g, L.side, "waste", L.name + "'s mission was never revealed and is wasted."); L.status = "pool"; L.mission = null; } });
    s.phase = "refresh";
    refresh(g);
  }

  function refresh(g) {
    var s = g.s;
    log(g, null, "phase", "Refresh, end of round " + s.round + ".");
    // 1. objectives
    var keep = [], done = 0;
    s.objHand.slice().sort(function (a, b) { return OBJ[b].val - OBJ[a].val; }).forEach(function (id) {
      var o = OBJ[id];
      if (done < CFG.objPerRound && o.test(s)) {
        done++;
        s.rep -= o.val; s.objScored.push(id);
        log(g, "I", "objective", "Insurgents complete “" + o.name + "” (" + o.text + ") Reputation moves " + o.val + " closer: now " + s.rep + ".", { id: id });
      } else keep.push(id);
    });
    s.objHand = keep;
    if (s.rep <= s.time) return insurgentWin(g);
    // 2. probes
    drawProbes(g, CFG.probesPerRound, "Probe droids");
    // 3. production
    produce(g);
    // 4. leaders
    s.leaders.forEach(function (L) {
      if (L.status === "placed") { L.status = "pool"; L.loc = null; }
      if (L.status === "captured") { L.capturedFor--; if (L.capturedFor <= 0) { L.status = "pool"; log(g, L.side, "capture", L.name + " escapes captivity and rejoins the Insurgents."); } }
    });
    // 5. time
    s.round++; s.time++;
    s.leaders.forEach(function (L) { if (L.status === "future" && L.from <= s.round) { L.status = "pool"; log(g, L.side, "recruit", sideName(L.side) + " recruit " + L.name + " (intrigue " + L.int + ", tactics " + L.tac + ")."); } });
    if (s.rep <= s.time) return insurgentWin(g);
    // 6. objective draw
    if (s.objDeck.length) s.objHand.push(s.objDeck.shift());
    s.flags = freshFlags();
    s.phase = "assign"; s.turn = "I"; s.passes = 0;
    log(g, null, "phase", "Round " + s.round + ". Time " + s.time + ", reputation " + s.rep + ": the Dominion has " + (s.rep - s.time) + " round" + (s.rep - s.time === 1 ? "" : "s") + " left.");
  }

  function produce(g) {
    var s = g.s, dom = [], ins = [];
    for (var i = 0; i < N; i++) {
      var u = s.u[i];
      if (s.loy[i] === "D" && !s.sab[i] && u.It === 0) {
        if (u.Dt >= u.Ds * CFG.carry) u.Ds++; else u.Dt++;
        if (SYS[i].throne) u.Ds++;
        dom.push(SYS[i].n);
      } else if (s.loy[i] === "I" && u.Dt === 0) {
        if (u.It >= u.Is * CFG.carry) u.Is++; else u.It++;
        ins.push(SYS[i].n);
      }
    }
    if (s.base != null && !s.baseRevealed) s.baseBox.t++;
    log(g, null, "build", "Production: Dominion builds at " + (dom.join(", ") || "nowhere") + ". Insurgents build at " + (ins.join(", ") || "no loyal system") + (s.baseRevealed ? "." : " and add a troop at the hidden base."));
  }

  function insurgentWin(g) {
    var s = g.s;
    s.winner = "I"; s.phase = "over";
    s.winReason = "Time and reputation meet. The Dominion ran out of time to find the base.";
    log(g, "I", "win", s.winReason);
  }

  // ---------------------------------------------------------------- views
  // Information a side may see. The UI only renders through this so the bot side's secrets stay hidden.
  function view(g, side) {
    var s = g.s;
    return {
      mine: side,
      base: side === "I" || s.baseRevealed || s.phase === "over" ? s.base : null,
      baseBox: side === "I" || s.phase === "over" ? s.baseBox : null,
      objHand: side === "I" || s.phase === "over" ? s.objHand.slice() : s.objHand.length,
      candidates: hunterCandidates(g)
    };
  }

  return {
    CFG: CFG, SYS: SYS, IDX: IDX, DIST: DIST, CORE: CORE, NONCORE: NONCORE, CORE_DIST: CORE_DIST,
    LEADERS: LEADERS, MISSIONS: MISSIONS, OBJECTIVES: OBJECTIVES, OBJ: OBJ,
    newGame: newGame, restore: restore, makeRng: makeRng, shuffle: shuffle,
    validBaseSites: validBaseSites, placeBase: placeBase,
    hunterCandidates: hunterCandidates, ruledOutReason: ruledOutReason,
    missionTypes: missionTypes, submitAssignment: submitAssignment, validateAssignment: validateAssignment,
    origins: origins, activatable: activatable, canEnterBaseBox: canEnterBaseBox, missionTargets: missionTargets,
    activate: activate, reinforceBase: reinforceBase, revealMission: revealMission, oppose: oppose, pass: pass,
    canAct: canAct, missionOdds: missionOdds, simBattle: simBattle, leaderTac: leaderTac,
    leader: leader, leadersOf: leadersOf, hasLeaderAt: hasLeaderAt, unitsAt: unitsAt, anyUnits: anyUnits,
    countLoyal: countLoyal, countSab: countSab, other: other, sideName: sideName, unitStr: unitStr,
    drainEvents: drainEvents, view: view
  };
});
