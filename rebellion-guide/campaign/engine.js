/* Campaign: rules engine for the full-scale sparring game of the Rebellion Field Manual.
 *
 * An original two-player game in the hidden-base genre, built to practise the decisions of
 * Star Wars: Rebellion at full scale. Map, names, units, missions, tactic cards and objectives are
 * invented; the rule structures (time/reputation clock, leaders as actions, skill-matched mission
 * cards, opposed missions, pinning, probe deck, build queue, space and ground combat with tactic
 * cards and retreat, captives, staged objectives, relocation, a superweapon) follow the same ideas.
 *
 * Sides: "I" = Insurgents (hide the base, run the clock)   "D" = Dominion (hunt the base)
 * Works in the browser (window.Campaign) and Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Campaign = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CFG = {
    startRep: 14, probesPerRound: 2, objPerRound: 1, missionDraw: 2, deckHandLimit: 6,
    hitOn: 4, recruitRounds: [3, 6, 9], maxTactics: 3, superDelay: 2
  };

  // ------------------------------------------------------------------ map
  // icons: "s" = shipyard (space build point), "g" = barracks (ground build point). No icons = remote.
  var REGIONS = ["Throne Reach", "Iron Marches", "Ember Belt", "Veil", "Drift", "Hollow Rim", "Shard Cluster", "Outer Tides", "Far Shoals"];
  var SYS = [
    { n: "Valcor",  r: 0, x: 110,  y: 390, ic: "sg", throne: 1, home: 1 },
    { n: "Tessir",  r: 0, x: 215,  y: 275, ic: "s", home: 1 },
    { n: "Iberon",  r: 0, x: 225,  y: 505, ic: "g", home: 1 },
    { n: "Cassad",  r: 0, x: 330,  y: 390, ic: "sg", home: 1 },
    { n: "Gryss",   r: 1, x: 200,  y: 105, ic: "" },
    { n: "Durn",    r: 1, x: 340,  y: 135, ic: "gg" },
    { n: "Felmar",  r: 1, x: 455,  y: 220, ic: "s" },
    { n: "Delve",   r: 2, x: 95,   y: 600, ic: "" },
    { n: "Jessa",   r: 2, x: 215,  y: 690, ic: "" },
    { n: "Hesk",    r: 2, x: 345,  y: 650, ic: "g" },
    { n: "Idrith",  r: 2, x: 470,  y: 575, ic: "s" },
    { n: "Maelis",  r: 3, x: 470,  y: 395, ic: "g" },
    { n: "Korvan",  r: 3, x: 595,  y: 300, ic: "sg" },
    { n: "Lyrr",    r: 3, x: 610,  y: 480, ic: "" },
    { n: "Nythe",   r: 4, x: 600,  y: 110, ic: "g" },
    { n: "Ostra",   r: 4, x: 725,  y: 195, ic: "s" },
    { n: "Pellam",  r: 4, x: 830,  y: 85,  ic: "" },
    { n: "Quorn",   r: 5, x: 600,  y: 655, ic: "g" },
    { n: "Rask",    r: 5, x: 735,  y: 575, ic: "s" },
    { n: "Sundra",  r: 5, x: 840,  y: 690, ic: "" },
    { n: "Teva",    r: 6, x: 765,  y: 385, ic: "sg" },
    { n: "Ulmar",   r: 6, x: 885,  y: 290, ic: "g" },
    { n: "Vey",     r: 6, x: 885,  y: 475, ic: "" },
    { n: "Wrenn",   r: 7, x: 1005, y: 185, ic: "s" },
    { n: "Corsa",   r: 7, x: 965,  y: 70,  ic: "" },
    { n: "Arbos",   r: 7, x: 1115, y: 285, ic: "g" },
    { n: "Yarrow",  r: 7, x: 1010, y: 385, ic: "" },
    { n: "Zell",    r: 8, x: 1000, y: 590, ic: "s" },
    { n: "Brine",   r: 8, x: 1115, y: 495, ic: "g" },
    { n: "Embra",   r: 8, x: 1110, y: 690, ic: "" }
  ];
  var EDGES = [
    "Valcor-Tessir", "Valcor-Iberon", "Valcor-Cassad", "Valcor-Delve", "Tessir-Cassad", "Tessir-Gryss", "Tessir-Durn",
    "Iberon-Cassad", "Iberon-Delve", "Iberon-Jessa", "Iberon-Hesk", "Cassad-Maelis", "Cassad-Felmar", "Gryss-Durn",
    "Durn-Felmar", "Durn-Nythe", "Felmar-Korvan", "Felmar-Nythe", "Felmar-Maelis", "Delve-Jessa", "Jessa-Hesk",
    "Hesk-Idrith", "Hesk-Quorn", "Idrith-Maelis", "Idrith-Lyrr", "Idrith-Quorn", "Maelis-Korvan", "Maelis-Lyrr",
    "Korvan-Ostra", "Korvan-Teva", "Korvan-Lyrr", "Lyrr-Rask", "Lyrr-Teva", "Nythe-Ostra", "Nythe-Pellam",
    "Ostra-Pellam", "Ostra-Ulmar", "Ostra-Teva", "Pellam-Corsa", "Quorn-Rask", "Quorn-Sundra", "Rask-Vey",
    "Rask-Sundra", "Sundra-Zell", "Teva-Ulmar", "Teva-Vey", "Ulmar-Wrenn", "Ulmar-Yarrow", "Ulmar-Vey",
    "Vey-Yarrow", "Vey-Zell", "Wrenn-Corsa", "Wrenn-Arbos", "Arbos-Yarrow", "Yarrow-Brine", "Zell-Brine",
    "Zell-Embra", "Brine-Embra"
  ];
  var N = SYS.length, IDX = {};
  SYS.forEach(function (s, i) { s.id = i; s.adj = []; s.p = s.ic.length > 0; IDX[s.n] = i; });
  EDGES.forEach(function (e) { var ab = e.split("-"), a = IDX[ab[0]], b = IDX[ab[1]]; SYS[a].adj.push(b); SYS[b].adj.push(a); });
  var DIST = [];
  for (var i0 = 0; i0 < N; i0++) {
    var d = new Array(N).fill(99); d[i0] = 0; var q = [i0];
    while (q.length) { var u0 = q.shift(); SYS[u0].adj.forEach(function (v) { if (d[v] > d[u0] + 1) { d[v] = d[u0] + 1; q.push(v); } }); }
    DIST.push(d);
  }
  var THRONE = IDX.Valcor;
  var HOME = SYS.filter(function (s) { return s.home; }).map(function (s) { return s.id; });
  var NONHOME = SYS.filter(function (s) { return !s.home; }).map(function (s) { return s.id; });
  var HOME_DIST = SYS.map(function (s) { return Math.min.apply(null, HOME.map(function (c) { return DIST[c][s.id]; })); });

  // ------------------------------------------------------------------ units
  // L / H: light and heavy attack dice. cap: carrying capacity (capital ships). carry: needs capacity to move.
  var UNITS = {
    fighter:     { side: "D", name: "Fighter",     dom: "space",  heavy: 0, hp: 1, L: 1, H: 0, cap: 0, carry: 1, cost: 1, delay: 0 },
    carrier:     { side: "D", name: "Carrier",     dom: "space",  heavy: 1, hp: 2, L: 1, H: 0, cap: 4, carry: 0, cost: 2, delay: 1 },
    destroyer:   { side: "D", name: "Destroyer",   dom: "space",  heavy: 1, hp: 3, L: 1, H: 2, cap: 2, carry: 0, cost: 3, delay: 2 },
    superweapon: { side: "D", name: "Superweapon", dom: "space",  heavy: 1, hp: 3, L: 0, H: 4, cap: 0, carry: 0, cost: 0, delay: 3, special: 1 },
    trooper:     { side: "D", name: "Trooper",     dom: "ground", heavy: 0, hp: 1, L: 1, H: 0, cap: 0, carry: 1, cost: 1, delay: 0 },
    walker:      { side: "D", name: "Walker",      dom: "ground", heavy: 1, hp: 3, L: 1, H: 1, cap: 0, carry: 1, cost: 2, delay: 1 },
    interceptor: { side: "I", name: "Interceptor", dom: "space",  heavy: 0, hp: 1, L: 1, H: 0, cap: 0, carry: 1, cost: 1, delay: 0 },
    bomber:      { side: "I", name: "Bomber",      dom: "space",  heavy: 0, hp: 1, L: 0, H: 1, cap: 0, carry: 1, cost: 1, delay: 0 },
    transport:   { side: "I", name: "Transport",   dom: "space",  heavy: 1, hp: 1, L: 0, H: 0, cap: 3, carry: 0, cost: 1, delay: 0 },
    corvette:    { side: "I", name: "Corvette",    dom: "space",  heavy: 1, hp: 2, L: 2, H: 0, cap: 1, carry: 0, cost: 2, delay: 1 },
    cruiser:     { side: "I", name: "Cruiser",     dom: "space",  heavy: 1, hp: 4, L: 1, H: 2, cap: 2, carry: 0, cost: 3, delay: 2 },
    infantry:    { side: "I", name: "Infantry",    dom: "ground", heavy: 0, hp: 1, L: 1, H: 0, cap: 0, carry: 1, cost: 1, delay: 0 },
    skimmer:     { side: "I", name: "Skimmer",     dom: "ground", heavy: 0, hp: 1, L: 0, H: 1, cap: 0, carry: 1, cost: 1, delay: 0 }
  };
  var TYPES = { I: [], D: [] };
  Object.keys(UNITS).forEach(function (k) { UNITS[k].id = k; TYPES[UNITS[k].side].push(k); });
  var BUILDABLE = { I: TYPES.I.slice(), D: TYPES.D.filter(function (k) { return !UNITS[k].special; }) };

  // ------------------------------------------------------------------ leaders
  // skills: inf = influence, int = intel, ops = operations, log = logistics. sp / gr = space / ground tactics.
  function Ld(id, side, name, sk, sp, gr) { return { id: id, side: side, name: name, inf: sk.inf || 0, int: sk.int || 0, ops: sk.ops || 0, log: sk.log || 0, sp: sp, gr: gr }; }
  var LEADERS = [
    Ld("i1", "I", "Sera Vane",    { inf: 2, int: 1 }, 0, 1),
    Ld("i2", "I", "Odo Brask",    { ops: 2 }, 1, 2),
    Ld("i3", "I", "Lin Tarro",    { log: 2, int: 1 }, 2, 0),
    Ld("i4", "I", "Kade Morrow",  { inf: 1, ops: 1 }, 1, 1),
    Ld("d1", "D", "Marshal Dekk", { ops: 1, log: 1 }, 2, 2),
    Ld("d2", "D", "Adjutant Vos", { int: 2, inf: 1 }, 0, 1),
    Ld("d3", "D", "Prefect Halm", { inf: 2, log: 1 }, 1, 0),
    Ld("d4", "D", "Commander Ixa",{ ops: 2 }, 1, 2)
  ];
  var RESERVE = [
    Ld("i5", "I", "Mira Quell",   { int: 2, log: 1 }, 0, 1),
    Ld("i6", "I", "Tobin Reyes",  { ops: 2, inf: 1 }, 0, 2),
    Ld("i7", "I", "Ana Solberg",  { log: 1, inf: 1 }, 2, 1),
    Ld("i8", "I", "Vesh Kaal",    { int: 1, ops: 1 }, 2, 0),
    Ld("i9", "I", "Rho Delaine",  { inf: 2 }, 1, 1),
    Ld("d5", "D", "Captain Rusk", { log: 2 }, 2, 1),
    Ld("d6", "D", "Agent Thale",  { int: 2, ops: 1 }, 0, 1),
    Ld("d7", "D", "Overseer Marn",{ inf: 1, int: 1 }, 1, 1),
    Ld("d8", "D", "Admiral Sorrow",{ log: 1 }, 3, 0),
    Ld("d9", "D", "General Brannt",{ ops: 1 }, 0, 3)
  ];
  var SKILLS = { inf: "Influence", int: "Intel", ops: "Operations", log: "Logistics" };

  // ------------------------------------------------------------------ missions
  // standing: returns to hand after use. opp: can be opposed. need: skill icons required among assigned leaders.
  var MISSIONS = {
    rally:    { side: "I", name: "Rally",            skill: "inf", need: 1, opp: true,  standing: true, text: "A populous system with no Dominion ground units moves one step toward Insurgent loyalty." },
    sabotage: { side: "I", name: "Sabotage",         skill: "ops", need: 1, opp: true,  standing: true, text: "A Dominion-loyal system cannot build or deploy until the Dominion activates it." },
    redeploy: { side: "I", name: "Redeploy Base",    skill: "log", need: 2, opp: false, standing: true, text: "Move the base to a system whose probe card is still in the deck and holds no Dominion units. Units in the old base stay behind, exposed. Not possible the round after a relocation." },
    gather:   { side: "I", name: "Gather Intel",     skill: "int", need: 1, opp: false, standing: true, text: "Draw an extra objective card." },
    uprising: { side: "I", name: "Uprising",         skill: "inf", need: 1, opp: true,  copies: 2, text: "A Dominion-loyal system with no Dominion ground units becomes Insurgent-loyal and raises 1 infantry." },
    plans:    { side: "I", name: "Steal the Plans",  skill: "int", need: 2, opp: true,  copies: 1, text: "Target the throne system once the superweapon project has begun. Gain the plans: the superweapon can then be damaged." },
    breakout: { side: "I", name: "Breakout",         skill: "ops", need: 1, opp: true,  copies: 2, text: "Target the throne system. Free every captured Insurgent leader." },
    ally:     { side: "I", name: "Recruit Ally",     skill: "inf", need: 1, opp: false, copies: 1, text: "Target a loyal system. A new leader joins you next round." },
    decoy:    { side: "I", name: "Decoy Signal",     skill: "int", need: 1, opp: true,  copies: 2, text: "Target a system with your units. The Dominion draws no probe cards this Refresh." },
    supply:   { side: "I", name: "Strike Supply",    skill: "ops", need: 1, opp: true,  copies: 2, text: "Target a Dominion build site. Destroy every Dominion unit in the build queue there." },
    cache:    { side: "I", name: "Hidden Cache",     skill: "log", need: 1, opp: false, copies: 2, text: "Two infantry arrive at the hidden base now." },
    inspire:  { side: "I", name: "Inspire",          skill: "inf", need: 2, opp: true,  copies: 1, text: "Target a loyal system with your units. Reputation moves 1 toward time." },
    probe:    { side: "D", name: "Probe Sweep",      skill: "int", need: 1, opp: true,  standing: true, text: "Target a system with Dominion units. Draw 2 probe cards." },
    decree:   { side: "D", name: "Decree",           skill: "inf", need: 1, opp: true,  standing: true, text: "A populous system next to or holding Dominion units, with no Insurgent ground units, moves one step toward Dominion loyalty. Dominion loyalty in the base system reveals it." },
    seize:    { side: "D", name: "Seize",            skill: "ops", need: 1, opp: true,  standing: true, text: "Capture an Insurgent leader standing in a system with Dominion units. Captives are held at the throne." },
    project:  { side: "D", name: "Superweapon Project", skill: "log", need: 1, opp: true, standing: true, once: true, text: "Target the throne. The superweapon enters the build queue and arrives in 2 rounds." },
    interrogate: { side: "D", name: "Interrogate",   skill: "int", need: 1, opp: true,  copies: 2, text: "Target the throne while you hold a captive. Draw 3 probe cards." },
    conscript:{ side: "D", name: "Conscript",        skill: "log", need: 1, opp: false, copies: 2, text: "Target a Dominion barracks system. Two troopers appear there now." },
    crackdown:{ side: "D", name: "Crackdown",        skill: "inf", need: 1, opp: true,  copies: 2, text: "An Insurgent-loyal system next to Dominion ground units becomes neutral." },
    scan:     { side: "D", name: "Regional Scan",    skill: "int", need: 2, opp: true,  copies: 2, text: "Target a system. The Insurgents must say whether their base is in that system's region." },
    rapid:    { side: "D", name: "Rapid Deployment", skill: "log", need: 1, opp: false, copies: 2, text: "Deploy every Dominion unit in the build queue now." },
    annihilate:{ side: "D", name: "Fire Superweapon", skill: "ops", need: 1, opp: true, standing: true, granted: true, text: "Target a system holding the superweapon, outside the Throne Reach. Everything there except the superweapon is destroyed and the system is ruined. A hidden base there survives behind its shields, but is revealed." }
  };

  // ------------------------------------------------------------------ tactic cards
  var TACTICS = {
    space:  [["focus", "Focus Fire", "+2 heavy dice this round.", 3], ["strafe", "Strafing Run", "+2 light dice this round.", 3], ["evade", "Evasive Maneuvers", "Cancel 2 hits against you this round.", 3], ["regroup", "Regroup", "You may retreat after this round even without a leader.", 2], ["combined", "Combined Strike", "+1 light and +1 heavy die this round.", 1]],
    ground: [["barrage", "Barrage", "+2 heavy dice this round.", 2], ["charge", "Charge", "+2 light dice this round.", 3], ["entrench", "Entrench", "Cancel 2 hits against you this round.", 3], ["fallback", "Fall Back", "You may retreat after this round even without a leader.", 2], ["holdfast", "Hold Fast", "Your light dice hit on 3+ this round.", 2]]
  };
  var TAC = {};
  ["space", "ground"].forEach(function (dom) { TACTICS[dom].forEach(function (t) { TAC[t[0]] = { id: t[0], name: t[1], text: t[2], dom: dom }; }); });

  // ------------------------------------------------------------------ objectives
  var OBJECTIVES = [
    { id: "spark",  stage: 1, val: 1, name: "Spark of Defiance", text: "Hold 6 loyal systems.", test: function (s) { return countLoyal(s, "I") >= 6; } },
    { id: "hitrun", stage: 1, val: 1, name: "Hit and Run",       text: "Win a battle that destroys at least 2 Dominion units this round.", test: function (s) { return s.flags.bigWin; } },
    { id: "lines",  stage: 1, val: 1, name: "Cut the Lines",     text: "Have 3 Dominion systems sabotaged at once.", test: function (s) { return countSab(s) >= 3; } },
    { id: "raid",   stage: 1, val: 1, name: "Supply Raid",       text: "Destroy 4 or more Dominion units in one battle this round.", test: function (s) { return s.flags.maxKill >= 4; } },
    { id: "uprise", stage: 2, val: 1, name: "Uprising",          text: "Hold 8 loyal systems.", test: function (s) { return countLoyal(s, "I") >= 8; } },
    { id: "ambush", stage: 2, val: 1, name: "Ambush",            text: "Destroy a Dominion capital ship this round.", test: function (s) { return s.flags.capKills >= 1; } },
    { id: "liberty",stage: 2, val: 1, name: "Liberation",        text: "Retake a Dominion-loyal system with your ground units this round.", test: function (s) { return s.flags.liberated; } },
    { id: "intel",  stage: 2, val: 1, name: "Stolen Secrets",    text: "Hold the superweapon plans.", test: function (s) { return s.plans; } },
    { id: "core",   stage: 3, val: 2, name: "Strike the Throne", text: "Win a battle in a Throne Reach system this round.", test: function (s) { return s.flags.coreWin; } },
    { id: "superkill", stage: 3, val: 2, name: "Bring It Down",  text: "Destroy the superweapon.", test: function (s) { return s.superDead; } },
    { id: "wide",   stage: 3, val: 2, name: "Galaxy Aflame",     text: "Hold 10 loyal systems.", test: function (s) { return countLoyal(s, "I") >= 10; } },
    { id: "rout",   stage: 3, val: 2, name: "Rout the Fleet",    text: "Destroy 2 Dominion capital ships this round.", test: function (s) { return s.flags.capKills >= 2; } }
  ];
  var OBJ = {}; OBJECTIVES.forEach(function (o) { OBJ[o.id] = o; });
  function countLoyal(s, side) { var c = 0; for (var i = 0; i < N; i++) if (s.loy[i] === side && !s.ruined[i]) c++; return c; }
  function countSab(s) { var c = 0; for (var i = 0; i < N; i++) if (s.sab[i] && s.loy[i] === "D") c++; return c; }

  // ------------------------------------------------------------------ rng
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function stateRng(s) {
    return function () { var a = (s.rs | 0); a = (a + 0x6D2B79F5) | 0; s.rs = a; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffle(arr, r) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  function d6(r) { return 1 + Math.floor(r() * 6); }
  function restore(s) { return { s: s, r: stateRng(s), cfg: CFG }; }

  // ------------------------------------------------------------------ unit helpers
  function emptyStack() { return { I: {}, D: {} }; }
  function cnt(st, t) { return st[t] || 0; }
  function addU(st, t, n) { st[t] = (st[t] || 0) + n; if (st[t] <= 0) delete st[t]; }
  function total(st, pred) { var n = 0; for (var t in st) if (!pred || pred(UNITS[t])) n += st[t]; return n; }
  function stackOf(g, sys, side) { return g.s.u[sys][side]; }
  function anyUnits(g, sys, side) { return total(g.s.u[sys][side]) > 0; }
  function groundAt(g, sys, side) { return total(g.s.u[sys][side], function (U) { return U.dom === "ground"; }); }
  function capOf(st) { var c = 0; for (var t in st) c += UNITS[t].cap * st[t]; return c; }
  function carryOf(st) { var c = 0; for (var t in st) c += UNITS[t].carry * st[t]; return c; }
  function plural(w, n) { return n === 1 || w === "infantry" ? w : w + "s"; }
  function unitList(st) {
    var p = [];
    Object.keys(UNITS).forEach(function (t) { if (st[t]) p.push(st[t] + " " + plural(UNITS[t].name.toLowerCase(), st[t])); });
    return p.length ? p.join(", ") : "nothing";
  }

  // ------------------------------------------------------------------ state
  function newGame(opts) {
    opts = opts || {};
    var seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
    var s = {
      seed: seed, rs: seed >>> 0, round: 1, time: 1, rep: CFG.startRep, phase: "setup", winner: null, winReason: "",
      u: [], loy: new Array(N).fill(null), sab: new Array(N).fill(false), ruined: new Array(N).fill(false),
      base: null, baseRevealed: false, baseBox: {}, relocations: 0, lastReloc: -9, baseHistory: [],
      probeDeck: [], probeHand: [], noProbe: false,
      know: { cleared: [], leaks: [], excluded: [] },
      leaders: [], reserve: [], captives: [],
      hands: { I: [], D: [] }, decks: { I: [], D: [] }, discard: { I: [], D: [] }, uid: 1, usedOnce: {},
      objDeck: [], objHand: [], objScored: [],
      tacDecks: { I: { space: [], ground: [] }, D: { space: [], ground: [] } },
      queue: [], plans: false, superDead: false, superBuilt: false,
      assigned: { I: null, D: null }, builds: { I: null, D: null }, points: null,
      turn: "I", passes: 0, pending: null, battle: null, afterBattle: null,
      flags: freshFlags(), log: [], events: []
    };
    for (var i = 0; i < N; i++) s.u.push(emptyStack());
    var g = restore(s), r = g.r;
    LEADERS.forEach(function (L) { s.leaders.push(newLeader(L)); });
    s.reserve = shuffle(RESERVE.map(function (L) { return L.id; }), r);
    // Dominion start
    HOME.forEach(function (h) { s.loy[h] = "D"; });
    s.loy[IDX.Durn] = "D"; s.loy[IDX.Ostra] = "D"; s.loy[IDX.Rask] = "D";
    function put(name, side, units) { var st = s.u[IDX[name]][side]; for (var t in units) addU(st, t, units[t]); }
    put("Valcor", "D", { destroyer: 2, carrier: 1, fighter: 3, trooper: 4, walker: 1 });
    put("Tessir", "D", { carrier: 1, fighter: 2, trooper: 2 });
    put("Iberon", "D", { destroyer: 1, trooper: 2, walker: 1 });
    put("Cassad", "D", { carrier: 1, fighter: 1, trooper: 3 });
    put("Durn",   "D", { carrier: 1, trooper: 2 });
    put("Ostra",  "D", { destroyer: 1, carrier: 1, fighter: 1, trooper: 3 });
    put("Rask",   "D", { carrier: 1, fighter: 1, trooper: 2 });
    // Insurgent start
    s.loy[IDX.Zell] = "I"; s.loy[IDX.Wrenn] = "I"; s.loy[IDX.Brine] = "I";
    put("Zell", "I", { corvette: 1, transport: 1, interceptor: 1, bomber: 1, infantry: 2 });
    s.baseBox = { transport: 1, interceptor: 1, infantry: 3, skimmer: 1 };
    // decks
    ["I", "D"].forEach(function (side) {
      Object.keys(MISSIONS).forEach(function (k) {
        var M = MISSIONS[k];
        if (M.side !== side || M.granted) return;
        if (M.standing) s.hands[side].push({ uid: s.uid++, id: k });
        else for (var c = 0; c < (M.copies || 1); c++) s.decks[side].push({ uid: s.uid++, id: k });
      });
      shuffle(s.decks[side], r);
      for (var dd = 0; dd < CFG.missionDraw; dd++) drawMission(g, side);
      ["space", "ground"].forEach(function (dom) {
        var deck = [];
        TACTICS[dom].forEach(function (t) { for (var c = 0; c < t[3]; c++) deck.push(t[0]); });
        s.tacDecks[side][dom] = shuffle(deck, r);
      });
    });
    var st = [1, 2, 3].map(function (k) { return shuffle(OBJECTIVES.filter(function (o) { return o.stage === k; }).map(function (o) { return o.id; }), r); });
    s.objDeck = st[0].concat(st[1], st[2]);
    s.objHand.push(s.objDeck.shift());
    log(g, null, "phase", "Round 1. Time 1, reputation " + s.rep + ". The Insurgents choose a secret base.");
    return g;
  }
  function newLeader(L) { return { id: L.id, side: L.side, name: L.name, inf: L.inf, int: L.int, ops: L.ops, log: L.log, sp: L.sp, gr: L.gr, status: "pool", loc: null, card: null }; }
  function freshFlags() { return { iWins: 0, bigWin: false, coreWin: false, liberated: false, maxKill: 0, capKills: 0 }; }

  function log(g, side, kind, text, data) { var e = { round: g.s.round, side: side, kind: kind, text: text, data: data || null }; g.s.log.push(e); g.s.events.push(e); return e; }
  function drainEvents(g) { var e = g.s.events; g.s.events = []; return e; }
  function other(side) { return side === "I" ? "D" : "I"; }
  function sideName(side) { return side === "I" ? "Insurgents" : "Dominion"; }
  function leader(g, id) { for (var i = 0; i < g.s.leaders.length; i++) if (g.s.leaders[i].id === id) return g.s.leaders[i]; return null; }
  function leadersOf(g, side, status) { return g.s.leaders.filter(function (L) { return L.side === side && (!status || L.status === status); }); }
  function hasLeaderAt(g, side, sys) { return g.s.leaders.some(function (L) { return L.side === side && L.status === "placed" && L.loc === sys; }); }
  function drawMission(g, side) {
    var s = g.s;
    if (!s.decks[side].length) { s.decks[side] = shuffle(s.discard[side], g.r); s.discard[side] = []; }
    if (!s.decks[side].length) return null;
    var c = s.decks[side].shift(); s.hands[side].push(c);
    var deckCards = s.hands[side].filter(function (x) { return !MISSIONS[x.id].standing; });
    if (deckCards.length > CFG.deckHandLimit) { var drop = deckCards[0]; s.hands[side].splice(s.hands[side].indexOf(drop), 1); s.discard[side].push(drop); }
    return c;
  }
  function card(g, side, uid) { var h = g.s.hands[side]; for (var i = 0; i < h.length; i++) if (h[i].uid === uid) return h[i]; return null; }

  // ------------------------------------------------------------------ setup
  function validBaseSites(g) {
    return NONHOME.filter(function (i) {
      if (anyUnits(g, i, "D") || anyUnits(g, i, "I")) return false;
      return !SYS[i].adj.some(function (a) { return anyUnits(g, a, "D"); });
    });
  }
  function placeBase(g, sys) {
    var s = g.s;
    if (s.phase !== "setup") throw new Error("not setup");
    if (validBaseSites(g).indexOf(sys) < 0) throw new Error("invalid base site");
    s.base = sys; s.baseHistory.push({ round: 1, sys: sys });
    var known = NONHOME.filter(function (i) { return anyUnits(g, i, "D"); });
    s.probeHand = known.slice();
    s.probeDeck = shuffle(NONHOME.filter(function (i) { return i !== sys && known.indexOf(i) < 0; }), g.r);
    s.know.excluded = NONHOME.filter(function (i) { return validBaseSites(g).indexOf(i) < 0 && i !== sys; });
    s.phase = "assign";
    log(g, "I", "setup", "The Insurgent base is hidden. It did not start in or next to a system with Dominion units.");
  }

  // ------------------------------------------------------------------ knowledge
  function hunterCandidates(g) {
    var s = g.s;
    if (s.baseRevealed) return [s.base];
    var k = s.know;
    return NONHOME.filter(function (i) {
      if (s.probeHand.indexOf(i) >= 0 || k.cleared.indexOf(i) >= 0 || k.excluded.indexOf(i) >= 0 || s.ruined[i]) return false;
      for (var j = 0; j < k.leaks.length; j++) if (k.leaks[j].indexOf(i) < 0) return false;
      return true;
    });
  }
  function ruledOutReason(g, i) {
    var s = g.s, k = s.know;
    if (SYS[i].home) return "home";
    if (s.ruined[i]) return "ruined";
    if (s.probeHand.indexOf(i) >= 0) return "probe";
    if (k.cleared.indexOf(i) >= 0) return "searched";
    if (k.excluded.indexOf(i) >= 0) return "excluded";
    for (var j = 0; j < k.leaks.length; j++) if (k.leaks[j].indexOf(i) < 0) return "deduced";
    return null;
  }
  function clearSystem(g, i) { if (g.s.know.cleared.indexOf(i) < 0) g.s.know.cleared.push(i); }

  // ------------------------------------------------------------------ assignment
  function skillSum(g, ids, sk) { return ids.reduce(function (a, id) { return a + leader(g, id)[sk]; }, 0); }
  // list: [{card: uid, leaders: [id, id?]}]
  function validateAssignment(g, side, list) {
    var s = g.s, seenL = {}, seenC = {};
    list.forEach(function (a) {
      var c = card(g, side, a.card);
      if (!c) throw new Error("card not in hand");
      if (seenC[a.card]) throw new Error("card used twice");
      seenC[a.card] = 1;
      var M = MISSIONS[c.id];
      if (!a.leaders || !a.leaders.length || a.leaders.length > 2) throw new Error("one or two leaders per mission");
      a.leaders.forEach(function (id) {
        var L = leader(g, id);
        if (!L || L.side !== side || L.status !== "pool") throw new Error("leader not available");
        if (seenL[id]) throw new Error("a leader can only go on one mission");
        seenL[id] = 1;
      });
      if (skillSum(g, a.leaders, M.skill) < M.need) throw new Error(M.name + " needs " + M.need + " " + SKILLS[M.skill] + " icon" + (M.need > 1 ? "s" : ""));
    });
  }
  function submitAssignment(g, side, list) {
    var s = g.s;
    if (s.phase !== "assign") throw new Error("not the assignment phase");
    validateAssignment(g, side, list);
    s.assigned[side] = list.map(function (a) { return { card: a.card, leaders: a.leaders.slice() }; });
    if (s.assigned.I && s.assigned.D) startCommand(g);
  }
  function startCommand(g) {
    var s = g.s;
    s.missions = [];
    ["I", "D"].forEach(function (side) {
      s.assigned[side].forEach(function (a) {
        a.leaders.forEach(function (id) { var L = leader(g, id); L.status = "mission"; L.card = a.card; });
        s.missions.push({ side: side, card: a.card, leaders: a.leaders });
      });
      log(g, side, "assign", sideName(side) + " place " + s.assigned[side].length + " mission" + (s.assigned[side].length === 1 ? "" : "s") + " face down and keep " + leadersOf(g, side, "pool").length + " leader" + (leadersOf(g, side, "pool").length === 1 ? "" : "s") + " in reserve.");
    });
    s.assigned = { I: null, D: null };
    s.phase = "command"; s.turn = "I"; s.passes = 0;
    autoPass(g);
  }
  function hiddenMissions(g, side) { return (g.s.missions || []).filter(function (m) { return m.side === side; }); }

  // ------------------------------------------------------------------ command helpers
  function canAct(g, side) { return leadersOf(g, side, "pool").length > 0 || hiddenMissions(g, side).length > 0; }
  function activatable(g, side, sys) { return !hasLeaderAt(g, side, sys) && !g.s.ruined[sys]; }
  function baseBoxPinned(g) { return g.s.leaders.some(function (L) { return L.side === "I" && L.status === "placed" && L.loc === "base"; }); }
  function origins(g, side, sys) {
    var s = g.s, out = [];
    SYS[sys].adj.forEach(function (o) {
      if (hasLeaderAt(g, side, o)) return;
      var st = s.u[o][side];
      if (total(st)) out.push({ from: o, units: Object.assign({}, st) });
    });
    if (side === "I" && !s.baseRevealed && s.base != null && (sys === s.base || SYS[s.base].adj.indexOf(sys) >= 0) && !baseBoxPinned(g) && total(s.baseBox)) {
      out.push({ from: "base", units: Object.assign({}, s.baseBox) });
    }
    return out;
  }
  function canEnterBaseBox(g, sys) { return !g.s.baseRevealed && sys === g.s.base; }
  // A group may move only if its capital ships can carry its fighters and ground units.
  function validateMoves(g, side, sys, moves) {
    var avail = {};
    origins(g, side, sys).forEach(function (o) { avail[o.from] = o; });
    moves.forEach(function (m) {
      var o = avail[m.from];
      if (!o) throw new Error("cannot move from " + (m.from === "base" ? "the base" : SYS[m.from].n));
      for (var t in m.units) if (m.units[t] < 0 || m.units[t] > cnt(o.units, t)) throw new Error("not that many units");
      if (carryOf(m.units) > capOf(m.units)) throw new Error("not enough capacity: fighters and ground units need capital ships to carry them");
    });
  }

  // ------------------------------------------------------------------ mission targets
  function missionTargets(g, side, uid) {
    var s = g.s, c = card(g, side, uid), out = [], i;
    if (!c) return out;
    var id = c.id;
    var dNear = function (m) { return anyUnits(g, m, "D") || SYS[m].adj.some(function (a) { return anyUnits(g, a, "D"); }); };
    for (i = 0; i < N; i++) {
      var S = SYS[i];
      if (s.ruined[i]) continue;
      switch (id) {
        case "rally": if (S.p && !S.throne && s.loy[i] !== "I" && groundAt(g, i, "D") === 0) out.push(i); break;
        case "sabotage": if (s.loy[i] === "D" && !s.sab[i]) out.push(i); break;
        case "uprising": if (s.loy[i] === "D" && !S.home && groundAt(g, i, "D") === 0) out.push(i); break;
        case "plans": if (S.throne && !s.plans && s.usedOnce.project) out.push(i); break;
        case "breakout": if (S.throne && s.captives.length) out.push(i); break;
        case "ally": if (s.loy[i] === "I" && s.reserve.some(function (id2) { return id2[0] === "i"; })) out.push(i); break;
        case "decoy": if (anyUnits(g, i, "I")) out.push(i); break;
        case "supply": if (s.queue.some(function (q) { return q.side === "D" && q.sys === i; })) out.push(i); break;
        case "inspire": if (s.loy[i] === "I" && anyUnits(g, i, "I")) out.push(i); break;
        case "probe": if (anyUnits(g, i, "D")) out.push(i); break;
        case "decree": if (S.p && s.loy[i] !== "D" && groundAt(g, i, "I") === 0 && dNear(i)) out.push(i); break;
        case "project": if (S.throne && !s.usedOnce.project) out.push(i); break;
        case "interrogate": if (S.throne && s.captives.length) out.push(i); break;
        case "conscript": if (s.loy[i] === "D" && S.ic.indexOf("g") >= 0 && !s.sab[i] && !anyUnits(g, i, "I")) out.push(i); break;
        case "crackdown": if (s.loy[i] === "I" && (groundAt(g, i, "D") > 0 || S.adj.some(function (a) { return groundAt(g, a, "D") > 0; }))) out.push(i); break;
        case "scan": out.push(i); break;
        case "annihilate": if (!S.home && cnt(s.u[i].D, "superweapon")) out.push(i); break;
      }
    }
    if (id === "redeploy") out = s.round - s.lastReloc < 2 ? [] : s.probeDeck.filter(function (x) { return !anyUnits(g, x, "D") && x !== s.base && !s.ruined[x]; });
    if (id === "gather" || id === "cache") out = ["base"];
    if (id === "rapid") out = s.queue.some(function (q) { return q.side === "D"; }) ? [THRONE] : [];
    if (id === "scan") { var seen = {}; out = out.filter(function (x) { if (seen[SYS[x].r]) return false; seen[SYS[x].r] = 1; return true; }); }
    if (id === "seize") {
      out = [];
      s.leaders.forEach(function (L) { if (L.side === "I" && L.status === "placed" && typeof L.loc === "number" && anyUnits(g, L.loc, "D")) out.push({ leader: L.id, sys: L.loc }); });
    }
    return out;
  }

  // ------------------------------------------------------------------ command: actions
  function assertTurn(g, side) {
    var s = g.s;
    if (s.phase !== "command") throw new Error("not the command phase");
    if (s.pending) throw new Error("waiting for an opposition decision");
    if (s.battle) throw new Error("a battle is in progress");
    if (s.turn !== side) throw new Error("not your turn");
  }

  function activate(g, side, leaderId, sys, moves) {
    var s = g.s; assertTurn(g, side);
    var L = leader(g, leaderId);
    if (!L || L.side !== side || L.status !== "pool") throw new Error("leader not in reserve");
    if (!activatable(g, side, sys)) throw new Error("you already have a leader there");
    moves = (moves || []).filter(function (m) { return total(m.units); });
    validateMoves(g, side, sys, moves);
    L.status = "placed"; L.loc = sys;
    var parts = [], fromBase = false, groundIn = 0;
    moves.forEach(function (m) {
      var src = m.from === "base" ? s.baseBox : s.u[m.from][side];
      for (var t in m.units) { addU(src, t, -m.units[t]); addU(s.u[sys][side], t, m.units[t]); if (UNITS[t].dom === "ground") groundIn += m.units[t]; }
      if (m.from === "base") fromBase = true;
      parts.push(unitList(m.units) + " from " + (m.from === "base" ? "the hidden base" : SYS[m.from].n));
    });
    log(g, side, "activate", L.name + " activates " + SYS[sys].n + (parts.length ? ": " + parts.join("; ") + "." : "."), { leader: L.id, sys: sys, fromBase: fromBase });
    if (side === "D" && s.sab[sys]) { s.sab[sys] = false; log(g, "D", "sabotage", "The Dominion restores order in " + SYS[sys].n + ": the sabotage is cleared."); }
    if (fromBase) {
      s.know.leaks.push([sys].concat(SYS[sys].adj).filter(function (i) { return !SYS[i].home; }));
      log(g, "I", "leak", "Units left the hidden base, so it must be in " + SYS[sys].n + " or a system next to it.", { sys: sys });
    }
    if (side === "D" && groundIn > 0) troopsArrive(g, sys);
    afterArrival(g, sys, side, L);
  }

  function afterArrival(g, sys, side, L) {
    var s = g.s;
    if (anyUnits(g, sys, "I") && anyUnits(g, sys, "D") && contested(g, sys)) {
      s.afterBattle = { sys: sys, side: side };
      startBattle(g, sys, side, L);
      return;
    }
    finishArrival(g, sys, side);
  }
  function finishArrival(g, sys, side) {
    var s = g.s;
    s.afterBattle = null;
    updateControl(g, sys, side);
    checkBaseWin(g);
    if (!s.winner) endAction(g, side);
  }

  function reinforceBase(g, leaderId, moves) {
    var s = g.s; assertTurn(g, "I");
    if (s.baseRevealed) throw new Error("the base is revealed; activate its system instead");
    var sys = s.base, L = leader(g, leaderId);
    if (!L || L.side !== "I" || L.status !== "pool") throw new Error("leader not in reserve");
    if (!activatable(g, "I", sys)) throw new Error("you already have a leader there");
    moves = moves.filter(function (m) { return total(m.units) && m.from !== "base"; });
    validateMoves(g, "I", sys, moves);
    L.status = "placed"; L.loc = sys;
    var parts = [];
    moves.forEach(function (m) { for (var t in m.units) { addU(s.u[m.from].I, t, -m.units[t]); addU(s.baseBox, t, m.units[t]); } parts.push(unitList(m.units) + " from " + SYS[m.from].n); });
    log(g, "I", "activate", L.name + " activates " + SYS[sys].n + " and moves units into the hidden base: " + parts.join("; ") + ".", { leader: L.id, sys: sys, intoBase: true });
    s.know.leaks.push([sys]);
    log(g, "I", "leak", "Moving units into the base meant activating its system: the Dominion now knows the base is in " + SYS[sys].n + ".", { sys: sys });
    endAction(g, "I");
  }

  function troopsArrive(g, sys) {
    var s = g.s;
    if (sys === s.base && !s.baseRevealed) revealBase(g, "Dominion ground units landed in " + SYS[sys].n + ".");
    else if (!SYS[sys].home && !s.baseRevealed && s.know.cleared.indexOf(sys) < 0) { clearSystem(g, sys); log(g, "D", "search", "Dominion ground units search " + SYS[sys].n + ": no base.", { sys: sys }); }
  }
  function revealBase(g, why) {
    var s = g.s;
    s.baseRevealed = true;
    var bx = unitList(s.baseBox);
    for (var t in s.baseBox) addU(s.u[s.base].I, t, s.baseBox[t]);
    s.baseBox = {};
    s.leaders.forEach(function (L) { if (L.side === "I" && L.loc === "base" && L.status === "placed") L.loc = s.base; });
    log(g, "I", "reveal", why + " The Insurgent base is revealed in " + SYS[s.base].n + " (" + bx + ").", { sys: s.base });
  }

  // ------------------------------------------------------------------ battle
  function contested(g, sys) {
    var u = g.s.u[sys], dom = function (st, d) { return total(st, function (U) { return U.dom === d; }); };
    return (dom(u.I, "space") > 0 && dom(u.D, "space") > 0) || (dom(u.I, "ground") > 0 && dom(u.D, "ground") > 0);
  }
  function leaderTac(g, side, sys, dom) {
    var best = 0, k = dom === "space" ? "sp" : "gr";
    g.s.leaders.forEach(function (L) { if (L.side === side && L.status === "placed" && L.loc === sys) best = Math.max(best, L[k]); });
    return best;
  }
  function expand(st) { var out = []; Object.keys(UNITS).forEach(function (t) { for (var k = 0; k < cnt(st, t); k++) out.push({ t: t, dmg: 0 }); }); return out; }
  function collapse(list) { var st = {}; list.forEach(function (x) { addU(st, x.t, 1); }); return st; }
  function drawTac(g, side, dom) {
    var s = g.s, deck = s.tacDecks[side][dom];
    if (!deck.length) { TACTICS[dom].forEach(function (t) { for (var c = 0; c < t[3]; c++) deck.push(t[0]); }); shuffle(deck, g.r); }
    return deck.shift();
  }

  function startBattle(g, sys, attacker, actL) {
    var s = g.s, u = s.u[sys];
    var b = { sys: sys, attacker: attacker, defender: other(attacker), round: 0, units: { I: expand(u.I), D: expand(u.D) }, hands: { I: { space: [], ground: [] }, D: { space: [], ground: [] } }, play: { I: null, D: null }, stage: "cards", kills: { I: 0, D: 0 }, capKills: 0, retreatOK: { I: false, D: false }, atBase: s.baseRevealed && sys === s.base, start: { I: unitList(u.I), D: unitList(u.D) }, lastRound: null };
    ["I", "D"].forEach(function (side) {
      ["space", "ground"].forEach(function (dom) {
        if (!domContested(b, dom)) return;
        var n = Math.min(CFG.maxTactics, leaderTac(g, side, sys, dom));
        for (var k = 0; k < n; k++) b.hands[side][dom].push(drawTac(g, side, dom));
      });
    });
    s.battle = b;
    log(g, attacker, "battle", "Battle at " + SYS[sys].n + ". Insurgents: " + b.start.I + ". Dominion: " + b.start.D + ".", { sys: sys });
  }
  function domContested(b, dom) {
    var f = function (side) { return b.units[side].some(function (x) { return UNITS[x.t].dom === dom; }); };
    return f("I") && f("D");
  }
  function battleContested(b) { return domContested(b, "space") || domContested(b, "ground"); }

  // choice: {space: cardIndex|null, ground: cardIndex|null}
  function battleCards(g, side, choice) {
    var s = g.s, b = s.battle;
    if (!b || b.stage !== "cards") throw new Error("no battle waiting for tactic cards");
    if (b.play[side]) throw new Error("already chosen");
    var pick = { space: null, ground: null };
    ["space", "ground"].forEach(function (dom) {
      var ix = choice && choice[dom];
      if (ix != null && ix !== "" && ix >= 0) {
        if (!domContested(b, dom) || ix >= b.hands[side][dom].length) throw new Error("cannot play that card");
        pick[dom] = b.hands[side][dom].splice(ix, 1)[0];
      }
    });
    b.play[side] = pick;
    if (b.play.I && b.play.D) resolveBattleRound(g);
  }

  // Pure combat round, used by the engine and by bots for estimates.
  function combatRound(units, mods, atBase, plans, r) {
    var hits = { I: { L: 0, H: 0, F: 0 }, D: { L: 0, H: 0, F: 0 } };
    ["I", "D"].forEach(function (side) {
      var foe = other(side), m = mods[side] || {};
      ["space", "ground"].forEach(function (dom) {
        var mine = units[side].filter(function (x) { return UNITS[x.t].dom === dom; });
        var theirs = units[foe].filter(function (x) { return UNITS[x.t].dom === dom; });
        if (!mine.length || !theirs.length) return;
        var nL = 0, nH = 0;
        mine.forEach(function (x) { nL += UNITS[x.t].L; nH += UNITS[x.t].H; });
        var card = m[dom];
        if (card === "focus" || card === "barrage") nH += 2;
        if (card === "strafe" || card === "charge") nL += 2;
        if (card === "combined") { nL++; nH++; }
        nL += (m.bonus && m.bonus[dom]) || 0;
        var lOn = card === "holdfast" ? 3 : CFG.hitOn, k, v;
        var hd = { L: 0, H: 0, F: 0 };
        for (k = 0; k < nL; k++) { v = d6(r); if (v === 6) hd.F++; else if (v >= lOn) hd.L++; }
        for (k = 0; k < nH; k++) { v = d6(r); if (v === 6) hd.F++; else if (v >= CFG.hitOn) hd.H++; }
        var cancel = 0, fc = (mods[foe] || {})[dom];
        if (fc === "evade" || fc === "entrench") cancel += 2;
        if (dom === "ground" && atBase && foe === "I") cancel += 1;
        while (cancel > 0 && (hd.F + hd.H + hd.L) > 0) { if (hd.F) hd.F--; else if (hd.H) hd.H--; else hd.L--; cancel--; }
        hd.dom = dom;
        hits[side][dom] = hd;
      });
    });
    // apply damage: the receiving side spreads it to lose as little as possible
    var lost = { I: [], D: [] };
    ["I", "D"].forEach(function (side) {
      var foe = other(side);
      ["space", "ground"].forEach(function (dom) {
        var hd = hits[foe][dom]; if (!hd) return;
        var pool = units[side].filter(function (x) { return UNITS[x.t].dom === dom && !(UNITS[x.t].special && !plans); });
        var light = function () { return pool.filter(function (x) { return !UNITS[x.t].heavy && x.dmg < UNITS[x.t].hp; }); };
        var heavy = function () { return pool.filter(function (x) { return UNITS[x.t].heavy && x.dmg < UNITS[x.t].hp; }); };
        function hitHeavy() {
          var hv = heavy(); if (!hv.length) return false;
          var spread = hv.filter(function (x) { return UNITS[x.t].hp - x.dmg > 1; }).sort(function (a, b) { return (UNITS[b.t].hp - b.dmg) - (UNITS[a.t].hp - a.dmg); });
          var tgt = spread[0] || hv.sort(function (a, b) { return UNITS[a.t].cost - UNITS[b.t].cost; })[0];
          tgt.dmg++; return true;
        }
        function hitLight() {
          var lt = light(); if (!lt.length) return false;
          lt.sort(function (a, b) { return UNITS[a.t].cost - UNITS[b.t].cost; })[0].dmg++; return true;
        }
        var k;
        for (k = 0; k < hd.L; k++) hitLight();
        for (k = 0; k < hd.H; k++) hitHeavy();
        for (k = 0; k < hd.F; k++) {
          var hv = heavy().filter(function (x) { return UNITS[x.t].hp - x.dmg > 1; });
          if (hv.length) hitHeavy(); else if (!hitLight()) hitHeavy();
        }
      });
      var keep = [];
      units[side].forEach(function (x) { if (x.dmg >= UNITS[x.t].hp) lost[side].push(x.t); else keep.push(x); });
      units[side] = keep;
    });
    return { hits: hits, lost: lost };
  }

  function resolveBattleRound(g) {
    var s = g.s, b = s.battle, sys = b.sys;
    b.round++;
    var mods = { I: b.play.I, D: b.play.D };
    ["I", "D"].forEach(function (side) { mods[side] = { space: b.play[side].space, ground: b.play[side].ground }; });
    var res = combatRound(b.units, mods, b.atBase, s.plans, g.r);
    b.kills.I += res.lost.D.length; b.kills.D += res.lost.I.length;
    res.lost.D.forEach(function (t) { if (UNITS[t].heavy && UNITS[t].dom === "space") b.capKills++; if (t === "superweapon") s.superDead = true; });
    var played = [];
    ["I", "D"].forEach(function (side) { ["space", "ground"].forEach(function (dom) { var c = b.play[side][dom]; if (c) played.push(sideName(side) + " play " + TAC[c].name); }); });
    var txt = "Round " + b.round + " at " + SYS[sys].n + ". " + (played.length ? played.join("; ") + ". " : "") +
      "Insurgents lose " + (res.lost.I.length ? unitList(collapse(res.lost.I.map(function (t) { return { t: t }; }))) : "nothing") +
      "; Dominion loses " + (res.lost.D.length ? unitList(collapse(res.lost.D.map(function (t) { return { t: t }; }))) : "nothing") + ".";
    log(g, null, "round", txt, { sys: sys });
    b.retreatOK = { I: b.play.I.space === "regroup" || b.play.I.ground === "fallback", D: b.play.D.space === "regroup" || b.play.D.ground === "fallback" };
    b.lastRound = { lost: res.lost, played: { I: b.play.I, D: b.play.D } };
    b.play = { I: null, D: null };
    if (res.lost.D.indexOf("superweapon") >= 0) log(g, "I", "battle", "The superweapon is destroyed!");
    if (!battleContested(b)) return endBattle(g);
    b.stage = "retreat-" + b.attacker;
    advanceRetreat(g);
  }
  function canRetreat(g, side) {
    var b = g.s.battle;
    if (b.units[side].some(function (x) { return x.t === "superweapon"; })) return false;
    return hasLeaderAt(g, side, b.sys) || b.retreatOK[side];
  }
  function retreatTargets(g, side) {
    var b = g.s.battle;
    if (!b) return [];
    return SYS[b.sys].adj.filter(function (a) { return !anyUnits(g, a, other(side)) && !g.s.ruined[a]; });
  }
  function advanceRetreat(g) {
    var b = g.s.battle;
    while (b && (b.stage === "retreat-I" || b.stage === "retreat-D")) {
      var side = b.stage.slice(-1);
      if (canRetreat(g, side) && retreatTargets(g, side).length) return;   // waiting for that side's decision
      nextRetreatStage(g);
      b = g.s.battle;
    }
  }
  function nextRetreatStage(g) {
    var b = g.s.battle;
    if (b.stage === "retreat-" + b.attacker) b.stage = "retreat-" + b.defender;
    else b.stage = "cards";
  }
  // to: system id or null (stay and fight)
  function battleRetreat(g, side, to) {
    var s = g.s, b = s.battle;
    if (!b || b.stage !== "retreat-" + side) throw new Error("not your retreat decision");
    if (to != null) {
      if (!canRetreat(g, side) || retreatTargets(g, side).indexOf(to) < 0) throw new Error("cannot retreat there");
      var st = collapse(b.units[side]);
      // ground units and fighters go only if capital ships can carry them
      var capS = capOf(st), move = {}, stay = [];
      var order = b.units[side].slice().sort(function (a, c) { return UNITS[c.t].cap - UNITS[a.t].cap; });
      var used = 0;
      order.forEach(function (x) {
        var U = UNITS[x.t];
        if (!U.carry) { addU(move, x.t, 1); return; }
        if (used + U.carry <= capS) { used += U.carry; addU(move, x.t, 1); } else stay.push(x);
      });
      b.units[side] = stay;
      for (var t in move) addU(s.u[to][side], t, move[t]);
      log(g, side, "retreat", sideName(side) + " retreat from " + SYS[b.sys].n + " to " + SYS[to].n + " with " + unitList(move) + (stay.length ? ". Units without transport stay and fight" : "") + ".", { from: b.sys, to: to });
      s.leaders.forEach(function (L) { if (L.side === side && L.status === "placed" && L.loc === b.sys && !stay.length) L.loc = to; });
      if (side === "D" && total(move, function (U) { return U.dom === "ground"; }) > 0) troopsArrive(g, to);
      if (!battleContested(b)) return endBattle(g);
    }
    nextRetreatStage(g);
    advanceRetreat(g);
  }

  function endBattle(g) {
    var s = g.s, b = s.battle, sys = b.sys;
    s.u[sys].I = collapse(b.units.I); s.u[sys].D = collapse(b.units.D);
    var iLeft = total(s.u[sys].I), dLeft = total(s.u[sys].D), winner = null;
    if (iLeft && !dLeft) winner = "I"; else if (dLeft && !iLeft) winner = "D";
    s.flags.maxKill = Math.max(s.flags.maxKill, b.kills.I);
    s.flags.capKills += b.capKills;
    if (winner === "I") { s.flags.iWins++; if (b.kills.I >= 2) s.flags.bigWin = true; if (SYS[sys].home) s.flags.coreWin = true; }
    log(g, winner, "battleEnd", "Battle at " + SYS[sys].n + " ends after " + b.round + " round" + (b.round === 1 ? "" : "s") + ". " + (winner ? sideName(winner) + " hold the system." : "Both sides still have units there.") + " Insurgents destroyed " + b.kills.I + ", lost " + b.kills.D + ".", { sys: sys, winner: winner });
    s.battle = null;
    var ab = s.afterBattle;
    if (ab) finishArrival(g, ab.sys, ab.side);
  }

  function updateControl(g, sys, actor) {
    var s = g.s;
    if (!SYS[sys].p || s.ruined[sys]) return;
    var dG = groundAt(g, sys, "D"), iG = groundAt(g, sys, "I");
    if (dG > 0 && iG === 0 && s.loy[sys] !== "D") {
      var was = s.loy[sys]; s.loy[sys] = "D";
      log(g, "D", "control", SYS[sys].n + " falls under Dominion control" + (was === "I" ? ": the Insurgents lose a loyal system." : "."), { sys: sys });
      if (sys === s.base && !s.baseRevealed) revealBase(g, "Dominion control of " + SYS[sys].n + " exposes it.");
    } else if (iG > 0 && dG === 0 && s.loy[sys] === "D" && actor === "I" && !SYS[sys].throne) {
      s.loy[sys] = null; s.sab[sys] = false; s.flags.liberated = true;
      log(g, "I", "control", "Insurgent ground units retake " + SYS[sys].n + ". It is no longer Dominion-loyal.", { sys: sys });
    }
  }
  function checkBaseWin(g) {
    var s = g.s;
    if (!s.baseRevealed || s.winner) return;
    if (groundAt(g, s.base, "D") > 0 && groundAt(g, s.base, "I") === 0) {
      s.winner = "D"; s.phase = "over";
      s.winReason = "Dominion ground units hold " + SYS[s.base].n + ". The Insurgent base has fallen.";
      log(g, "D", "win", s.winReason);
    }
  }

  // ------------------------------------------------------------------ missions: reveal and resolve
  function revealMission(g, side, uid, target) {
    var s = g.s; assertTurn(g, side);
    var m = hiddenMissions(g, side).filter(function (x) { return x.card === uid; })[0];
    if (!m) throw new Error("no such hidden mission");
    var c = card(g, side, uid), M = MISSIONS[c.id], tg = missionTargets(g, side, uid), sys, captiveTarget = null;
    if (c.id === "seize") {
      var t = tg.filter(function (x) { return x.leader === target; })[0];
      if (!t) throw new Error("no such capture target");
      sys = t.sys; captiveTarget = t.leader;
    } else {
      if (tg.indexOf(target) < 0) throw new Error("invalid target for " + M.name);
      sys = target;
    }
    s.missions.splice(s.missions.indexOf(m), 1);
    var Ls = m.leaders.map(function (id) { return leader(g, id); });
    Ls.forEach(function (L) { L.status = "placed"; L.card = null; L.loc = sys === "base" ? "base" : (c.id === "redeploy" ? "base" : sys); });
    var names = Ls.map(function (L) { return L.name; }).join(" and ");
    var where = c.id === "redeploy" ? "" : sys === "base" ? "" : " at " + SYS[sys].n;
    if (c.id === "seize") where = " against " + leader(g, captiveTarget).name + " in " + SYS[sys].n;
    log(g, side, "mission", names + (Ls.length > 1 ? " reveal " : " reveals ") + M.name + where + ".", { card: c.id, sys: typeof sys === "number" && c.id !== "redeploy" ? sys : null });
    var p = { side: side, uid: uid, id: c.id, leaders: m.leaders, sys: sys, captive: captiveTarget, dice: skillSum(g, m.leaders, M.skill) };
    if (M.opp && leadersOf(g, other(side), "pool").length) { s.pending = p; return p; }
    resolveMission(g, p, null);
    return null;
  }

  function oppose(g, side, leaderId) {
    var s = g.s, p = s.pending;
    if (!p) throw new Error("nothing to oppose");
    if (side !== other(p.side)) throw new Error("wrong side");
    var O = null;
    if (leaderId) {
      O = leader(g, leaderId);
      if (!O || O.side !== side || O.status !== "pool") throw new Error("that leader is not in reserve");
      O.status = "placed"; O.loc = typeof p.sys === "number" ? p.sys : null;
    }
    s.pending = null;
    resolveMission(g, p, O);
  }
  function missionOdds(a, b) {
    var p = 0;
    for (var i = 0; i <= a; i++) for (var j = 0; j <= b; j++) if (i > j) p += binom(a, i) * binom(b, j);
    return p / Math.pow(2, a + b);
  }
  function binom(n, k) { var r = 1; for (var i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }

  function resolveMission(g, p, O) {
    var s = g.s, M = MISSIONS[p.id], ok = true;
    if (O) {
      var od = O[M.skill], a = 0, b = 0, k;
      for (k = 0; k < p.dice; k++) if (d6(g.r) >= CFG.hitOn) a++;
      for (k = 0; k < od; k++) if (d6(g.r) >= CFG.hitOn) b++;
      ok = a > b;
      log(g, O.side, "oppose", O.name + " opposes with " + od + " " + SKILLS[M.skill] + " dice. Attempt: " + a + " success" + (a === 1 ? "" : "es") + " on " + p.dice + " dice; opposition: " + b + ". " + (ok ? "The mission succeeds." : "The mission fails (ties go to the opposer)."), { opposer: O.id, ok: ok, sys: p.sys });
    } else if (M.opp) log(g, p.side, "mission", "Unopposed: " + M.name + " succeeds.");
    if (ok) applyMission(g, p);
    // the card returns to hand (standing) or goes to the discard pile
    var h = s.hands[p.side], c = card(g, p.side, p.uid);
    if (c) {
      h.splice(h.indexOf(c), 1);
      if (M.once && ok) s.usedOnce[p.id] = true;
      else if (M.standing && !(M.once && s.usedOnce[p.id])) h.push(c);
      else if (!M.standing) s.discard[p.side].push(c);
    }
    checkBaseWin(g);
    if (!s.winner) endAction(g, p.side);
  }

  function applyMission(g, p) {
    var s = g.s, sys = p.sys, b, k;
    switch (p.id) {
      case "rally":
        b = s.loy[sys]; s.loy[sys] = b === "D" ? null : "I"; if (b === "D") s.sab[sys] = false;
        log(g, "I", "loyalty", SYS[sys].n + (b === "D" ? " breaks from the Dominion and is now neutral." : " becomes loyal to the Insurgents."), { sys: sys }); break;
      case "sabotage":
        s.sab[sys] = true; log(g, "I", "sabotage", SYS[sys].n + " is sabotaged: no Dominion building or deployment there until it is activated.", { sys: sys }); break;
      case "redeploy": relocateBase(g, sys); break;
      case "gather":
        if (s.objDeck.length) { s.objHand.push(s.objDeck.shift()); log(g, "I", "objective-draw", "The Insurgents draw an extra objective card."); } break;
      case "uprising":
        s.loy[sys] = "I"; s.sab[sys] = false; addU(s.u[sys].I, "infantry", 1);
        log(g, "I", "loyalty", SYS[sys].n + " rises up: it is now Insurgent-loyal and 1 infantry joins the cause.", { sys: sys }); break;
      case "plans":
        s.plans = true; log(g, "I", "plans", "The Insurgents steal the superweapon plans. It can now be damaged in battle."); break;
      case "breakout":
        s.captives.forEach(function (id) { var L = leader(g, id); L.status = "placed"; L.loc = THRONE; });
        log(g, "I", "rescue", "Breakout! " + s.captives.map(function (id) { return leader(g, id).name; }).join(" and ") + " escape and will be back next round.");
        s.captives = []; break;
      case "ally": recruit(g, "I", true); break;
      case "decoy": s.noProbe = true; log(g, "I", "decoy", "A decoy signal jams the Dominion's probes: no probe cards this Refresh."); break;
      case "supply":
        var before = s.queue.length;
        s.queue = s.queue.filter(function (q) { return !(q.side === "D" && q.sys === sys && q.type !== "superweapon"); });
        log(g, "I", "supply", "The Insurgents destroy " + (before - s.queue.length) + " Dominion unit" + (before - s.queue.length === 1 ? "" : "s") + " waiting in the build queue at " + SYS[sys].n + ".", { sys: sys }); break;
      case "cache": addU(s.baseBox, "infantry", 2); log(g, "I", "cache", "Two infantry arrive at the hidden base."); break;
      case "inspire":
        s.rep--; log(g, "I", "objective", "Inspired by the stand at " + SYS[sys].n + ", the galaxy rallies: reputation moves to " + s.rep + ".", { sys: sys });
        if (s.rep <= s.time) insurgentWin(g); break;
      case "probe": drawProbes(g, 2, "Probe Sweep"); break;
      case "decree":
        b = s.loy[sys]; s.loy[sys] = b === "I" ? null : "D";
        log(g, "D", "loyalty", SYS[sys].n + (b === "I" ? " drops its Insurgent loyalty and is now neutral." : " declares for the Dominion."), { sys: sys });
        if (s.loy[sys] === "D") { if (sys === s.base && !s.baseRevealed) revealBase(g, "Dominion loyalty in " + SYS[sys].n + " exposes it."); else if (!s.baseRevealed && !SYS[sys].home) clearSystem(g, sys); }
        break;
      case "seize":
        var T = leader(g, p.captive); T.status = "captured"; T.loc = null; s.captives.push(T.id);
        log(g, "D", "capture", T.name + " is captured and taken to the throne.", { leader: T.id }); break;
      case "project":
        s.usedOnce.project = true;
        s.queue.push({ side: "D", type: "superweapon", sys: THRONE, eta: s.round + CFG.superDelay });
        log(g, "D", "project", "The Dominion begins building its superweapon at " + SYS[THRONE].n + ". It arrives in " + CFG.superDelay + " rounds."); break;
      case "interrogate": drawProbes(g, 3, "Interrogation"); break;
      case "conscript": addU(s.u[sys].D, "trooper", 2); log(g, "D", "build", "Two troopers are conscripted at " + SYS[sys].n + ".", { sys: sys }); break;
      case "crackdown": s.loy[sys] = null; log(g, "D", "loyalty", "A crackdown in " + SYS[sys].n + " breaks its Insurgent loyalty.", { sys: sys }); break;
      case "scan":
        var reg = SYS[sys].r, inReg = SYS.filter(function (x) { return x.r === reg; }).map(function (x) { return x.id; });
        if (s.baseRevealed) break;
        if (SYS[s.base].r === reg) { s.know.leaks.push(inReg); log(g, "D", "scan", "Regional Scan: the base IS in the " + REGIONS[reg] + ".", { region: reg, hit: true }); }
        else { inReg.forEach(function (x) { clearSystem(g, x); }); log(g, "D", "scan", "Regional Scan: the base is not in the " + REGIONS[reg] + ".", { region: reg, hit: false }); }
        break;
      case "rapid": deployQueue(g, "D", true); break;
      case "annihilate":
        if (sys === s.base) {
          if (!s.baseRevealed) revealBase(g, "The superweapon fires on " + SYS[sys].n + ", but the base's shields hold.");
          else log(g, "D", "annihilate", "The superweapon fires on " + SYS[sys].n + ", but the base's shields hold.");
          break;
        }
        var lostI = unitList(s.u[sys].I), lostD = Object.assign({}, s.u[sys].D); delete lostD.superweapon;
        s.u[sys].I = {}; s.u[sys].D = { superweapon: 1 };
        s.ruined[sys] = true; s.loy[sys] = null; s.sab[sys] = false;
        s.leaders.forEach(function (L) { if (L.status === "placed" && L.loc === sys && L.side === "I") { L.status = "captured"; L.loc = null; s.captives.push(L.id); } });
        if (!s.baseRevealed) clearSystem(g, sys);
        log(g, "D", "annihilate", "The superweapon destroys " + SYS[sys].n + ". Lost: Insurgent " + lostI + "; Dominion " + unitList(lostD) + ". The system is ruined.", { sys: sys });
        break;
    }
  }

  function relocateBase(g, target) {
    var s = g.s, old = s.base;
    if (!s.baseRevealed) {
      for (var t in s.baseBox) addU(s.u[old].I, t, s.baseBox[t]);
      log(g, "I", "relocate", "The base relocates in secret. Its old site, " + SYS[old].n + ", is exposed" + (total(s.baseBox) ? " and " + unitList(s.baseBox) + " are left there." : "."), { old: old });
    } else log(g, "I", "relocate", "The base escapes " + SYS[old].n + " to a new hidden location.", { old: old });
    s.baseBox = {};
    s.probeDeck.splice(s.probeDeck.indexOf(target), 1);
    s.probeHand.push(old);
    s.base = target; s.baseRevealed = false; s.relocations++; s.lastReloc = s.round;
    s.baseHistory.push({ round: s.round, sys: target });
    var excl = NONHOME.filter(function (i) { return anyUnits(g, i, "D"); });
    s.know = { cleared: [], leaks: [], excluded: excl };
  }
  function drawProbes(g, n, why) {
    var s = g.s, got = [];
    for (var i = 0; i < n && s.probeDeck.length; i++) { var c = s.probeDeck.shift(); s.probeHand.push(c); got.push(c); }
    if (got.length) log(g, "D", "probe", why + ": no base in " + got.map(function (c) { return SYS[c].n; }).join(", ") + ".", { cards: got });
    return got;
  }
  function recruit(g, side, viaMission) {
    var s = g.s, pick = null;
    for (var i = 0; i < s.reserve.length; i++) if (s.reserve[i][0] === (side === "I" ? "i" : "d")) { pick = s.reserve.splice(i, 1)[0]; break; }
    if (!pick) return null;
    var L = newLeader(RESERVE.filter(function (x) { return x.id === pick; })[0]);
    L.status = viaMission ? "placed" : "pool"; L.loc = null;
    s.leaders.push(L);
    log(g, side, "recruit", sideName(side) + " recruit " + L.name + " (" + skillText(L) + ")" + (viaMission ? ", who joins next round." : "."), { leader: L.id });
    return L;
  }
  function skillText(L) {
    var p = []; ["inf", "int", "ops", "log"].forEach(function (k) { if (L[k]) p.push(SKILLS[k] + " " + L[k]); });
    return p.join(", ") + "; tactics " + L.sp + " space / " + L.gr + " ground";
  }

  function pass(g, side) { assertTurn(g, side); log(g, side, "pass", sideName(side) + " pass."); g.s.passes++; nextTurn(g); }
  function endAction(g) { g.s.passes = 0; nextTurn(g); }
  function nextTurn(g) {
    var s = g.s;
    if (s.winner || s.phase !== "command") return;
    if (s.passes >= 2) { endCommand(g); return; }
    var o = other(s.turn);
    if (canAct(g, o)) { s.turn = o; return; }
    if (s.passes >= 1 || !canAct(g, s.turn)) endCommand(g);
  }
  function autoPass(g) {
    var s = g.s;
    if (s.phase !== "command" || s.pending) return;
    if (!canAct(g, "I") && !canAct(g, "D")) { endCommand(g); return; }
    if (!canAct(g, s.turn)) s.turn = other(s.turn);
  }

  // ------------------------------------------------------------------ refresh and build
  function endCommand(g) {
    var s = g.s;
    (s.missions || []).forEach(function (m) {
      m.leaders.forEach(function (id) { var L = leader(g, id); L.status = "pool"; L.card = null; });
      log(g, m.side, "waste", sideName(m.side) + " never revealed one of their missions; it returns to hand unused.");
    });
    s.missions = [];
    log(g, null, "phase", "Refresh, end of round " + s.round + ".");
    // 1. objectives
    var done = 0, keep = [];
    s.objHand.slice().sort(function (a, b) { return OBJ[b].val - OBJ[a].val; }).forEach(function (id) {
      var o = OBJ[id];
      if (done < CFG.objPerRound && o.test(s)) { done++; s.rep -= o.val; s.objScored.push(id); log(g, "I", "objective", "Insurgents complete “" + o.name + "” (" + o.text + ") Reputation moves to " + s.rep + ".", { id: id }); }
      else keep.push(id);
    });
    s.objHand = keep;
    if (s.rep <= s.time) return insurgentWin(g);
    // 2. probes
    if (s.noProbe) { log(g, "D", "probe", "The decoy signal blocks this round's probe cards."); s.noProbe = false; }
    else drawProbes(g, CFG.probesPerRound, "Probe droids");
    // 3. build: both sides spend build points
    s.points = { I: buildPoints(g, "I"), D: buildPoints(g, "D") };
    s.builds = { I: null, D: null };
    s.phase = "build";
  }

  // Build points per side: each icon on a loyal, unsabotaged system with no enemy units is one point.
  function buildPoints(g, side) {
    var s = g.s, pts = { space: 0, ground: 0, sites: { space: [], ground: [] } };
    for (var i = 0; i < N; i++) {
      if (s.loy[i] !== side || s.sab[i] || s.ruined[i] || anyUnits(g, i, other(side))) continue;
      SYS[i].ic.split("").forEach(function (c) {
        var dom = c === "s" ? "space" : "ground";
        pts[dom]++; if (pts.sites[dom].indexOf(i) < 0) pts.sites[dom].push(i);
      });
    }
    if (side === "I" && s.base != null) { pts.sites.ground.push("base"); pts.sites.space.push("base"); }
    return pts;
  }
  // orders: [{type, sys, n}] ; sys may be "base" for Insurgents
  function validateBuild(g, side, orders) {
    var s = g.s, pts = s.points[side], spend = { space: 0, ground: 0 };
    orders.forEach(function (o) {
      var U = UNITS[o.type];
      if (!U || U.side !== side || U.special) throw new Error("cannot build that");
      if (!(o.n > 0)) throw new Error("bad count");
      spend[U.dom] += U.cost * o.n;
      if (pts.sites[U.dom].indexOf(o.sys) < 0) throw new Error(UNITS[o.type].name + " cannot be built at that site");
    });
    if (spend.space > pts.space || spend.ground > pts.ground) throw new Error("not enough build points");
  }
  function submitBuild(g, side, orders) {
    var s = g.s;
    if (s.phase !== "build") throw new Error("not the build step");
    orders = (orders || []).filter(function (o) { return o.n > 0; });
    validateBuild(g, side, orders);
    s.builds[side] = orders;
    if (s.builds.I && s.builds.D) finishRefresh(g);
  }
  function finishRefresh(g) {
    var s = g.s, parts = { I: [], D: [] };
    ["I", "D"].forEach(function (side) {
      s.builds[side].forEach(function (o) {
        for (var k = 0; k < o.n; k++) s.queue.push({ side: side, type: o.type, sys: o.sys, eta: s.round + UNITS[o.type].delay });
        parts[side].push(o.n + " " + plural(UNITS[o.type].name.toLowerCase(), o.n));
      });
    });
    log(g, null, "build", "Build queue: Dominion orders " + (parts.D.join(", ") || "nothing") + "; Insurgents order " + (parts.I.join(", ") || "nothing") + ".");
    s.builds = { I: null, D: null }; s.points = null;
    // 4. deploy units whose time has come
    deployQueue(g, "I", false); deployQueue(g, "D", false);
    // 5. leaders
    s.leaders.forEach(function (L) { if (L.status === "placed") { L.status = "pool"; L.loc = null; } });
    // 6. time
    s.round++; s.time++;
    if (s.rep <= s.time) return insurgentWin(g);
    if (CFG.recruitRounds.indexOf(s.round) >= 0) { recruit(g, "I", false); recruit(g, "D", false); }
    // 7. draws
    for (var k = 0; k < CFG.missionDraw; k++) { drawMission(g, "I"); drawMission(g, "D"); }
    if (s.objDeck.length) s.objHand.push(s.objDeck.shift());
    s.flags = freshFlags();
    s.phase = "assign"; s.turn = "I"; s.passes = 0;
    log(g, null, "phase", "Round " + s.round + ". Time " + s.time + ", reputation " + s.rep + ": " + (s.rep - s.time) + " round" + (s.rep - s.time === 1 ? "" : "s") + " left for the Dominion.");
  }
  function deployQueue(g, side, all) {
    var s = g.s, keep = [], out = {}, blocked = 0;
    s.queue.forEach(function (q) {
      if (q.side !== side || (q.eta > s.round && (!all || q.type === "superweapon"))) { keep.push(q); return; }
      var to = q.sys;
      var ok = function (x) { return x === "base" ? (side === "I" && !s.baseRevealed) : (s.loy[x] === side && !s.sab[x] && !s.ruined[x] && !anyUnits(g, x, other(side))); };
      if (!ok(to)) to = side === "D" ? (ok(THRONE) ? THRONE : null) : (!s.baseRevealed ? "base" : (s.baseRevealed && !anyUnits(g, s.base, "D") ? s.base : null));
      if (to == null) { keep.push(q); blocked++; return; }   // waits in the queue until a site is free
      if (to === "base") addU(s.baseBox, q.type, 1); else addU(s.u[to][side], q.type, 1);
      var key = to === "base" ? "the hidden base" : SYS[to].n; out[key] = out[key] || {}; addU(out[key], q.type, 1);
      if (q.type === "superweapon") {
        s.superBuilt = true;
        s.hands.D.push({ uid: s.uid++, id: "annihilate" });
        log(g, "D", "project", "The superweapon is complete at " + SYS[to].n + ".");
      }
    });
    s.queue = keep;
    var parts = Object.keys(out).map(function (k) { return unitList(out[k]) + " at " + k; });
    if (parts.length) log(g, side, "deploy", sideName(side) + " deploy " + parts.join("; ") + ".");
    if (blocked) log(g, side, "build", blocked + " " + sideName(side) + " unit" + (blocked === 1 ? " has" : "s have") + " no free site to deploy to and wait" + (blocked === 1 ? "s" : "") + " in the queue.");
  }

  function insurgentWin(g) {
    var s = g.s;
    s.winner = "I"; s.phase = "over"; s.battle = null; s.pending = null;
    s.winReason = "Time and reputation meet. The Dominion ran out of time to find the base.";
    log(g, "I", "win", s.winReason);
  }

  // Whose decision is it? Returns the side that must act next, or null.
  function decider(g) {
    var s = g.s;
    if (s.winner) return null;
    if (s.phase === "setup") return "I";
    if (s.phase === "assign") return !s.assigned.I ? "I" : (!s.assigned.D ? "D" : null);
    if (s.phase === "build") return !s.builds.I ? "I" : (!s.builds.D ? "D" : null);
    if (s.phase === "command") {
      if (s.battle) {
        var b = s.battle;
        if (b.stage === "cards") return !b.play.I ? "I" : (!b.play.D ? "D" : null);
        return b.stage.slice(-1);
      }
      if (s.pending) return other(s.pending.side);
      return s.turn;
    }
    return null;
  }

  return {
    CFG: CFG, SYS: SYS, IDX: IDX, DIST: DIST, REGIONS: REGIONS, HOME: HOME, NONHOME: NONHOME, HOME_DIST: HOME_DIST, THRONE: THRONE,
    UNITS: UNITS, TYPES: TYPES, BUILDABLE: BUILDABLE, LEADERS: LEADERS, RESERVE: RESERVE, SKILLS: SKILLS, MISSIONS: MISSIONS,
    TACTICS: TACTICS, TAC: TAC, OBJECTIVES: OBJECTIVES, OBJ: OBJ,
    newGame: newGame, restore: restore, makeRng: makeRng, shuffle: shuffle,
    validBaseSites: validBaseSites, placeBase: placeBase, hunterCandidates: hunterCandidates, ruledOutReason: ruledOutReason,
    submitAssignment: submitAssignment, validateAssignment: validateAssignment, skillSum: skillSum, hiddenMissions: hiddenMissions,
    origins: origins, activatable: activatable, canEnterBaseBox: canEnterBaseBox, validateMoves: validateMoves, missionTargets: missionTargets,
    activate: activate, reinforceBase: reinforceBase, revealMission: revealMission, oppose: oppose, pass: pass, canAct: canAct,
    battleCards: battleCards, battleRetreat: battleRetreat, canRetreat: canRetreat, retreatTargets: retreatTargets, combatRound: combatRound, expand: expand, collapse: collapse,
    leaderTac: leaderTac, missionOdds: missionOdds, buildPoints: buildPoints, submitBuild: submitBuild, validateBuild: validateBuild,
    leader: leader, leadersOf: leadersOf, hasLeaderAt: hasLeaderAt, card: card, anyUnits: anyUnits, groundAt: groundAt, stackOf: stackOf,
    total: total, cnt: cnt, addU: addU, capOf: capOf, carryOf: carryOf, unitList: unitList, plural: plural, skillText: skillText,
    countLoyal: countLoyal, countSab: countSab, other: other, sideName: sideName, decider: decider, drainEvents: drainEvents
  };
});
