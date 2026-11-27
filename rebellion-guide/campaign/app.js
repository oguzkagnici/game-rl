/* Campaign: page controller. Map, rail (clock, coach, decision panel), records, bot pacing. */
(function () {
  "use strict";
  var C = window.Campaign, B = window.CampaignBots, LESSONS = window.CampaignLessons, SYS = C.SYS, N = SYS.length, U = C.UNITS, M = C.MISSIONS;
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("rsc:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("rsc:" + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem("rsc:" + k); } catch (e) {} }
  };
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function nm(i) { return i === "base" ? "the hidden base" : SYS[i].n; }
  function pct(p) { return Math.round(p * 100) + "%"; }
  var SIDE = { I: "Insurgents", D: "Dominion" }, SK = C.SKILLS;
  var SKSHORT = { inf: "Inf", int: "Int", ops: "Ops", log: "Log" };

  var A = { g: null, user: "I", bot: "D", lvl: "veteran", pickSide: "I", pickLvl: "veteran", preview: true,
            ui: { mode: "idle" }, seen: {}, queue: [], shown: null, suggestion: null, busy: false, overlay: true, inspect: null, autoBattle: false };

  function setGame(g) { A.g = g; window.__cg = g; }
  function bootPreview() { setGame(C.newGame({ seed: 7 })); A.preview = true; A.inspect = null; }
  function startMatch(side, lvl) {
    A.user = side; A.bot = C.other(side); A.lvl = lvl; A.preview = false;
    setGame(C.newGame({}));
    A.ui = { mode: "idle" }; A.seen = {}; A.queue = []; A.shown = null; A.suggestion = null; A.inspect = null;
    C.drainEvents(A.g); after(); pump();
  }
  function save() { if (!A.preview) store.set("save", { s: A.g.s, user: A.user, lvl: A.lvl, seen: A.seen }); }
  function resume() {
    var sv = store.get("save", null); if (!sv) return;
    setGame(C.restore(sv.s)); A.preview = false; A.user = sv.user; A.bot = C.other(sv.user); A.lvl = sv.lvl; A.seen = sv.seen || {};
    A.ui = { mode: "idle" }; A.queue = []; A.shown = null; render(); pump();
  }

  // ------------------------------------------------------------------ pacing
  function decider() { return A.preview ? null : C.decider(A.g); }
  function botDue() { var d = decider(); return d === A.bot || (d === A.user && A.g.s.battle && A.autoBattle); }
  function pump() {
    if (A.busy || !botDue()) return;
    A.busy = true; render();
    var s = A.g.s, delay = s.battle ? 550 : (s.phase === "command" ? 750 : 200);
    setTimeout(function () {
      try {
        var side = decider(), at = s.log.length;
        var r = B.step(A.g, side, side === A.bot ? A.lvl : "veteran");
        if (r && r.why && !r.private && side === A.bot) A.g.s.log.splice(at + (r.kind === "oppose" ? 1 : 0), 0, { round: A.g.s.round, side: side, kind: "why", text: r.why });
      } catch (e) { console.error(e); }
      A.busy = false; after(); pump();
    }, delay);
  }
  function after() {
    var ev = C.drainEvents(A.g);
    if (!A.preview) checkLessons(ev);
    var s = A.g.s, d = decider();
    if (A.ui.mode === "assign" && s.phase !== "assign") A.ui = { mode: "idle" };
    if (A.ui.mode === "build" && s.phase !== "build") A.ui = { mode: "idle" };
    if (/^(moves|pickActivate|pickMission)$/.test(A.ui.mode) && !(s.phase === "command" && d === A.user && !s.pending && !s.battle)) A.ui = { mode: "idle" };
    if (A.ui.mode === "battle" && !s.battle) A.ui = { mode: "idle" };
    A.suggestion = null; save(); render();
  }
  function userDo(fn) { try { fn(); } catch (e) { flash(e.message); return; } A.ui = { mode: "idle" }; after(); pump(); }
  var flashMsg = null;
  function flash(t) { flashMsg = t; render(); setTimeout(function () { flashMsg = null; render(); }, 4000); }

  // ------------------------------------------------------------------ coach
  function checkLessons(ev) {
    var ctx = { g: A.g, s: A.g.s, user: A.user, ev: ev };
    LESSONS.forEach(function (L) {
      if (A.seen[L.id]) return;
      var hit = false; try { hit = L.when(ctx); } catch (e) { hit = false; }
      if (hit) { A.seen[L.id] = { round: A.g.s.round, html: L.body(A.user) }; A.queue.push(L.id); }
    });
    if (!A.shown && A.queue.length) A.shown = A.queue.shift();
  }
  function lessonById(id) { for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return LESSONS[i]; return null; }
  function suggest() {
    var g = A.g, s = g.s, u = A.user, BOT = B.BOT[u];
    if (s.phase === "setup") { var pb = B.Ins.placeBase(g); A.suggestion = { text: "Hide the base at <b>" + nm(pb.sys) + "</b>. " + esc(pb.why), label: "Hide it at " + nm(pb.sys), apply: function () { userDo(function () { C.placeBase(g, pb.sys); }); } }; }
    else if (s.phase === "assign") {
      var as = BOT.assign(g, "veteran"), team = {};
      as.list.forEach(function (a) { team[a.card] = a.leaders.slice(); });
      A.suggestion = { text: esc(as.why), label: "Fill in these assignments", apply: function () { A.ui = { mode: "assign", team: team }; A.suggestion = null; render(); } };
    } else if (s.phase === "build") {
      var bd = BOT.build(g, "veteran"), ord = {}, site = {};
      bd.orders.forEach(function (o) { ord[o.type] = (ord[o.type] || 0) + o.n; site[U[o.type].dom] = o.sys; });
      A.suggestion = { text: esc(bd.why), label: "Fill in this build", apply: function () { A.ui = { mode: "build", orders: ord, site: site }; A.suggestion = null; render(); } };
    } else if (s.battle) {
      if (s.battle.stage === "cards") { var bc = B.battleCards(g, u); A.suggestion = { text: describeCards(bc.choice), label: "Play that", apply: function () { userDo(function () { C.battleCards(g, u, bc.choice); }); } }; }
      else { var br = B.battleRetreat(g, u); A.suggestion = { text: esc(br.to != null ? br.why : (br.why || "Stay and fight: the odds are still acceptable.")), label: br.to != null ? "Retreat to " + nm(br.to) : "Stay and fight", apply: function () { userDo(function () { C.battleRetreat(g, u, br.to); }); } }; }
    } else if (s.pending) {
      var op = BOT.oppose(g, "veteran");
      A.suggestion = { text: esc(op.why || "Let it through: not worth a leader that could do something else."), label: op.leader ? "Oppose with " + C.leader(g, op.leader).name : "Let it through", apply: function () { userDo(function () { C.oppose(g, u, op.leader); }); } };
    } else {
      var a = BOT.command(g, "veteran");
      A.suggestion = { text: esc(a.why), label: a.type === "pass" ? "Pass" : "Do it", apply: function () { userDo(function () { B.act(g, u, a); }); } };
    }
    render();
  }
  function describeCards(ch) {
    var b = A.g.s.battle, p = [];
    ["space", "ground"].forEach(function (dom) { if (ch[dom] != null) p.push("play <b>" + C.TAC[b.hands[A.user][dom][ch[dom]]].name + "</b> in " + dom); });
    return p.length ? "This round, " + p.join(" and ") + "." : "Keep your cards for a later round.";
  }

  // ------------------------------------------------------------------ map
  var EDGE_LIST = []; SYS.forEach(function (a) { a.adj.forEach(function (b) { if (a.id < b) EDGE_LIST.push([a.id, b]); }); });
  // Region labels sit in open space between systems (placed by hand for this map).
  var REG_POS = [[75, 490], [270, 60], [100, 712], [668, 402], [690, 140], [720, 728], [815, 470], [1100, 150], [995, 735]].map(function (p) { return { x: p[0], y: p[1] }; });
  function activationTargets() {
    var g = A.g, s = g.s, u = A.user, out = [];
    for (var i = 0; i < N; i++) { if (!C.activatable(g, u, i)) continue; if (C.origins(g, u, i).length || (u === "D" && s.sab[i] && s.loy[i] === "D")) out.push(i); }
    return out;
  }
  function pickTargets() {
    var g = A.g, s = g.s, ui = A.ui, out = {};
    if (A.preview) return null;
    if (s.phase === "setup" && A.user === "I" && decider() === "I") { C.validBaseSites(g).forEach(function (i) { out[i] = 1; }); return out; }
    if (ui.mode === "pickActivate") { activationTargets().forEach(function (i) { out[i] = 1; }); return out; }
    if (ui.mode === "pickMission") { ui.targets.forEach(function (t) { var k = typeof t === "object" ? t.sys : t; if (typeof k === "number") out[k] = 1; }); return out; }
    return null;
  }
  function chip(side, sp, gr, x, y) {
    var w = 6 + (sp ? 28 : 0) + (gr ? 28 : 0), h = "<g class='chip chip-" + side + "'><rect x='" + x + "' y='" + (y - 9) + "' width='" + w + "' height='18' rx='4'/>", cx = x + 4;
    if (sp) { h += "<path class='ico' d='M" + (cx + 1) + " " + (y + 4) + " L" + (cx + 5) + " " + (y - 5) + " L" + (cx + 9) + " " + (y + 4) + "Z'/><text x='" + (cx + 11) + "' y='" + (y + 4.5) + "'>" + sp + "</text>"; cx += 28; }
    if (gr) h += "<rect class='ico' x='" + (cx + 1) + "' y='" + (y - 4) + "' width='8' height='8'/><text x='" + (cx + 11) + "' y='" + (y + 4.5) + "'>" + gr + "</text>";
    return h + "</g>";
  }
  function domCount(st, dom) { return C.total(st, function (x) { return x.dom === dom; }); }
  function renderMap() {
    var g = A.g, s = g.s, tg = pickTargets(), h = "";
    var showBase = A.user === "I" || s.baseRevealed || s.phase === "over";
    var overlay = A.overlay && !A.preview && s.phase !== "setup" && s.phase !== "over" && !s.baseRevealed;
    var cands = {}; if (overlay) C.hunterCandidates(g).forEach(function (i) { cands[i] = 1; });
    REG_POS.forEach(function (p, k) { h += "<text class='reg' x='" + p.x + "' y='" + p.y + "'>" + esc(C.REGIONS[k].toUpperCase()) + "</text>"; });
    EDGE_LIST.forEach(function (e) { var a = SYS[e[0]], b = SYS[e[1]]; h += "<line class='edge' x1='" + a.x + "' y1='" + a.y + "' x2='" + b.x + "' y2='" + b.y + "'/>"; });
    var oldBases = {}; s.log.forEach(function (e) { if (e.kind === "relocate" && e.data) oldBases[e.data.old] = 1; });
    SYS.forEach(function (sy) {
      var i = sy.id, u = s.u[i], cls = ["sys"];
      if (!sy.p) cls.push("remote");
      if (s.ruined[i]) cls.push("ruined"); else if (s.loy[i] === "I") cls.push("loy-I"); else if (s.loy[i] === "D") cls.push("loy-D");
      if (tg) cls.push(tg[i] ? "pick" : "dim");
      if ((A.ui.mode === "moves" && A.ui.sys === i) || A.inspect === i) cls.push("sel");
      var reason = overlay && !sy.home ? C.ruledOutReason(g, i) : null;
      if (reason) cls.push("out");
      h += "<g class='" + cls.join(" ") + "' data-sys='" + i + "' transform='translate(" + sy.x + "," + sy.y + ")' tabindex='0' role='button' aria-label='" + esc(sy.n) + "'>";
      if (cands[i]) h += "<circle class='cand' r='26'/>";
      h += "<circle class='pickring' r='29'/>";
      if (sy.home) h += "<circle class='core-ring' r='25'/>";
      h += "<circle class='body' r='" + (sy.p ? 20 : 15) + "'/>";
      if (sy.throne) h += "<path class='star' d='M0 -16 L2 -11 L7 -11 L3 -8 L4.5 -3 L0 -6 L-4.5 -3 L-3 -8 L-7 -11 L-2 -11Z'/>";
      if (sy.ic) h += "<text class='ic' y='" + (sy.throne ? 9 : 4) + "'>" + sy.ic.toUpperCase().split("").join(" ") + "</text>";
      if (showBase && s.base === i) h += "<path class='basemark' d='M-7 -14 L-7 -20 L0 -26 L7 -20 L7 -14Z' transform='translate(0,-4)'/>";
      else if (oldBases[i]) h += "<path class='basemark-old' d='M-6 -15 L-6 -20 L0 -25 L6 -20 L6 -15Z' transform='translate(0,-4)'/>";
      if (s.sab[i]) h += "<g class='sab' transform='translate(17,15)'><circle r='8'/><text y='3.5'>S</text></g>";
      h += "<text class='nm' y='" + (sy.p ? 37 : 32) + "'>" + sy.n + "</text>";
      if (reason) h += "<text class='why' y='" + (sy.p ? 49 : 44) + "'>" + ({ probe: "probe card", searched: "searched", excluded: "start rule", deduced: "deduced", ruined: "ruined" }[reason] || reason) + "</text>";
      else if (cands[i]) h += "<text class='why poss' y='" + (sy.p ? 49 : 44) + "'>possible</text>";
      var iS = domCount(u.I, "space"), iG = domCount(u.I, "ground"), dS = domCount(u.D, "space"), dG = domCount(u.D, "ground");
      var wI = (iS || iG) ? 6 + (iS ? 28 : 0) + (iG ? 28 : 0) : 0, wD = (dS || dG) ? 6 + (dS ? 28 : 0) + (dG ? 28 : 0) : 0;
      if (wI && wD) { h += chip("I", iS, iG, -wI - 2, -38); h += chip("D", dS, dG, 2, -38); }
      else if (wI) h += chip("I", iS, iG, -wI / 2, -38);
      else if (wD) h += chip("D", dS, dG, -wD / 2, -38);
      if (C.cnt(u.D, "superweapon")) h += "<g class='swpn' transform='translate(26,-12)'><circle r='7'/><title>Superweapon</title></g>";
      var li = 0, ld = 0;
      s.leaders.forEach(function (L) {
        if (L.status !== "placed" || L.loc !== i) return;
        var x = L.side === "I" ? -32 : 32, y = 4 + (L.side === "I" ? li++ : ld++) * 15;
        h += "<g class='ldr ldr-" + L.side + "' transform='translate(" + x + "," + y + ")'><title>" + esc(L.name) + "</title><circle r='7.5'/><text y='3.5'>" + L.name.split(" ").map(function (w) { return w[0]; }).join("") + "</text></g>";
      });
      h += "</g>";
    });
    $("map").innerHTML = h;
    $("overlayLabel").textContent = A.user === "D" ? "Show where the base could be" : "Show what the hunter knows";
  }

  // ------------------------------------------------------------------ clock and coach
  function renderClock() {
    var s = A.g.s, h = "";
    for (var i = 1; i <= 16; i++) {
      h += "<div class='cell" + (i > s.time && i < s.rep ? " gap" : "") + (C.CFG.recruitRounds.indexOf(i) >= 0 ? " rec" : "") + "'>" + i;
      if (i === s.time) h += "<span class='tok t' title='Time'>T</span>";
      if (i === s.rep) h += "<span class='tok r' title='Reputation'>R</span>";
      h += "</div>";
    }
    $("track").innerHTML = h;
    var gp = Math.max(0, s.rep - s.time);
    $("gapNum").textContent = gp;
    $("gapText").textContent = (gp === 1 ? "round" : "rounds") + " left for the Dominion if the Insurgents never score again. Dotted spaces bring a new leader to each side.";
    $("roundLabel").textContent = A.preview ? "Starting position" : "Round " + s.round;
  }
  function renderCoach() {
    var h = "<div class='row between'><h2>Coach</h2>";
    if (!A.preview && !A.g.s.winner && !A.busy && decider() === A.user) h += "<button class='btn' data-act='suggest'>What would a veteran do?</button>";
    h += "</div>";
    if (A.suggestion) h += "<div class='suggest'><div>" + A.suggestion.text + "</div><div class='row'><button class='btn primary' data-act='applySug'>" + esc(A.suggestion.label) + "</button><button class='btn ghost' data-act='dropSug'>Dismiss</button></div></div>";
    if (A.preview) h += "<div class='lesson'><h3>The full-scale game</h3><p>New to the drill? Play the short <b>Sparring Drill</b> first; this game assumes you know the clock, opposition and pinning. Here you add unit types and transport, the build queue, tactic cards and retreat, skill-matched mission cards, captives, three objective stages and a superweapon.</p><p>The coach steps in as each idea comes up. A match takes 40 to 60 minutes.</p></div>";
    else if (A.shown) {
      var L = lessonById(A.shown), seen = A.seen[A.shown];
      h += "<div class='lesson'><span class='eyebrow'>Lesson · round " + seen.round + "</span><h3>" + esc(L.title) + "</h3>" + seen.html + "<div class='table-note'><b>At the Rebellion table</b>" + esc(L.table) + "</div><div class='row'><button class='btn' data-act='nextLesson'>" + (A.queue.length ? "Next lesson (" + A.queue.length + " more)" : "Got it") + "</button></div></div>";
    } else if (!A.g.s.winner) {
      var c = C.hunterCandidates(A.g).length, s = A.g.s;
      h += "<p class='small'>" + (A.user === "I" ? "The Dominion has " + c + " candidate systems for your base." : "Your search: " + c + " candidate systems left.") + " Gap: " + (s.rep - s.time) + " rounds.</p>";
    }
    var ids = Object.keys(A.seen);
    if (ids.length && !A.preview) h += "<details><summary class='small'>Field notes (" + ids.length + " lessons)</summary><div class='notes'>" + ids.map(function (id) { return "<button data-act='showLesson' data-id='" + id + "'>" + esc(lessonById(id).title) + "</button>"; }).join("") + "</div></details>";
    $("coachPanel").innerHTML = h;
  }

  // ------------------------------------------------------------------ decision panel
  function renderAct() {
    var g = A.g, s = g.s, u = A.user, d = decider(), h;
    if (A.preview) h = startPanel();
    else if (s.winner) h = debrief();
    else if (s.battle && (d !== A.user || A.autoBattle || A.busy)) h = battlePanel(false);
    else if (A.busy || d === A.bot) h = "<h2>" + SIDE[A.bot] + " are deciding</h2><p class='small'>" + ({ assign: "Assigning missions face down.", build: "Ordering units.", command: "Watch the map and the log; its reasoning appears in italics." }[s.phase] || "") + "</p>";
    else if (s.phase === "setup") h = "<h2>Hide your base</h2><p>Click a highlighted system or pick one here.</p><div class='opts'>" + C.validBaseSites(g).map(function (i) { return "<button data-act='base' data-sys='" + i + "'>" + nm(i) + (SYS[i].p ? "" : " (remote)") + "</button>"; }).join("") + "</div>";
    else if (s.phase === "assign") h = assignPanel();
    else if (s.phase === "build") h = buildPanel();
    else if (s.battle) h = battlePanel(true);
    else if (s.pending) h = opposePanel();
    else h = commandPanel();
    if (flashMsg) h = "<div class='warn'><b>Not allowed:</b> " + esc(flashMsg) + "</div>" + h;
    $("actPanel").innerHTML = h;
    $("phaseLabel").textContent = A.preview ? "Starting position" : s.winner ? "Match over" : ({ setup: "Setup", assign: "Assignment", command: s.battle ? "Battle" : "Command", build: "Refresh: build" }[s.phase] || s.phase) + " · you are the " + SIDE[u];
  }
  function startPanel() {
    var sv = store.get("save", null), h = "<h2>New campaign</h2>";
    if (sv && sv.s && !sv.s.winner) h += "<button class='btn block primary' data-act='resume'>Continue your campaign<span class='sub'>Round " + sv.s.round + " as the " + SIDE[sv.user] + "</span></button>";
    h += "<div class='sides'><button class='sidecard' style='--c:var(--rebel)' data-act='pickSide' data-side='I' aria-pressed='" + (A.pickSide === "I") + "'><h3>Insurgents</h3><p>Plays like the Rebels: hide, score objectives, relocate in time, steal the plans.</p></button>" +
      "<button class='sidecard' style='--c:var(--empire)' data-act='pickSide' data-side='D' aria-pressed='" + (A.pickSide === "D") + "'><h3>Dominion</h3><p>Plays like the Empire: probe, scan, land troops, build the superweapon, close the net.</p></button></div>";
    h += "<div class='row between'><span class='small'>Opponent</span><span class='seg'>" + ["recruit", "veteran"].map(function (l) { return "<button data-act='pickLvl' data-lvl='" + l + "' aria-pressed='" + (A.pickLvl === l) + "'>" + (l === "recruit" ? "Recruit" : "Veteran") + "</button>"; }).join("") + "</span></div>";
    return h + "<button class='btn primary block' data-act='start'>Start as the " + SIDE[A.pickSide] + "</button>";
  }
  function dice(n, sk) { return n + " " + sk + (n === 1 ? " die" : " dice"); }
  function skills(L) { var p = []; ["inf", "int", "ops", "log"].forEach(function (k) { if (L[k]) p.push(SKSHORT[k] + " " + L[k]); }); return p.join(" · "); }

  function assignPanel() {
    var g = A.g, s = g.s, u = A.user;
    if (A.ui.mode !== "assign") A.ui = { mode: "assign", team: {} };
    var team = A.ui.team, used = {}; Object.keys(team).forEach(function (k) { team[k].forEach(function (id) { used[id] = k; }); });
    var pool = C.leadersOf(g, u, "pool"), h = "<h2>Assign missions</h2><p class='small'>Pick one or two leaders per card. Their matching skill icons must reach the card's need; each icon is one die if opposed. Unassigned leaders stay in reserve.</p>";
    var bad = [];
    s.hands[u].forEach(function (c) {
      var Mi = M[c.id], t = team[c.uid] || [], sum = t.reduce(function (a, id) { return a + C.leader(g, id)[Mi.skill]; }, 0);
      if (t.length && sum < Mi.need) bad.push(Mi.name);
      h += "<div class='mcard" + (t.length ? (sum >= Mi.need ? " on" : " short") : "") + "'><div class='aname'><b>" + esc(Mi.name) + "</b><span class='stats'>" + SK[Mi.skill] + " " + Mi.need + (Mi.standing ? " · standing" : "") + (Mi.opp ? "" : " · cannot be opposed") + "</span></div><span class='small'>" + esc(Mi.text) + "</span><div class='opts'>";
      pool.filter(function (L) { return L[Mi.skill] > 0; }).forEach(function (L) {
        var on = t.indexOf(L.id) >= 0, dis = !on && (used[L.id] || t.length >= 2);
        h += "<button data-act='team' data-c='" + c.uid + "' data-l='" + L.id + "' aria-pressed='" + on + "'" + (dis ? " disabled" : "") + ">" + esc(L.name) + " · " + L[Mi.skill] + "</button>";
      });
      h += "</div>" + (t.length ? "<span class='small'>" + dice(sum, SK[Mi.skill]) + (sum < Mi.need ? ", needs " + Mi.need : "") + "</span>" : "") + "</div>";
    });
    var nMis = Object.keys(team).filter(function (k) { return team[k].length; }).length, res = pool.length - Object.keys(used).length;
    var w = [];
    if (res === 0) w.push("<b>No reserve.</b> You won't be able to move units or oppose anything this round.");
    if (u === "D" && res < pool.length / 2) w.push("<b>Mission-heavy.</b> Troops find bases, and moving them takes reserve leaders.");
    if (u === "I") { var dg = B.danger(g); if (dg.lvl >= 2 && !Object.keys(team).some(function (k) { var c = C.card(g, u, +k); return c && c.id === "redeploy" && team[k].length; })) w.push("<b>Danger:</b> " + esc(dg.why) + ". Consider Redeploy Base."); }
    if (bad.length) w.push("Not enough icons on: " + bad.join(", ") + ".");
    if (w.length) h += "<div class='warn'>" + w.join("<br>") + "</div>";
    return h + "<button class='btn primary' data-act='submitAssign'" + (bad.length ? " disabled" : "") + ">Confirm: " + nMis + " mission" + (nMis === 1 ? "" : "s") + ", " + res + " in reserve</button>";
  }

  function commandPanel() {
    var g = A.g, s = g.s, u = A.user, ui = A.ui, h;
    if (ui.mode === "moves") return movesPanel();
    if (ui.mode === "pickActivate") return "<h2>Activate which system?</h2><p class='small'>Click a highlighted system. Units next to it can move in.</p><div class='opts'>" + activationTargets().map(function (i) { return "<button data-act='actSys' data-sys='" + i + "'>" + nm(i) + "</button>"; }).join("") + "</div><button class='btn ghost' data-act='cancel'>Cancel</button>";
    if (ui.mode === "pickMission") {
      var Mi = M[C.card(g, u, ui.card).id];
      h = "<h2>" + esc(Mi.name) + ": pick a target</h2><p class='small'>" + esc(Mi.text) + "</p><div class='opts'>" + ui.targets.map(function (t, k) {
        var label = typeof t === "object" ? C.leader(g, t.leader).name + " at " + nm(t.sys) : (Mi === M.scan ? C.REGIONS[SYS[t].r] + " (via " + nm(t) + ")" : nm(t));
        return "<button data-act='misTarget' data-k='" + k + "'>" + esc(label) + "</button>";
      }).join("") + "</div>";
      if (u === "I" && /rally|sabotage|uprising|inspire|supply/.test(C.card(g, u, ui.card).id) && C.hiddenMissions(g, "D").length) {
        var risky = ui.targets.filter(function (t) { return typeof t === "number" && C.anyUnits(g, t, "D"); });
        if (risky.length) h += "<div class='warn'>Targets holding Dominion units (" + risky.map(nm).join(", ") + ") leave your leaders exposed to Seize.</div>";
      }
      return h + "<button class='btn ghost' data-act='cancel'>Cancel</button>";
    }
    var pool = C.leadersOf(g, u, "pool"), mis = C.hiddenMissions(g, u), opp = C.other(u);
    h = "<h2>Your turn</h2><p class='small'>" + SIDE[opp] + ": " + C.leadersOf(g, opp, "pool").length + " in reserve, " + C.hiddenMissions(g, opp).length + " hidden mission" + (C.hiddenMissions(g, opp).length === 1 ? "" : "s") + ".</p><div class='btnlist'>";
    if (pool.length) h += "<button class='btn block' data-act='activate'>Activate a system<span class='sub'>" + pool.length + " reserve leader" + (pool.length === 1 ? "" : "s") + ": move units in and fight.</span></button>";
    mis.forEach(function (m) {
      var c = C.card(g, u, m.card), t = C.missionTargets(g, u, m.card);
      h += "<button class='btn block' data-act='reveal' data-c='" + m.card + "'" + (t.length ? "" : " disabled") + ">Reveal " + esc(M[c.id].name) + "<span class='sub'>" + m.leaders.map(function (id) { return esc(C.leader(g, id).name); }).join(" + ") + " · " + C.skillSum(g, m.leaders, M[c.id].skill) + " dice" + (t.length ? "" : " · no valid target now") + "</span></button>";
    });
    return h + "<button class='btn block ghost' data-act='pass'>Pass<span class='sub'>The round ends when both sides pass in a row.</span></button></div>";
  }

  function movesPanel() {
    var g = A.g, s = g.s, u = A.user, ui = A.ui, sys = ui.sys, orig = C.origins(g, u, sys), pool = C.leadersOf(g, u, "pool"), h;
    h = "<h2>Activate " + nm(sys) + "</h2><div class='row'><label class='small' for='lsel'>Leader</label><select class='lsel' id='lsel'>" + pool.map(function (L) { return "<option value='" + L.id + "'" + (L.id === ui.leader ? " selected" : "") + ">" + esc(L.name) + " (tactics " + L.sp + "/" + L.gr + ")</option>"; }).join("") + "</select></div>";
    var bad = false, tot = {}, fromBase = false;
    orig.forEach(function (o) {
      var mv = ui.moves[o.from] || {}, cap = C.capOf(mv), car = C.carryOf(mv);
      if (car > cap) bad = true;
      if (o.from === "base" && C.total(mv)) fromBase = true;
      for (var t in mv) C.addU(tot, t, mv[t]);
      h += "<div class='origin'><div class='row between'><b>" + (o.from === "base" ? "<span class='reb'>Hidden base</span>" : "From " + nm(o.from)) + "</b><span class='small mono" + (car > cap ? " badtxt" : "") + "'>carrying " + car + "/" + cap + "</span></div>";
      Object.keys(U).forEach(function (t) {
        if (!o.units[t]) return;
        var n = mv[t] || 0;
        h += "<div class='mrow'><span>" + U[t].name + (U[t].cap ? " <span class='small'>(cap " + U[t].cap + ")</span>" : "") + "</span><span class='step'><button data-act='mv' data-f='" + o.from + "' data-t='" + t + "' data-d='-1' aria-label='fewer'>−</button><output>" + n + "/" + o.units[t] + "</output><button data-act='mv' data-f='" + o.from + "' data-t='" + t + "' data-d='1' aria-label='more'>+</button></span></div>";
      });
      h += "</div>";
    });
    if (u === "I" && C.canEnterBaseBox(g, sys)) h += "<label class='toggle'><input type='checkbox' id='intoBase'" + (ui.intoBase ? " checked" : "") + "> Move these units into the hidden base</label>";
    var w = [], info = [];
    if (bad) w.push("<b>Not enough capacity.</b> Fighters and ground units need capital ships moving from the same system.");
    if (fromBase) w.push("<b>This leaks.</b> Units leaving the hidden base tell the Dominion it is in " + nm(sys) + " or next to it.");
    if (ui.intoBase) w.push("<b>This gives the base away:</b> the Dominion will know it is in " + nm(sys) + ".");
    var foe = s.u[sys][C.other(u)];
    if (C.total(foe) && C.total(tot) && !ui.intoBase) {
      var L = C.leader(g, ui.leader), mine = Object.assign({}, s.u[sys][u]); for (var t in tot) C.addU(mine, t, tot[t]);
      var e = B.estFor(g, u, mine, foe, sys, Math.max(L.sp, L.gr) / 2, 1);
      var line = "Battle against " + C.unitList(foe) + ": about <b>" + pct(e.pWin) + "</b> to win without tactic cards. Expected losses (by cost): you " + e.lossA.toFixed(1) + ", them " + e.lossB.toFixed(1) + ".";
      (e.pWin < 0.4 ? w : info).push(line);
    }
    var gIn = C.total(tot, function (x) { return x.dom === "ground"; });
    if (u === "D" && !s.baseRevealed && C.hunterCandidates(g).indexOf(sys) >= 0) (gIn ? info : w).push(gIn ? "Ground units landing here search " + nm(sys) + "." : "Ships alone cannot search. Bring ground units.");
    if (w.length) h += "<div class='warn'>" + w.join("<br>") + "</div>";
    if (info.length) h += "<div class='okay'>" + info.join("<br>") + "</div>";
    return h + "<div class='row'><button class='btn primary' data-act='confirmMove'" + (bad ? " disabled" : "") + ">Activate " + nm(sys) + "</button><button class='btn ghost' data-act='cancel'>Cancel</button></div>";
  }

  function opposePanel() {
    var g = A.g, p = g.s.pending, u = A.user, Mi = M[p.id], names = p.leaders.map(function (id) { return C.leader(g, id).name; }).join(" and ");
    var where = p.id === "seize" ? C.leader(g, p.captive).name + " in " + nm(p.sys) : (typeof p.sys === "number" ? nm(p.sys) : "");
    var h = "<h2>Oppose this mission?</h2><p><b>" + esc(names) + "</b> " + (p.leaders.length > 1 ? "attempt" : "attempts") + " <b>" + esc(Mi.name) + "</b>" + (where ? " at " + esc(where) : "") + " with " + dice(p.dice, SK[Mi.skill]) + ".</p><p class='small'>" + esc(Mi.text) + "</p><div class='btnlist'>";
    C.leadersOf(g, u, "pool").forEach(function (O) {
      var stop = 1 - C.missionOdds(p.dice, O[Mi.skill]);
      h += "<button class='btn block' data-act='oppose' data-l='" + O.id + "'>Oppose with " + esc(O.name) + " · " + pct(stop) + " to stop it<span class='sub'>" + dice(O[Mi.skill], SK[Mi.skill]) + ". Goes to " + (where ? esc(nm(p.sys)) : "the target") + (typeof p.sys === "number" && C.anyUnits(g, p.sys, u) ? " and pins your units there" : "") + ".</span></button>";
    });
    return h + "<button class='btn block ghost' data-act='oppose' data-l=''>Let it succeed</button></div>";
  }

  function unitRows(list) {
    var by = {}; list.forEach(function (x) { (by[x.t] = by[x.t] || []).push(x.dmg); });
    return Object.keys(U).filter(function (t) { return by[t]; }).map(function (t) {
      var dmg = by[t].filter(function (d) { return d > 0; });
      return "<span class='urow'>" + by[t].length + " " + C.plural(U[t].name.toLowerCase(), by[t].length) + (dmg.length ? " <span class='badtxt'>(" + dmg.map(function (d) { return d + "/" + U[t].hp + " dmg"; }).join(", ") + ")</span>" : "") + "</span>";
    }).join("") || "<span class='urow small'>none</span>";
  }
  function battlePanel(mine) {
    var g = A.g, s = g.s, b = s.battle, u = A.user, foe = C.other(u), h;
    h = "<h2>Battle at " + nm(b.sys) + "</h2><p class='small'>Round " + (b.round + 1) + (b.atBase ? " · the revealed base: bunkers cancel one hit on Insurgent ground units each round" : "") + "</p>";
    h += "<div class='bgrid'><div><h3 class='" + (u === "I" ? "reb" : "imp") + "'>You</h3>" + unitRows(b.units[u]) + "</div><div><h3 class='" + (u === "I" ? "imp" : "reb") + "'>" + SIDE[foe] + "</h3>" + unitRows(b.units[foe]) + "<span class='small'>Tactic cards: " + (b.hands[foe].space.length + b.hands[foe].ground.length) + "</span></div></div>";
    if (b.lastRound) { var lr = s.log.filter(function (e) { return e.kind === "round"; }).slice(-1)[0]; if (lr) h += "<p class='small'>" + esc(lr.text) + "</p>"; }
    h += "<label class='toggle'><input type='checkbox' id='autoBattle'" + (A.autoBattle ? " checked" : "") + "> Let the coach fight my battles</label>";
    if (!mine) return h + "<p class='small'>Waiting for the " + SIDE[C.decider(g) || foe] + ".</p>";
    if (b.stage === "cards") {
      if (A.ui.mode !== "battle") A.ui = { mode: "battle", choice: { space: null, ground: null } };
      ["space", "ground"].forEach(function (dom) {
        var hand = b.hands[u][dom];
        var fighting = b.units.I.some(function (x) { return U[x.t].dom === dom; }) && b.units.D.some(function (x) { return U[x.t].dom === dom; });
        if (!fighting) return;
        h += "<div class='tac'><b>" + (dom === "space" ? "Space" : "Ground") + "</b>" + (hand.length ? "" : " <span class='small'>no tactic cards (no leader with " + dom + " tactics here)</span>") + "<div class='opts'>";
        hand.forEach(function (c, k) { h += "<button data-act='tac' data-dom='" + dom + "' data-k='" + k + "' aria-pressed='" + (A.ui.choice[dom] === k) + "' title='" + esc(C.TAC[c].text) + "'>" + esc(C.TAC[c].name) + "</button>"; });
        h += "</div>" + (A.ui.choice[dom] != null ? "<span class='small'>" + esc(C.TAC[hand[A.ui.choice[dom]]].text) + "</span>" : "") + "</div>";
      });
      return h + "<button class='btn primary' data-act='fight'>Fight round " + (b.round + 1) + "</button>";
    }
    var tg = C.retreatTargets(g, u), mineSt = C.collapse(b.units[u]), theirs = C.collapse(b.units[foe]);
    var e = u === "I" ? B.estBattle(mineSt, theirs, { plans: s.plans }, 120) : B.estFor(g, "D", mineSt, theirs, b.sys, 0, 0);
    h += "<p>Retreat or keep fighting? If you stay: about <b>" + pct(e.pWin) + "</b> to win.</p><div class='btnlist'><button class='btn block primary' data-act='stay'>Keep fighting</button>";
    tg.forEach(function (t) { h += "<button class='btn block' data-act='retreat' data-sys='" + t + "'>Retreat to " + nm(t) + "</button>"; });
    if (u === "I" && b.atBase) h += "<div class='warn'>Retreating from the base with Dominion ground units here hands it over.</div>";
    return h + "</div>";
  }

  function buildPanel() {
    var g = A.g, s = g.s, u = A.user, pts = s.points[u];
    if (A.ui.mode !== "build") { A.ui = { mode: "build", orders: {}, site: { space: pts.sites.space[0], ground: u === "I" && pts.sites.ground.indexOf("base") >= 0 ? "base" : pts.sites.ground[0] } }; }
    var ord = A.ui.orders, spend = { space: 0, ground: 0 };
    Object.keys(ord).forEach(function (t) { spend[U[t].dom] += U[t].cost * ord[t]; });
    var h = "<h2>Build</h2><p class='small'>Shipyard icons give space points, barracks icons ground points, on loyal systems that are not sabotaged or contested. Points you don't spend are lost.</p>";
    ["space", "ground"].forEach(function (dom) {
      var left = pts[dom] - spend[dom];
      h += "<div class='origin'><div class='row between'><b>" + (dom === "space" ? "Space" : "Ground") + "</b><span class='mono small" + (left < 0 ? " badtxt" : "") + "'>" + left + " of " + pts[dom] + " points left</span></div>";
      if (pts.sites[dom].length) h += "<div class='row'><label class='small' for='site-" + dom + "'>Deploy at</label><select class='lsel' id='site-" + dom + "'>" + pts.sites[dom].map(function (x) { return "<option value='" + x + "'" + (String(A.ui.site[dom]) === String(x) ? " selected" : "") + ">" + esc(nm(x)) + "</option>"; }).join("") + "</select></div>";
      C.BUILDABLE[u].filter(function (t) { return U[t].dom === dom; }).forEach(function (t) {
        var n = ord[t] || 0;
        h += "<div class='mrow'><span>" + U[t].name + " <span class='small'>cost " + U[t].cost + (U[t].delay ? ", arrives in " + (U[t].delay + 1) + " rounds" : ", arrives now") + "</span></span><span class='step'><button data-act='bq' data-t='" + t + "' data-d='-1' aria-label='fewer'>−</button><output>" + n + "</output><button data-act='bq' data-t='" + t + "' data-d='1' aria-label='more'>+</button></span></div>";
      });
      h += "</div>";
    });
    var over = spend.space > pts.space || spend.ground > pts.ground;
    return h + "<button class='btn primary' data-act='submitBuild'" + (over ? " disabled" : "") + ">Confirm build</button>";
  }

  function debrief() {
    var g = A.g, s = g.s, won = s.winner === A.user;
    var h = "<h2>" + (won ? "You win" : "You lose") + "</h2><p>" + esc(s.winReason) + "</p><ul class='tight small'>";
    h += "<li>Base sites: " + s.baseHistory.map(function (b) { return nm(b.sys) + " (round " + b.round + ")"; }).join(" → ") + ".</li>";
    h += "<li>Probe cards held: " + s.probeHand.length + ". Systems searched by ground units: " + s.log.filter(function (e) { return e.kind === "search"; }).length + ".</li>";
    h += "<li>Objectives completed: " + (s.objScored.map(function (id) { return C.OBJ[id].name; }).join(", ") || "none") + ".</li>";
    h += "<li>Battles: " + s.log.filter(function (e) { return e.kind === "battleEnd"; }).length + ". Captures: " + s.log.filter(function (e) { return e.kind === "capture"; }).length + ". Superweapon: " + (s.superDead ? "destroyed" : s.superBuilt ? "built" : "never finished") + ".</li></ul>";
    return h + "<div class='btnlist'><button class='btn primary block' data-act='again'>Play again as the " + SIDE[A.user] + "</button><button class='btn block' data-act='switch'>Switch sides</button><button class='btn block ghost' data-act='menu'>Back to the start screen</button></div>";
  }

  // ------------------------------------------------------------------ records
  function renderLeaders() {
    var g = A.g, s = g.s, u = A.user, h = "<h2>Leaders</h2><div class='lsides'>";
    ["I", "D"].forEach(function (side) {
      h += "<div><h3 class='" + (side === "I" ? "reb" : "imp") + "'>" + SIDE[side] + (side === u ? " (you)" : "") + "</h3>";
      s.leaders.filter(function (L) { return L.side === side; }).forEach(function (L) {
        var st = "", cls = "pill";
        if (L.status === "pool") { st = "reserve"; cls += " go"; }
        else if (L.status === "mission") { st = side === u ? M[C.card(g, side, L.card).id].name : "hidden mission"; cls += " hid"; }
        else if (L.status === "placed") st = L.loc === "base" ? "at the base" : L.loc == null ? "returning" : "spent at " + nm(L.loc);
        else if (L.status === "captured") { st = "captured"; cls += " bad"; }
        h += "<div class='lrow'><span>" + esc(L.name) + " <span class='stats'>" + skills(L) + " · tactics " + L.sp + " space / " + L.gr + " ground</span></span><span class='" + cls + "'>" + esc(st) + "</span></div>";
      });
      h += "</div>";
    });
    h += "</div>";
    if (!A.preview && s.phase !== "setup") h += "<p class='small'>" + (s.baseRevealed ? "The base at " + nm(s.base) + " is revealed." : "Hidden base" + (A.user === "I" ? " at <b>" + nm(s.base) + "</b>" : "") + ": " + C.unitList(s.baseBox) + " (counts are public).") + "</p>";
    $("leadersPanel").innerHTML = h;
  }
  function renderObjectives() {
    var g = A.g, s = g.s, u = A.user, h = "<h2>Objectives</h2>";
    if (u === "I" || s.phase === "over") {
      s.objHand.forEach(function (id) { var o = C.OBJ[id], ready = !A.preview && o.test(s); h += "<div class='obj" + (ready ? " ready" : "") + "'><div class='t'><span>" + esc(o.name) + "</span><span class='mono'>stage " + o.stage + " · +" + o.val + "</span></div><span class='small'>" + esc(o.text) + "</span>" + (ready ? "<span class='pill go'>met: scores at round end</span>" : "") + "</div>"; });
      h += "<p class='small'>One per round, checked at the end of the round. " + s.objDeck.length + " cards left in the deck.</p>";
    } else h += "<p>The Insurgents hold <b>" + s.objHand.length + "</b> secret objective" + (s.objHand.length === 1 ? "" : "s") + ".</p><details><summary class='small'>What they could be</summary><div class='notes'>" + C.OBJECTIVES.map(function (o) { return "<span class='small'><b>" + esc(o.name) + "</b> (stage " + o.stage + ", +" + o.val + "): " + esc(o.text) + "</span>"; }).join("") + "</div></details>";
    if (s.objScored.length) h += "<p class='small'>Completed: " + s.objScored.map(function (id) { return esc(C.OBJ[id].name); }).join(", ") + ".</p>";
    h += "<p class='small'>Plans: " + (s.plans ? "<b class='reb'>stolen</b>" : "safe") + ". Superweapon: " + (s.superDead ? "destroyed" : s.superBuilt ? "<b class='imp'>operational</b>" : s.usedOnce.project ? "under construction" : "not started") + ".</p>";
    $("objPanel").innerHTML = h;
  }
  function renderQueue() {
    var s = A.g.s, h = "<h2>Build queue</h2>";
    if (!s.queue.length) h += "<p class='small'>Empty.</p>";
    var by = {};
    s.queue.forEach(function (q) { var k = q.side + "|" + q.type + "|" + q.sys + "|" + q.eta; by[k] = (by[k] || 0) + 1; });
    Object.keys(by).sort(function (a, b) { return +a.split("|")[3] - +b.split("|")[3]; }).forEach(function (k) {
      var p = k.split("|"), side = p[0], t = p[1], site = p[2] === "base" ? "base" : +p[2], eta = +p[3];
      h += "<div class='lrow'><span class='" + (side === "I" ? "reb" : "imp") + "'>" + by[k] + " " + C.plural(U[t].name.toLowerCase(), by[k]) + " <span class='small'>→ " + (site === "base" ? (A.user === "I" ? "hidden base" : "the hidden base") : nm(site)) + "</span></span><span class='pill'>" + (eta <= s.round ? "this Refresh" : "end of round " + eta) + "</span></div>";
    });
    $("queuePanel").innerHTML = h;
  }
  function renderInspect() {
    var g = A.g, s = g.s, i = A.inspect, h;
    if (i == null) { $("inspectPanel").innerHTML = "<h2>System</h2><p class='small'>Click a system on the map to see every unit there, its build icons and its status.</p>"; return; }
    var sy = SYS[i];
    h = "<div class='row between'><h2>" + sy.n + "</h2><span class='small'>" + C.REGIONS[sy.r] + "</span></div>";
    var tags = [];
    tags.push(sy.p ? (sy.ic.split("").map(function (c) { return c === "s" ? "shipyard" : "barracks"; }).join(", ")) : "remote");
    if (s.ruined[i]) tags.push("ruined"); else if (s.loy[i]) tags.push(SIDE[s.loy[i]] + "-loyal");
    if (s.sab[i]) tags.push("sabotaged");
    if (sy.home) tags.push("Throne Reach");
    h += "<p class='small'>" + tags.join(" · ") + "</p>";
    ["I", "D"].forEach(function (side) { if (C.total(s.u[i][side])) h += "<p><b class='" + (side === "I" ? "reb" : "imp") + "'>" + SIDE[side] + ":</b> " + C.unitList(s.u[i][side]) + "</p>"; });
    var ls = s.leaders.filter(function (L) { return L.status === "placed" && L.loc === i; });
    if (ls.length) h += "<p class='small'>Leaders here: " + ls.map(function (L) { return esc(L.name); }).join(", ") + "</p>";
    if (!sy.home && !s.baseRevealed && !A.preview) { var r = C.ruledOutReason(g, i); h += "<p class='small'>" + (r ? "Ruled out (" + r + ")." : "The base could be here, as far as the Dominion knows.") + "</p>"; }
    $("inspectPanel").innerHTML = h;
  }
  var KEY = { battleEnd: 1, reveal: 1, win: 1, objective: 1, relocate: 1, capture: 1, leak: 1, scan: 1, plans: 1, annihilate: 1 };
  function renderLog() {
    var s = A.g.s, el = $("log"), h = "";
    (A.preview ? [{ kind: "phase", text: "The campaign log appears here." }] : s.log.slice(-160)).forEach(function (e) {
      h += "<div class='le " + (e.side || "") + (e.kind === "why" ? " why" : "") + (e.kind === "phase" ? " phase" : "") + (KEY[e.kind] ? " key" : "") + "'>" + esc(e.text) + "</div>";
    });
    el.innerHTML = h; el.scrollTop = el.scrollHeight;
  }
  function render() { renderMap(); renderClock(); renderCoach(); renderAct(); renderLeaders(); renderObjectives(); renderQueue(); renderInspect(); renderLog(); }

  // ------------------------------------------------------------------ events
  function startActivation(sys) {
    var g = A.g, u = A.user, plan = B.planMoves(g, u, sys, { groundFirst: true }), moves = {};
    plan.moves.forEach(function (m) { moves[m.from] = Object.assign({}, m.units); });
    var enemy = C.anyUnits(g, sys, C.other(u)), pool = C.leadersOf(g, u, "pool").slice().sort(function (a, b) { return enemy ? (b.sp + b.gr) - (a.sp + a.gr) : (a.sp + a.gr) - (b.sp + b.gr); });
    A.ui = { mode: "moves", sys: sys, leader: pool[0].id, moves: moves, intoBase: false }; render();
  }
  function onSys(i) {
    var g = A.g, s = g.s, ui = A.ui, tg = pickTargets();
    if (!tg || !tg[i]) { A.inspect = i; render(); return; }
    if (s.phase === "setup") return userDo(function () { C.placeBase(g, i); });
    if (ui.mode === "pickActivate") return startActivation(i);
    if (ui.mode === "pickMission") {
      var t = ui.targets.filter(function (x) { return (typeof x === "object" ? x.sys : x) === i; })[0];
      var target = typeof t === "object" ? t.leader : t, card = ui.card;
      return userDo(function () { C.revealMission(g, A.user, card, target); });
    }
  }
  document.addEventListener("click", function (ev) {
    var sysEl = ev.target.closest && ev.target.closest("#map [data-sys]");
    if (sysEl) { onSys(+sysEl.getAttribute("data-sys")); return; }
    var b = ev.target.closest && ev.target.closest("[data-act]");
    if (!b || b.disabled) return;
    var act = b.getAttribute("data-act"), g = A.g, u = A.user, ui = A.ui;
    switch (act) {
      case "pickSide": A.pickSide = b.getAttribute("data-side"); render(); break;
      case "pickLvl": A.pickLvl = b.getAttribute("data-lvl"); render(); break;
      case "start": startMatch(A.pickSide, A.pickLvl); break;
      case "resume": resume(); break;
      case "again": startMatch(A.user, A.lvl); break;
      case "switch": startMatch(A.bot, A.lvl); break;
      case "menu": store.del("save"); bootPreview(); A.seen = {}; A.shown = null; A.queue = []; render(); break;
      case "suggest": suggest(); break;
      case "applySug": if (A.suggestion) A.suggestion.apply(); break;
      case "dropSug": A.suggestion = null; render(); break;
      case "nextLesson": A.shown = A.queue.length ? A.queue.shift() : null; render(); break;
      case "showLesson": A.shown = b.getAttribute("data-id"); render(); break;
      case "base": userDo(function () { C.placeBase(g, +b.getAttribute("data-sys")); }); break;
      case "team":
        var cu = +b.getAttribute("data-c"), lid = b.getAttribute("data-l"), t = ui.team[cu] = ui.team[cu] || [];
        if (t.indexOf(lid) >= 0) t.splice(t.indexOf(lid), 1); else if (t.length < 2) t.push(lid);
        render(); break;
      case "submitAssign":
        var list = Object.keys(ui.team).filter(function (k) { return ui.team[k].length; }).map(function (k) { return { card: +k, leaders: ui.team[k] }; });
        userDo(function () { C.submitAssignment(g, u, list); }); break;
      case "activate": A.ui = { mode: "pickActivate" }; A.suggestion = null; render(); break;
      case "actSys": startActivation(+b.getAttribute("data-sys")); break;
      case "reveal":
        var cid = +b.getAttribute("data-c"), tg = C.missionTargets(g, u, cid);
        if (tg.length === 1 && tg[0] === "base") { userDo(function () { C.revealMission(g, u, cid, "base"); }); break; }
        A.ui = { mode: "pickMission", card: cid, targets: tg }; A.suggestion = null; render(); break;
      case "misTarget":
        var tt = ui.targets[+b.getAttribute("data-k")], tv = typeof tt === "object" ? tt.leader : tt, cc = ui.card;
        userDo(function () { C.revealMission(g, u, cc, tv); }); break;
      case "pass": userDo(function () { C.pass(g, u); }); break;
      case "cancel": A.ui = { mode: "idle" }; render(); break;
      case "oppose": var ol = b.getAttribute("data-l") || null; userDo(function () { C.oppose(g, u, ol); }); break;
      case "mv":
        var f = b.getAttribute("data-f"), ty = b.getAttribute("data-t"), dd = +b.getAttribute("data-d");
        var o = C.origins(g, u, ui.sys).filter(function (x) { return String(x.from) === f; })[0], mv = ui.moves[f] = ui.moves[f] || {};
        mv[ty] = Math.max(0, Math.min(o.units[ty], (mv[ty] || 0) + dd)); if (!mv[ty]) delete mv[ty];
        render(); break;
      case "confirmMove":
        var mvs = Object.keys(ui.moves).map(function (fr) { return { from: fr === "base" ? "base" : +fr, units: ui.moves[fr] }; }).filter(function (x) { return C.total(x.units); });
        if (ui.intoBase) userDo(function () { C.reinforceBase(g, ui.leader, mvs.filter(function (x) { return x.from !== "base"; })); });
        else userDo(function () { C.activate(g, u, ui.leader, ui.sys, mvs); });
        break;
      case "tac":
        var dom = b.getAttribute("data-dom"), k = +b.getAttribute("data-k");
        ui.choice[dom] = ui.choice[dom] === k ? null : k; render(); break;
      case "fight": var ch = ui.choice || {}; userDo(function () { C.battleCards(g, u, ch); }); break;
      case "stay": userDo(function () { C.battleRetreat(g, u, null); }); break;
      case "retreat": var rs = +b.getAttribute("data-sys"); userDo(function () { C.battleRetreat(g, u, rs); }); break;
      case "bq":
        var bt = b.getAttribute("data-t"); ui.orders[bt] = Math.max(0, (ui.orders[bt] || 0) + +b.getAttribute("data-d")); if (!ui.orders[bt]) delete ui.orders[bt]; render(); break;
      case "submitBuild":
        var ord = Object.keys(ui.orders).map(function (tp) { return { type: tp, sys: ui.site[U[tp].dom], n: ui.orders[tp] }; });
        userDo(function () { C.submitBuild(g, u, ord); }); break;
    }
  });
  document.addEventListener("change", function (ev) {
    var t = ev.target;
    if (t.id === "overlay") { A.overlay = t.checked; render(); }
    if (t.id === "lsel") { A.ui.leader = t.value; render(); }
    if (t.id === "intoBase") { A.ui.intoBase = t.checked; render(); }
    if (t.id === "autoBattle") { A.autoBattle = t.checked; render(); pump(); }
    if (t.id === "site-space" || t.id === "site-ground") { var v = t.value; A.ui.site[t.id.slice(5)] = v === "base" ? "base" : +v; render(); }
  });
  document.addEventListener("keydown", function (ev) {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.closest && ev.target.closest("#map [data-sys]")) { ev.preventDefault(); onSys(+ev.target.getAttribute("data-sys")); }
  });

  // reference lists
  $("missionList").innerHTML = ["I", "D"].map(function (side) {
    return "<li><b class='" + (side === "I" ? "reb" : "imp") + "'>" + SIDE[side] + "</b><ul class='tight'>" + Object.keys(M).filter(function (k) { return M[k].side === side; }).map(function (k) { var m = M[k]; return "<li><b>" + esc(m.name) + "</b> <span class='small'>(" + SK[m.skill] + " " + m.need + (m.standing ? ", standing" : "") + (m.opp ? "" : ", unopposable") + ")</span>: " + esc(m.text) + "</li>"; }).join("") + "</ul></li>";
  }).join("");
  $("unitTable").innerHTML = Object.keys(U).map(function (t) { var x = U[t]; return "<tr><td class='" + (x.side === "I" ? "reb" : "imp") + "'>" + x.name + "</td><td>" + (x.dom === "space" ? (x.heavy ? "capital ship" : "fighter") : (x.heavy ? "heavy ground" : "ground")) + "</td><td class='mono'>" + x.hp + "</td><td class='mono'>" + (x.L ? x.L + " light" : "") + (x.L && x.H ? ", " : "") + (x.H ? x.H + " heavy" : "") + (x.L || x.H ? "" : "none") + "</td><td class='mono'>" + (x.cap || "") + "</td><td class='mono'>" + (x.special ? "project" : x.cost + " (" + (x.delay ? "+" + x.delay + " round" + (x.delay > 1 ? "s" : "") : "now") + ")") + "</td></tr>"; }).join("");
  $("tacList").innerHTML = ["space", "ground"].map(function (dom) { return "<li><b>" + (dom === "space" ? "Space" : "Ground") + ":</b> " + C.TACTICS[dom].map(function (t) { return esc(t[1]) + " ×" + t[3] + " <span class='small'>(" + esc(t[2]) + ")</span>"; }).join("; ") + "</li>"; }).join("");
  $("objList").innerHTML = C.OBJECTIVES.map(function (o) { return "<li><b>" + esc(o.name) + "</b> <span class='small'>(stage " + o.stage + ", +" + o.val + ")</span>: " + esc(o.text) + "</li>"; }).join("");

  bootPreview(); render();
})();
