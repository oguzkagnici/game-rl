/* Sparring drill: page controller. Renders the map, rail and records, drives the bot, runs the coach. */
(function () {
  "use strict";
  var D = window.Drill, B = window.DrillBots, LESSONS = window.DrillLessons, SYS = D.SYS, N = SYS.length;
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("rsd:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("rsd:" + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem("rsd:" + k); } catch (e) {} }
  };
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function nm(i) { return SYS[i].n; }
  function pct(p) { return Math.round(p * 100) + "%"; }
  var SIDE = { I: "Insurgents", D: "Dominion" };
  var MIS = D.MISSIONS;

  // ------------------------------------------------------------------ app state
  var A = {
    g: null, user: "I", bot: "D", lvl: "veteran",
    pickSide: "I", pickLvl: "veteran",
    ui: { mode: "idle" }, seen: {}, queue: [], shown: null, suggestion: null, busy: false, overlay: true
  };

  function bootPreview() {
    // A board at rest before any match: the starting position.
    A.g = D.newGame({ seed: 1 }); window.__g = A.g; A.preview = true;
  }

  function startMatch(side, lvl) {
    A.user = side; A.bot = D.other(side); A.lvl = lvl;
    A.g = D.newGame({}); window.__g = A.g; A.preview = false;
    A.ui = { mode: "idle" }; A.seen = {}; A.queue = []; A.shown = null; A.suggestion = null;
    D.drainEvents(A.g);
    after();
    pump();
  }

  function save() {
    if (!A.g || A.preview) return;
    store.set("save", { s: A.g.s, user: A.user, lvl: A.lvl, seen: A.seen });
  }
  function resume() {
    var sv = store.get("save", null);
    if (!sv) return false;
    A.g = D.restore(sv.s); window.__g = A.g; A.preview = false;
    A.user = sv.user; A.bot = D.other(sv.user); A.lvl = sv.lvl; A.seen = sv.seen || {};
    A.ui = { mode: "idle" }; A.queue = []; A.shown = null; A.suggestion = null;
    render(); pump();
    return true;
  }

  // ------------------------------------------------------------------ bot pump
  function botDue() {
    var s = A.g.s, b = A.bot;
    if (A.preview || s.winner) return false;
    if (s.phase === "setup") return b === "I";
    if (s.phase === "assign") return !s.assigned[b];
    if (s.phase === "command") {
      if (s.pending) return D.other(s.pending.side) === b;
      return s.turn === b;
    }
    return false;
  }
  function addWhy(at, side, text) {
    if (!text) return;
    A.g.s.log.splice(at, 0, { round: A.g.s.round, side: side, kind: "why", text: text });
  }
  function botStep() {
    var g = A.g, s = g.s, b = A.bot, lvl = A.lvl, at = s.log.length;
    if (s.phase === "setup") { var pb = B.Ins.placeBase(g, lvl); D.placeBase(g, pb.sys); return; }
    if (s.phase === "assign") { D.submitAssignment(g, b, B.BOT[b].assign(g, lvl).list); return; }
    if (s.pending) { var op = B.BOT[b].oppose(g, lvl); D.oppose(g, b, op.leader); if (op.leader) addWhy(at + 1, b, op.why); return; }
    var a = B.BOT[b].command(g, lvl);
    B.act(g, b, a);
    if (a.type !== "pass") addWhy(at, b, a.why);
  }
  function pump() {
    if (A.busy || !botDue()) return;
    A.busy = true; render();
    var s = A.g.s, delay = s.phase === "command" ? 750 : 250;
    setTimeout(function () {
      try { botStep(); } catch (e) { console.error(e); }
      A.busy = false;
      after();
      pump();
    }, delay);
  }

  // After any state change: coach checks, save, render.
  function after() {
    var ev = D.drainEvents(A.g);
    if (!A.preview) checkLessons(ev);
    A.suggestion = null;
    var s = A.g.s;
    if (A.ui.mode === "assign" && s.phase !== "assign") A.ui = { mode: "idle" };
    if (A.ui.mode !== "idle" && A.ui.mode !== "assign" && !(s.phase === "command" && s.turn === A.user && !s.pending)) A.ui = { mode: "idle" };
    save();
    render();
  }

  function userDo(fn) {
    try { fn(); } catch (e) { flash(e.message); return; }
    A.ui = { mode: "idle" };
    after(); pump();
  }
  var flashMsg = null;
  function flash(t) { flashMsg = t; render(); setTimeout(function () { flashMsg = null; render(); }, 3500); }

  // ------------------------------------------------------------------ coach
  function checkLessons(ev) {
    var ctx = { g: A.g, s: A.g.s, user: A.user, ev: ev };
    LESSONS.forEach(function (L) {
      if (A.seen[L.id]) return;
      var hit = false;
      try { hit = L.when(ctx); } catch (e) { hit = false; }
      if (hit) {
        A.seen[L.id] = { round: A.g.s.round, html: L.body(A.user) };
        A.queue.push(L.id);
      }
    });
    if (!A.shown && A.queue.length) A.shown = A.queue.shift();
  }
  function lessonById(id) { for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return LESSONS[i]; return null; }

  function suggest() {
    var g = A.g, s = g.s, u = A.user, BOT = B.BOT[u];
    if (s.phase === "setup" && u === "I") {
      var pb = B.Ins.placeBase(g, "veteran");
      A.suggestion = { text: "Hide the base at <b>" + nm(pb.sys) + "</b>. " + esc(pb.why), apply: function () { userDo(function () { D.placeBase(g, pb.sys); }); }, label: "Hide it at " + nm(pb.sys) };
    } else if (s.phase === "assign") {
      var as = BOT.assign(g, "veteran"), ch = {};
      as.list.forEach(function (a) { ch[a.leader] = a.mission; });
      A.suggestion = { text: esc(as.why), apply: function () { A.ui = { mode: "assign", choice: ch }; A.suggestion = null; render(); }, label: "Fill in this split" };
    } else if (s.phase === "command" && s.pending && D.other(s.pending.side) === u) {
      var op = BOT.oppose(g, "veteran");
      A.suggestion = { text: esc(op.why || "Let it through."), apply: function () { userDo(function () { D.oppose(g, u, op.leader); }); }, label: op.leader ? "Oppose with " + D.leader(g, op.leader).name : "Let it through" };
    } else if (s.phase === "command" && s.turn === u) {
      var a = BOT.command(g, "veteran");
      A.suggestion = { text: esc(a.why), apply: function () { userDo(function () { B.act(g, u, a); }); }, label: a.type === "pass" ? "Pass" : "Do it" };
    }
    render();
  }

  // ------------------------------------------------------------------ rendering: map
  var EDGE_LIST = [];
  SYS.forEach(function (a) { a.adj.forEach(function (b) { if (a.id < b) EDGE_LIST.push([a.id, b]); }); });

  function pickTargets() {
    var g = A.g, s = g.s, ui = A.ui, out = {};
    if (A.preview) return null;
    if (s.phase === "setup" && A.user === "I") { D.validBaseSites(g).forEach(function (i) { out[i] = 1; }); return out; }
    if (ui.mode === "pickActivate") { activationTargets().forEach(function (i) { out[i] = 1; }); return out; }
    if (ui.mode === "pickMission") { ui.targets.forEach(function (t) { out[typeof t === "number" ? t : t.sys] = 1; }); return out; }
    return null;
  }
  function activationTargets() {
    var g = A.g, s = g.s, u = A.user, out = [];
    for (var i = 0; i < N; i++) {
      if (!D.activatable(g, u, i)) continue;
      if (D.origins(g, u, i).length || (u === "D" && s.sab[i] && s.loy[i] === "D")) out.push(i);
    }
    return out;
  }

  function chip(side, sh, tr, x, y) {
    if (!sh && !tr) return "";
    var w = 6 + (sh ? 26 : 0) + (tr ? 26 : 0), h = "", cx = x + 4;
    h += "<g class='chip chip-" + side + "'><rect x='" + x + "' y='" + (y - 9) + "' width='" + w + "' height='18' rx='4'/>";
    if (sh) { h += "<path class='ico' d='M" + (cx + 1) + " " + (y + 4) + " L" + (cx + 5) + " " + (y - 5) + " L" + (cx + 9) + " " + (y + 4) + "Z'/><text x='" + (cx + 11) + "' y='" + (y + 4.5) + "'>" + sh + "</text>"; cx += 26; }
    if (tr) { h += "<rect class='ico' x='" + (cx + 1) + "' y='" + (y - 4) + "' width='8' height='8' style='fill:var(--on-accent)'/><text x='" + (cx + 11) + "' y='" + (y + 4.5) + "'>" + tr + "</text>"; }
    return h + "</g>";
  }
  function chipW(sh, tr) { return (sh || tr) ? 6 + (sh ? 26 : 0) + (tr ? 26 : 0) : 0; }

  function renderMap() {
    var g = A.g, s = g.s, v = D.view(g, A.user), tg = pickTargets(), h = "";
    var showOverlay = A.overlay && !A.preview && s.phase !== "setup" && s.phase !== "over" && !s.baseRevealed;
    var cands = {}; if (showOverlay) v.candidates.forEach(function (i) { cands[i] = 1; });
    EDGE_LIST.forEach(function (e) { var a = SYS[e[0]], b = SYS[e[1]]; h += "<line class='edge' x1='" + a.x + "' y1='" + a.y + "' x2='" + b.x + "' y2='" + b.y + "'/>"; });
    var oldBases = {};
    if (A.user === "I" || s.phase === "over") s.baseHistory.forEach(function (b) { if (b.sys !== s.base) oldBases[b.sys] = 1; });
    else s.log.forEach(function (e) { if (e.kind === "relocate" && e.data) oldBases[e.data.old] = 1; });
    SYS.forEach(function (sy) {
      var i = sy.id, u = s.u[i], cls = ["sys"];
      if (!sy.p) cls.push("remote");
      if (s.loy[i] === "I") cls.push("loy-I"); else if (s.loy[i] === "D") cls.push("loy-D");
      if (tg) cls.push(tg[i] ? "pick" : "dim");
      if (A.ui.mode === "moves" && A.ui.sys === i) cls.push("sel");
      var reason = showOverlay && !sy.core ? D.ruledOutReason(g, i) : null;
      if (reason) cls.push("out");
      var label = sy.n + (sy.p ? ", populous" : ", remote") + (s.loy[i] ? ", " + SIDE[s.loy[i]] + "-loyal" : "");
      h += "<g class='" + cls.join(" ") + "' data-sys='" + i + "' transform='translate(" + sy.x + "," + sy.y + ")'" + (tg && tg[i] ? " tabindex='0' role='button' aria-label='" + esc(label) + "'" : "") + ">";
      if (cands[i]) h += "<circle class='cand' r='26'/>";
      if (tg && tg[i]) h += "<circle class='pickring' r='29'/>";
      if (sy.core) h += "<circle class='core-ring' r='25'/>";
      h += "<circle class='body' r='" + (sy.p ? 20 : 15) + "'/>";
      if (sy.throne) h += "<path class='star' d='M0 -9 L2.6 -2.8 L9 -2.8 L3.9 1.2 L5.8 7.6 L0 3.8 L-5.8 7.6 L-3.9 1.2 L-9 -2.8 L-2.6 -2.8Z'/>";
      if (v.base === i) h += "<path class='basemark' d='M-8 7 L-8 -1 L0 -8 L8 -1 L8 7Z'/>";
      else if (oldBases[i]) h += "<path class='basemark-old' d='M-7 6 L-7 -1 L0 -7 L7 -1 L7 6Z'/>";
      if (s.sab[i]) h += "<g class='sab' transform='translate(16,14)'><circle r='8'/><text y='3.5'>S</text></g>";
      h += "<text class='nm' y='" + (sy.p ? 44 : 39) + "'>" + sy.n + "</text>";
      if (reason) h += "<text class='why' y='" + (sy.p ? 57 : 52) + "'>" + ({ probe: "probe card", searched: "searched", excluded: "start rule", movement: "movement" }[reason] || reason) + "</text>";
      else if (cands[i]) h += "<text class='why' y='" + (sy.p ? 57 : 52) + "' style='fill:var(--clock)'>possible</text>";
      var wI = chipW(u.Is, u.It), wD = chipW(u.Ds, u.Dt);
      if (wI && wD) { h += chip("I", u.Is, u.It, -wI - 2, -33); h += chip("D", u.Ds, u.Dt, 2, -33); }
      else if (wI) h += chip("I", u.Is, u.It, -wI / 2, -33);
      else if (wD) h += chip("D", u.Ds, u.Dt, -wD / 2, -33);
      // leaders standing here
      var li = 0, ld = 0;
      s.leaders.forEach(function (L) {
        if (L.status !== "placed" || L.loc !== i) return;
        var x = L.side === "I" ? -31 : 31, y = 2 + (L.side === "I" ? li++ : ld++) * 16;
        h += "<g class='ldr ldr-" + L.side + "' transform='translate(" + x + "," + y + ")'><title>" + esc(L.name) + "</title><circle r='8'/><text y='3.5'>" + L.name.split(" ").map(function (w) { return w[0]; }).join("") + "</text></g>";
      });
      h += "</g>";
    });
    $("map").innerHTML = h;
    var lab = $("overlayLabel");
    lab.textContent = A.user === "D" ? "Show where the base could be" : "Show what the hunter knows";
  }

  // ------------------------------------------------------------------ rendering: clock
  function renderClock() {
    var s = A.g.s, h = "";
    for (var i = 1; i <= 16; i++) {
      h += "<div class='cell" + (i > s.time && i < s.rep ? " gap" : "") + "'>" + i;
      if (i === s.time) h += "<span class='tok t' title='Time'>T</span>";
      if (i === s.rep) h += "<span class='tok r' title='Reputation'>R</span>";
      h += "</div>";
    }
    $("track").innerHTML = h;
    var gp = Math.max(0, s.rep - s.time);
    $("gapNum").textContent = gp;
    $("gapText").textContent = (gp === 1 ? "round" : "rounds") + " left for the Dominion if the Insurgents never score again. Each objective takes one or two more.";
    $("roundLabel").textContent = A.preview ? "Starting position" : "Round " + s.round;
  }

  // ------------------------------------------------------------------ rendering: coach
  function renderCoach() {
    var h = "<div class='row between'><h2>Coach</h2>";
    var canSuggest = !A.preview && !A.g.s.winner && !A.busy && userDecision();
    h += canSuggest ? "<button class='btn' data-act='suggest'>What would a veteran do?</button>" : "";
    h += "</div>";
    if (A.suggestion) {
      h += "<div class='suggest'><div>" + A.suggestion.text + "</div><div class='row'><button class='btn primary' data-act='applySug'>" + esc(A.suggestion.label) + "</button><button class='btn ghost' data-act='dropSug'>Dismiss</button></div></div>";
    }
    if (A.preview) {
      h += "<div class='lesson'><h3>Pick a side to begin</h3><p>New to Rebellion? Start as the <b class='reb'>Insurgents</b>: hiding, scoring and timing a relocation teach the most about how the clock works. Then switch sides and hunt.</p><p>The coach will step in each time a new idea comes up, and the button above shows what an experienced player would do in your position, with the reason.</p></div>";
    } else if (A.shown) {
      var L = lessonById(A.shown), seen = A.seen[A.shown];
      h += "<div class='lesson'><span class='eyebrow'>Lesson · round " + seen.round + "</span><h3>" + esc(L.title) + "</h3>" + seen.html +
        "<div class='table-note'><b>At the Rebellion table</b>" + esc(L.table) + "</div>";
      h += "<div class='row'><button class='btn' data-act='nextLesson'>" + (A.queue.length ? "Next lesson (" + A.queue.length + " more)" : "Got it") + "</button></div></div>";
    } else {
      h += "<p class='small'>" + esc(statusLine()) + "</p>";
    }
    var ids = Object.keys(A.seen);
    if (ids.length && !A.preview) {
      h += "<details><summary class='small'>Field notes (" + ids.length + " lessons)</summary><div class='notes'>" +
        ids.map(function (id) { return "<button data-act='showLesson' data-id='" + id + "'>" + esc(lessonById(id).title) + "</button>"; }).join("") + "</div></details>";
    }
    $("coachPanel").innerHTML = h;
  }
  function userDecision() {
    var s = A.g.s, u = A.user;
    if (s.phase === "setup") return u === "I";
    if (s.phase === "assign") return !s.assigned[u];
    if (s.phase === "command") return s.pending ? D.other(s.pending.side) === u : s.turn === u;
    return false;
  }
  function statusLine() {
    var s = A.g.s, g = A.g;
    if (s.winner) return "Match over. See the debrief below.";
    var c = D.hunterCandidates(g).length;
    if (A.user === "I") return "The Dominion has " + c + " candidate system" + (c === 1 ? "" : "s") + " for your base. Gap: " + (s.rep - s.time) + " rounds.";
    return "Your base search: " + c + " candidate system" + (c === 1 ? "" : "s") + " left. Gap: " + (s.rep - s.time) + " rounds.";
  }

  // ------------------------------------------------------------------ rendering: action panel
  function renderAct() {
    var g = A.g, s = g.s, u = A.user, h = "";
    if (A.preview) h = startPanel();
    else if (s.winner) h = debrief();
    else if (A.busy || botDue()) h = "<h2>" + SIDE[A.bot] + " are moving</h2><p class='small'>Watch the map and the log. Its reasoning appears in italics.</p>";
    else if (s.phase === "setup") h = "<h2>Hide your base</h2><p>Click a highlighted system on the map, or pick one here. Your base cannot start in or next to a system with units.</p><div class='opts'>" +
      D.validBaseSites(g).map(function (i) { return "<button data-act='base' data-sys='" + i + "'>" + nm(i) + (SYS[i].p ? "" : " (remote)") + "</button>"; }).join("") + "</div>";
    else if (s.phase === "assign") h = assignPanel();
    else if (s.phase === "command" && s.pending && D.other(s.pending.side) === u) h = opposePanel();
    else if (s.phase === "command" && s.turn === u) h = commandPanel();
    else h = "<p class='small'>Waiting.</p>";
    if (flashMsg) h = "<div class='warn'><b>Not allowed:</b> " + esc(flashMsg) + "</div>" + h;
    $("actPanel").innerHTML = h;
    $("phaseLabel").textContent = A.preview ? "Starting position" : s.winner ? "Match over" : ({ setup: "Setup", assign: "Assignment phase", command: "Command phase", refresh: "Refresh" }[s.phase] || s.phase) + " · you are the " + SIDE[u];
  }

  function startPanel() {
    var sv = store.get("save", null), h = "<h2>New sparring match</h2>";
    if (sv && sv.s && !sv.s.winner) h += "<button class='btn block primary' data-act='resume'>Continue your match<span class='sub'>Round " + sv.s.round + " as the " + SIDE[sv.user] + "</span></button>";
    h += "<div class='sides'>" +
      "<button class='sidecard' style='--c:var(--rebel)' data-act='pickSide' data-side='I' aria-pressed='" + (A.pickSide === "I") + "'><h3>Insurgents</h3><p>Plays like the Rebels. Hide a base, score objectives, and relocate before the net closes.</p></button>" +
      "<button class='sidecard' style='--c:var(--empire)' data-act='pickSide' data-side='D' aria-pressed='" + (A.pickSide === "D") + "'><h3>Dominion</h3><p>Plays like the Empire. Combine probe cards and troop landings to find the base before time runs out.</p></button></div>";
    h += "<div class='row between'><span class='small'>Opponent</span><span class='seg'>" +
      ["recruit", "veteran"].map(function (l) { return "<button data-act='pickLvl' data-lvl='" + l + "' aria-pressed='" + (A.pickLvl === l) + "'>" + (l === "recruit" ? "Recruit" : "Veteran") + "</button>"; }).join("") + "</span></div>";
    h += "<button class='btn primary block' data-act='start'>Start as the " + SIDE[A.pickSide] + "</button>";
    return h;
  }

  function poolOf(side, st) { return D.leadersOf(A.g, side, st); }

  function assignPanel() {
    var g = A.g, u = A.user, pool = poolOf(u, "pool");
    if (A.ui.mode !== "assign") A.ui = { mode: "assign", choice: {} };
    var ch = A.ui.choice, types = D.missionTypes(u), h = "<h2>Assign your leaders</h2><p class='small'>Missions are face down until you reveal them in the Command phase. Reserve leaders can activate a system or oppose.</p><div>";
    pool.forEach(function (L) {
      var cur = ch[L.id] || "reserve";
      h += "<div class='arow'><div class='aname'><b>" + esc(L.name) + "</b><span class='stats'>intrigue " + L.int + " · tactics " + L.tac + "</span></div><div class='opts'>";
      h += "<button data-act='choose' data-l='" + L.id + "' data-m='reserve' aria-pressed='" + (cur === "reserve") + "'>Reserve</button>";
      types.forEach(function (t) {
        var dis = t === "relocate" && (L.int < 2 || Object.keys(ch).some(function (k) { return k !== L.id && ch[k] === "relocate"; }));
        h += "<button data-act='choose' data-l='" + L.id + "' data-m='" + t + "' aria-pressed='" + (cur === t) + "'" + (dis ? " disabled title='Needs intrigue 2+, one per round'" : "") + ">" + MIS[t].name + "</button>";
      });
      h += "</div></div>";
    });
    h += "</div>";
    // live advice
    var nMis = pool.filter(function (L) { return ch[L.id] && ch[L.id] !== "reserve"; }).length, res = pool.length - nMis;
    var w = [];
    if (res === 0) w.push("<b>No reserve.</b> You will not be able to move units or oppose a single mission this round.");
    if (u === "D" && nMis > pool.length / 2) w.push("<b>Mission-heavy.</b> Troops find bases, and moving troops takes reserve leaders.");
    if (u === "I") {
      var dg = B.danger(g);
      var hasRel = Object.keys(ch).some(function (k) { return ch[k] === "relocate"; });
      if (dg.lvl >= 2 && !hasRel) w.push("<b>Danger:</b> " + esc(dg.why) + ". Consider a Relocate.");
      Object.keys(ch).forEach(function (k) { var L = D.leader(g, k); if (ch[k] === "sabotage" && !D.missionTargets(g, "I", "sabotage").length) w.push("No system can be sabotaged right now."); if (L && L.int === 1 && ch[k] !== "reserve") w.push("<b>" + esc(L.name) + "</b> rolls one intrigue die; an opposed mission will usually fail."); });
    }
    if (w.length) h += "<div class='warn'>" + w.join("<br>") + "</div>";
    h += "<div class='row'><button class='btn primary' data-act='submitAssign'>Confirm: " + nMis + " on missions, " + res + " in reserve</button></div>";
    return h;
  }

  function opposePanel() {
    var g = A.g, s = g.s, p = s.pending, Att = D.leader(g, p.leader), u = A.user;
    var what = p.type === "hunt" ? "Hunt for " + D.leader(g, p.huntLeader).name + " in " + nm(p.sys) : MIS[p.type].name + " at " + nm(p.sys);
    var h = "<h2>Oppose this mission?</h2><p><b>" + esc(Att.name) + "</b> (intrigue " + Att.int + ") attempts <b>" + esc(what) + "</b>.</p><p class='small'>" + esc(MIS[p.type].blurb) + "</p><div class='btnlist'>";
    poolOf(u, "pool").forEach(function (O) {
      var stop = 1 - D.missionOdds(Att.int, O.int), pinned = D.anyUnits(g, p.sys, u), exposed = u === "I" && D.anyUnits(g, p.sys, "D") && D.leadersOf(g, "D", "mission").length;
      h += "<button class='btn block' data-act='oppose' data-l='" + O.id + "'>Oppose with " + esc(O.name) + " · " + pct(stop) + " to stop it<span class='sub'>" + O.int + " dice. Goes to " + nm(p.sys) + (pinned ? " and pins your units there" : "") + (exposed ? "; it could be hunted there" : "") + ".</span></button>";
    });
    h += "<button class='btn block ghost' data-act='oppose' data-l=''>Let it succeed<span class='sub'>Keep your leaders for something else.</span></button></div>";
    return h;
  }

  function commandPanel() {
    var g = A.g, s = g.s, u = A.user, ui = A.ui, h = "";
    if (ui.mode === "moves") return movesPanel();
    if (ui.mode === "pickActivate") {
      return "<h2>Activate which system?</h2><p class='small'>Click a highlighted system. Your units next to it can move in. A battle follows if enemies are there.</p><div class='opts'>" +
        activationTargets().map(function (i) { return "<button data-act='actSys' data-sys='" + i + "'>" + nm(i) + "</button>"; }).join("") + "</div><button class='btn ghost' data-act='cancel'>Cancel</button>";
    }
    if (ui.mode === "pickMission") {
      var L = D.leader(g, ui.leader);
      h = "<h2>" + MIS[ui.type].name + ": pick a target</h2><p class='small'>" + esc(MIS[ui.type].blurb) + "</p>";
      if (ui.type === "relocate") h += "<p class='small'>Highlighted: systems the hunter has not ruled out with a probe card and that hold no Dominion units. Your choice stays secret.</p>";
      h += "<div class='opts'>" + ui.targets.map(function (t) {
        if (typeof t === "object") return "<button data-act='misTarget' data-t='" + t.leader + "'>" + esc(D.leader(g, t.leader).name) + " at " + nm(t.sys) + "</button>";
        return "<button data-act='misTarget' data-t='" + t + "'>" + nm(t) + "</button>";
      }).join("") + "</div>";
      var warn = missionWarn(L, ui);
      if (warn) h += "<div class='warn'>" + warn + "</div>";
      return h + "<button class='btn ghost' data-act='cancel'>Cancel</button>";
    }
    var pool = poolOf(u, "pool"), mis = poolOf(u, "mission"), opp = D.other(u);
    h = "<h2>Your turn</h2><p class='small'>" + SIDE[opp] + ": " + poolOf(opp, "pool").length + " in reserve, " + poolOf(opp, "mission").length + " on hidden missions.</p><div class='btnlist'>";
    if (pool.length) h += "<button class='btn block' data-act='activate'>Activate a system<span class='sub'>Use one of " + pool.length + " reserve leader" + (pool.length === 1 ? "" : "s") + " to move units in and fight.</span></button>";
    mis.forEach(function (L) {
      var t = D.missionTargets(g, u, L.mission, L.id);
      h += "<button class='btn block' data-act='reveal' data-l='" + L.id + "'" + (t.length ? "" : " disabled") + ">Reveal " + MIS[L.mission].name + " (" + esc(L.name) + ")<span class='sub'>" + (t.length ? esc(MIS[L.mission].blurb) : "No valid target right now.") + "</span></button>";
    });
    h += "<button class='btn block ghost' data-act='pass'>Pass<span class='sub'>" + (poolOf(opp, "mission").length && pool.length ? "Holding a reserve leader lets you oppose what is still hidden." : "End your part of the round if the other side also passes.") + "</span></button></div>";
    return h;
  }

  function missionWarn(L, ui) {
    var g = A.g, u = A.user, w = [];
    if (u === "I" && (ui.type === "sway" || ui.type === "sabotage") && D.leadersOf(g, "D", "mission").length) {
      var risky = ui.targets.filter(function (t) { return D.anyUnits(g, t, "D"); });
      if (risky.length) w.push("Targets holding Dominion units (" + risky.map(nm).join(", ") + ") leave " + esc(L.name) + " exposed to a Hunt.");
    }
    return w.join("<br>");
  }

  function movesPanel() {
    var g = A.g, s = g.s, u = A.user, ui = A.ui, sys = ui.sys, h = "";
    var orig = D.origins(g, u, sys), pool = poolOf(u, "pool");
    h += "<h2>Activate " + nm(sys) + "</h2>";
    h += "<div class='row'><label class='small' for='lsel'>Leader</label><select class='lsel' id='lsel' data-act='leaderSel'>" + pool.map(function (L) { return "<option value='" + L.id + "'" + (L.id === ui.leader ? " selected" : "") + ">" + esc(L.name) + " (tactics " + L.tac + ")</option>"; }).join("") + "</select></div>";
    h += "<div>";
    orig.forEach(function (o) {
      var m = ui.moves[o.from] || { s: 0, t: 0 };
      var label = o.from === "base" ? "<b class='reb'>Hidden base</b>" : "From " + nm(o.from);
      h += "<div class='mrow'><span>" + label + "</span>" +
        "<span class='step'><button data-act='mv' data-f='" + o.from + "' data-k='s' data-d='-1' aria-label='fewer ships'>−</button><output>▲" + m.s + "/" + o.s + "</output><button data-act='mv' data-f='" + o.from + "' data-k='s' data-d='1' aria-label='more ships'>+</button></span>" +
        "<span class='step'><button data-act='mv' data-f='" + o.from + "' data-k='t' data-d='-1' aria-label='fewer troops'>−</button><output>■" + m.t + "/" + o.t + "</output><button data-act='mv' data-f='" + o.from + "' data-k='t' data-d='1' aria-label='more troops'>+</button></span></div>";
    });
    h += "</div><p class='small'>Each ship carries two troops.</p>";
    if (u === "I" && D.canEnterBaseBox(g, sys)) h += "<label class='toggle'><input type='checkbox' id='intoBase' data-act='intoBase'" + (ui.intoBase ? " checked" : "") + "> Move these units into the hidden base</label>";
    // preview and warnings
    var tot = { s: 0, t: 0 }, fromBase = false, bad = false;
    Object.keys(ui.moves).forEach(function (f) { var m = ui.moves[f]; tot.s += m.s; tot.t += m.t; if (f === "base" && m.s + m.t > 0) fromBase = true; if (m.t > m.s * 2) bad = true; });
    var w = [], info = [];
    if (bad) w.push("<b>Not enough ships:</b> each ship carries two troops from the same system.");
    if (fromBase) w.push("<b>This leaks.</b> Units leaving the hidden base tell the Dominion it is in " + nm(sys) + " or next to it.");
    if (ui.intoBase) w.push("<b>This gives the base away.</b> Moving into the base means activating its system, so the Dominion will know it is in " + nm(sys) + ".");
    var u0 = s.u[sys], enemy = u === "I" ? { s: u0.Ds, t: u0.Dt } : { s: u0.Is, t: u0.It };
    var mine = u === "I" ? { s: u0.Is + tot.s, t: u0.It + tot.t } : { s: u0.Ds + tot.s, t: u0.Dt + tot.t };
    if (enemy.s + enemy.t > 0 && tot.s + tot.t > 0 && !ui.intoBase) {
      var Ld = D.leader(g, ui.leader), atBase = s.baseRevealed && sys === s.base;
      var e = u === "I" ? B.estBattle(mine, enemy, Ld.tac, D.leaderTac(g, "D", sys, null), atBase ? 3 : 4, 4, 300) : B.estBattle(mine, enemy, Ld.tac, D.leaderTac(g, "I", sys, null), 4, atBase ? 3 : 4, 300);
      var line = "Battle against " + D.unitStr(enemy.s, enemy.t) + ": about <b>" + pct(e.pWin) + "</b> to wipe them out. Expected losses: you " + e.lossA.toFixed(1) + ", them " + e.lossB.toFixed(1) + ".";
      (e.pWin < 0.4 ? w : info).push(line + (e.pWin < 0.4 ? " Fight only when it pays." : ""));
    }
    if (u === "D" && tot.t > 0 && !s.baseRevealed && D.hunterCandidates(g).indexOf(sys) >= 0) info.push("Troops landing here search " + nm(sys) + ".");
    if (u === "D" && tot.t === 0 && tot.s > 0 && !s.baseRevealed && D.hunterCandidates(g).indexOf(sys) >= 0) w.push("Ships alone cannot search. Bring troops.");
    if (w.length) h += "<div class='warn'>" + w.join("<br>") + "</div>";
    if (info.length) h += "<div class='okay'>" + info.join("<br>") + "</div>";
    h += "<div class='row'><button class='btn primary' data-act='confirmMove'" + (bad ? " disabled" : "") + ">Activate " + nm(sys) + "</button><button class='btn ghost' data-act='cancel'>Cancel</button></div>";
    return h;
  }

  function debrief() {
    var g = A.g, s = g.s, won = s.winner === A.user, h = "";
    h += "<h2>" + (won ? "You win" : "You lose") + "</h2><p>" + esc(s.winReason) + "</p>";
    h += "<ul class='tight small'>";
    h += "<li>Base sites: " + s.baseHistory.map(function (b) { return nm(b.sys) + " (round " + b.round + ")"; }).join(" → ") + ".</li>";
    h += "<li>Probe cards drawn: " + s.probeHand.length + ". Systems searched by troops: " + s.log.filter(function (e) { return e.kind === "search"; }).length + ".</li>";
    h += "<li>Objectives completed: " + (s.objScored.map(function (id) { return D.OBJ[id].name; }).join(", ") || "none") + ". Still in hand: " + (s.objHand.map(function (id) { return D.OBJ[id].name; }).join(", ") || "none") + ".</li>";
    h += "<li>Relocations: " + s.relocations + ". Leaks from base movement: " + s.log.filter(function (e) { return e.kind === "leak"; }).length + ".</li></ul>";
    h += "<p class='small'>" + esc(debriefTip()) + "</p>";
    h += "<div class='btnlist'><button class='btn primary block' data-act='again'>Play again as the " + SIDE[A.user] + "</button><button class='btn block' data-act='switch'>Switch sides: play the " + SIDE[A.bot] + "</button><button class='btn block ghost' data-act='menu'>Back to the start screen</button></div>";
    return h;
  }
  function debriefTip() {
    var s = A.g.s, u = A.user;
    if (u === "I") {
      if (s.winner === "I") return "Next time, try the Dominion side: hunting teaches you what the Insurgent tells look like from the other chair.";
      if (s.relocations === 0) return "The base fell without ever moving. Watch the hunter's candidate count and have a Relocate assigned before its troops are one jump away.";
      if (s.objScored.length < 3) return "Too few objectives: the clock barely moved. Plan each round around the objective you can finish soonest.";
      return "Close game. Look at the log for the round the hunter's candidate list collapsed: that is when to have moved.";
    }
    if (s.winner === "D") return "Next time, try the Insurgents: knowing what the hunter can deduce changes how you hide.";
    if (s.probeHand.length < 8) return "Few probe cards drawn. A Probe mission most rounds is cheap information.";
    return "Count the gap every round. Landings and probes together have to cover the candidates inside it.";
  }

  // ------------------------------------------------------------------ rendering: records
  function renderLeaders() {
    var g = A.g, s = g.s, u = A.user, h = "<h2>Leaders</h2>";
    ["I", "D"].forEach(function (side) {
      h += "<h3 class='" + (side === "I" ? "reb" : "imp") + "'>" + SIDE[side] + (side === u ? " (you)" : "") + "</h3><div>";
      s.leaders.filter(function (L) { return L.side === side; }).forEach(function (L) {
        var st = "", cls = "pill";
        if (L.status === "pool") { st = "reserve"; cls += " go"; }
        else if (L.status === "mission") { st = side === u || s.phase === "over" ? MIS[L.mission].name + " (face down)" : "hidden mission"; cls += " hid"; }
        else if (L.status === "placed") st = L.loc === "base" ? "at the base" : "spent at " + nm(L.loc);
        else if (L.status === "captured") { st = "captured (" + L.capturedFor + ")"; cls += " bad"; }
        else if (L.status === "future") st = "joins round " + L.from;
        h += "<div class='lrow'><span>" + esc(L.name) + " <span class='stats'>int " + L.int + " · tac " + L.tac + "</span></span><span class='" + cls + "'>" + esc(st) + "</span></div>";
      });
      h += "</div>";
    });
    var v = D.view(g, u);
    if (v.baseBox && !A.preview && s.phase !== "setup") h += "<p class='small'>" + (s.baseRevealed ? "Your base at " + nm(s.base) + " is revealed." : "Hidden base at <b>" + nm(s.base) + "</b>: " + D.unitStr(v.baseBox.s, v.baseBox.t) + " off the map.") + "</p>";
    $("leadersPanel").innerHTML = h;
  }

  function renderObjectives() {
    var g = A.g, s = g.s, u = A.user, h = "<h2>Objectives</h2>";
    if (u === "I" || s.phase === "over") {
      if (!s.objHand.length) h += "<p class='small'>No objectives in hand.</p>";
      s.objHand.forEach(function (id) {
        var o = D.OBJ[id], ready = !A.preview && o.test(s);
        h += "<div class='obj" + (ready ? " ready" : "") + "'><div class='t'><span>" + esc(o.name) + "</span><span class='mono'>+" + o.val + "</span></div><span class='small'>" + esc(o.text) + "</span>" + (ready ? "<span class='pill go'>met: scores at round end</span>" : "") + "</div>";
      });
      h += "<p class='small'>One objective per round. You draw a new card every round; " + s.objDeck.length + " left, stage II cards are worth 2.</p>";
    } else {
      h += "<p>The Insurgents hold <b>" + s.objHand.length + "</b> secret objective" + (s.objHand.length === 1 ? "" : "s") + ". They score at most one per round.</p>";
      h += "<details><summary class='small'>What they could be holding</summary><div class='notes'>" + D.OBJECTIVES.map(function (o) { return "<span class='small'><b>" + esc(o.name) + "</b> (+" + o.val + "): " + esc(o.text) + "</span>"; }).join("") + "</div></details>";
    }
    if (s.objScored.length) h += "<p class='small'>Completed: " + s.objScored.map(function (id) { return esc(D.OBJ[id].name); }).join(", ") + ".</p>";
    $("objPanel").innerHTML = h;
  }

  var KEY = { battle: 1, reveal: 1, win: 1, objective: 1, relocate: 1, capture: 1, leak: 1 };
  function renderLog() {
    var s = A.g.s, el = $("log"), h = "";
    var items = A.preview ? [{ kind: "phase", text: "The match log appears here." }] : s.log.slice(-120);
    items.forEach(function (e) {
      var c = "le " + (e.side || "") + (e.kind === "why" ? " why" : "") + (e.kind === "phase" || e.kind === "setup" ? " phase" : "") + (KEY[e.kind] ? " key" : "");
      h += "<div class='" + c + "'>" + esc(e.text) + "</div>";
    });
    var atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.innerHTML = h;
    if (atBottom || true) el.scrollTop = el.scrollHeight;
  }

  function render() {
    renderMap(); renderClock(); renderCoach(); renderAct(); renderLeaders(); renderObjectives(); renderLog();
  }

  // ------------------------------------------------------------------ events
  function startActivation(sys) {
    var g = A.g, u = A.user, plan = B.planMoves(g, u, sys);
    var moves = {}; plan.moves.forEach(function (m) { moves[m.from] = { s: m.s, t: m.t }; });
    var enemy = D.anyUnits(g, sys, D.other(u));
    var pool = poolOf(u, "pool").slice().sort(function (a, b) { return enemy ? b.tac - a.tac : a.tac - b.tac; });
    A.ui = { mode: "moves", sys: sys, leader: pool[0].id, moves: moves, intoBase: false };
    render();
  }

  function onSys(i) {
    var g = A.g, s = g.s, ui = A.ui, tg = pickTargets();
    if (!tg || !tg[i]) return;
    if (s.phase === "setup") return userDo(function () { D.placeBase(g, i); });
    if (ui.mode === "pickActivate") return startActivation(i);
    if (ui.mode === "pickMission") {
      var t = ui.targets.filter(function (x) { return (typeof x === "number" ? x : x.sys) === i; })[0];
      var target = typeof t === "number" ? t : t.leader;
      return userDo(function () { D.revealMission(g, A.user, ui.leader, target); });
    }
  }

  document.addEventListener("click", function (ev) {
    var sysEl = ev.target.closest && ev.target.closest("#map [data-sys]");
    if (sysEl) { onSys(+sysEl.getAttribute("data-sys")); return; }
    var b = ev.target.closest && ev.target.closest("[data-act]");
    if (!b || b.tagName === "SELECT" || (b.tagName === "INPUT")) return;
    var act = b.getAttribute("data-act"), g = A.g, u = A.user;
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
      case "base": userDo(function () { D.placeBase(g, +b.getAttribute("data-sys")); }); break;
      case "choose":
        A.ui.choice[b.getAttribute("data-l")] = b.getAttribute("data-m");
        if (b.getAttribute("data-m") === "reserve") delete A.ui.choice[b.getAttribute("data-l")];
        render(); break;
      case "submitAssign":
        var ch = A.ui.choice, list = Object.keys(ch).map(function (k) { return { leader: k, mission: ch[k] }; });
        userDo(function () { D.submitAssignment(g, u, list); }); break;
      case "oppose": var l = b.getAttribute("data-l") || null; userDo(function () { D.oppose(g, u, l); }); break;
      case "activate": A.ui = { mode: "pickActivate" }; A.suggestion = null; render(); break;
      case "actSys": startActivation(+b.getAttribute("data-sys")); break;
      case "reveal":
        var L = D.leader(g, b.getAttribute("data-l"));
        A.ui = { mode: "pickMission", leader: L.id, type: L.mission, targets: D.missionTargets(g, u, L.mission, L.id) }; A.suggestion = null; render(); break;
      case "misTarget":
        var t = b.getAttribute("data-t"), tv = A.ui.type === "hunt" ? t : +t, lid = A.ui.leader;
        userDo(function () { D.revealMission(g, u, lid, tv); }); break;
      case "pass": userDo(function () { D.pass(g, u); }); break;
      case "cancel": A.ui = { mode: "idle" }; render(); break;
      case "mv":
        var f = b.getAttribute("data-f"), k = b.getAttribute("data-k"), d = +b.getAttribute("data-d");
        var o = D.origins(g, u, A.ui.sys).filter(function (x) { return String(x.from) === f; })[0];
        var m = A.ui.moves[f] || { s: 0, t: 0 };
        m[k] = Math.max(0, Math.min(o[k], m[k] + d));
        if (k === "s" && m.t > m.s * 2) m.t = m.s * 2;
        if (k === "t" && m.t > m.s * 2 && m.s < o.s) m.s = Math.min(o.s, Math.ceil(m.t / 2));
        A.ui.moves[f] = m; render(); break;
      case "confirmMove":
        var ui = A.ui, mv = Object.keys(ui.moves).map(function (fr) { return { from: fr === "base" ? "base" : +fr, s: ui.moves[fr].s, t: ui.moves[fr].t }; }).filter(function (x) { return x.s + x.t > 0; });
        if (ui.intoBase) userDo(function () { D.reinforceBase(g, ui.leader, mv.filter(function (x) { return x.from !== "base"; })); });
        else userDo(function () { D.activate(g, u, ui.leader, ui.sys, mv); });
        break;
    }
  });
  document.addEventListener("change", function (ev) {
    var t = ev.target;
    if (t.id === "overlay") { A.overlay = t.checked; render(); }
    if (t.id === "lsel") { A.ui.leader = t.value; render(); }
    if (t.id === "intoBase") { A.ui.intoBase = t.checked; render(); }
  });
  document.addEventListener("keydown", function (ev) {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.closest && ev.target.closest("#map [data-sys]")) { ev.preventDefault(); onSys(+ev.target.getAttribute("data-sys")); }
  });

  // mission reference list
  $("missionList").innerHTML = Object.keys(MIS).map(function (k) { var m = MIS[k]; return "<li><b class='" + (m.side === "I" ? "reb" : "imp") + "'>" + m.name + "</b>: " + esc(m.blurb) + "</li>"; }).join("");

  bootPreview();
  render();
})();
