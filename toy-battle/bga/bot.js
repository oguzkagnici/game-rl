// Play one Board Game Arena Toy Battle table with the trained model.
//
//   node bga/bot.js --table 123456789 [--sims 80] [--deals 4] [--dry]
//
// Logs in with BGA_USER / BGA_PASS (or reuses the saved browser profile), opens the table, says in the chat
// that this account is a bot, and on each of its decisions reloads the page, rebuilds the position from
// BGA's gamedatas, searches it with the network and sends the moves BGA's own client would send.
// --dry: read the table and print what it would do, without acting.  Every decision goes to bga/logs/.
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { TB, matchTerrain, buildState, myColour, kindOf } = require("./state.js");

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return acc;
}, []));
const TABLE = String(args.table || "");
const SIMS = +(args.sims || 80), DEALS = +(args.deals || 4), DRY = !!args.dry;
const PROFILE = args.profile || path.join(__dirname, ".profile");
const DISCLOSURE = "Hi! Just so you know: I am an AI bot (a reinforcement-learning Toy Battle model) playing as part of a " +
  "research experiment approved by Board Game Arena. Good luck and have fun!";
if (!TABLE) { console.error("usage: node bga/bot.js --table <id> [--sims N] [--deals N] [--dry]"); process.exit(2); }

const net = TB.loadNet(require(path.join(__dirname, "..", "web", "dist", "weights.json")));
let rs = (Date.now() >>> 0) || 1;
const rand32 = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return rs >>> 0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(__dirname, "logs"), { recursive: true });
const LOG = path.join(__dirname, "logs", `table-${TABLE}.jsonl`);
const log = (o) => { fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n"); };
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------------------------------------- search --
function search(s) {
  const S = TB.makeSearch(s, net, SIMS, DEALS, rand32);
  S.step(1e9);
  const ranked = [];
  for (let a = 0; a < TB.NA; a++) if (S.visits[a] > 0) ranked.push({ a, n: S.visits[a] });
  ranked.sort((x, y) => y.n - x.n);
  return { ranked, value: S.value() };
}
const actionName = (a) => {
  if (a === TB.A_DRAW) return "draw 2";
  if (a === TB.A_SKIP) return "skip";
  if (a < TB.A_BASE) { const t = Math.floor((a - TB.A_PLACE) / 17), b = (a - TB.A_PLACE) % 17; return `place ${["Kwak","Skully","Cap'n","Jumbo","Hook","XB-42","Star","Roxy"][t]} on ${b >= 15 ? "H.Q." + (b - 15) : "base " + b}`; }
  if (a < TB.A_TYPE) return `base ${a - TB.A_BASE}`;
  return `take back type ${a - TB.A_TYPE}`;
};

// ------------------------------------------------------------------------------------------------ page --
async function gameFrame(page) {
  for (let i = 0; i < 60; i++) {
    for (const f of page.frames()) {
      const ok = await f.evaluate(() => !!(window.gameui && window.gameui.gamedatas && window.gameui.gamedatas.gamestate)).catch(() => false);
      if (ok) return f;
    }
    await sleep(1000);
  }
  throw new Error("game interface did not load");
}
async function snapshot(f) {
  return f.evaluate(() => ({
    gd: JSON.parse(JSON.stringify(window.gameui.gamedatas)),
    me: String(window.gameui.player_id),
    active: !!window.gameui.isCurrentPlayerActive(),
    spectator: !!window.gameui.isSpectator,
  }));
}
async function perform(f, kind, id) {
  say(`  -> ${kind} ${id}`);
  if (DRY) return;
  await f.evaluate(([k, x]) => window.gameui.bgaPerformAction(k, { arg1: x }), [kind, id]);
}
async function postChat(page, text) {
  for (const f of page.frames()) {
    const el = await f.$(`[id^="chatbarinput_table_"][id$="_input"], textarea[id*="chatbarinput_table"]`).catch(() => null);
    if (el) { await el.fill(text); await el.press("Enter"); return true; }
  }
  return false;
}
async function login(page) {
  await page.goto("https://boardgamearena.com/account", { waitUntil: "domcontentloaded" });
  await sleep(3000);
  const u = page.locator('input[placeholder="Email or username"]:visible').first();
  if (!(await u.count())) return;                     // already logged in
  if (!process.env.BGA_USER || !process.env.BGA_PASS) throw new Error("not logged in: set BGA_USER and BGA_PASS");
  await u.fill(process.env.BGA_USER);
  await page.getByText("Next", { exact: true }).first().click();
  await sleep(2500);
  const pw = page.locator("input[type=password]:visible").first();
  await pw.fill(process.env.BGA_PASS);
  await pw.press("Enter");
  await sleep(5000);
}

// --------------------------------------------------------------------------------------- BGA element ids --
function baseIds(gd, bgaId) {
  const n = gd.board_name;
  return [`base_${n}_${bgaId}`, `blue_base_${n}_${bgaId}`, `red_base_${n}_${bgaId}`, `base_${bgaId}`];
}
function topTroopId(gd, bgaId) {
  const list = Object.values(gd.board_troops || {}).filter((t) => +t.location_arg === +bgaId).sort((a, b) => +a.ordre - +b.ordre);
  return list.length ? `troop_${list[list.length - 1].id}` : null;
}
function pickSelectable(sel, cands, bgaId) {
  for (const c of cands) if (c && sel.includes(c)) return c;
  if (bgaId !== undefined) {                          // any selectable base element ending in the id
    const hit = sel.find((x) => /base/.test(x) && x.endsWith(`_${bgaId}`));
    if (hit) return hit;
  }
  return null;
}
function slotBgaId(M, me, slot) { return slot >= 15 ? M.hqIds[1 - me][slot - 15] : M.baseId[slot]; }

// The first BGA step of engine action `a` in the current prompt, or null if BGA offers no way to do it.
function firstStep(a, ctx) {
  const { gd, M, me, sel, buttons } = ctx;
  if (a === TB.A_DRAW) {
    if (buttons.includes("btn_draw_2")) return ["actButton", "btn_draw_2"];
    const d = sel.find((x) => /_deck$/.test(x)); return d ? ["actSelect", d] : null;
  }
  if (a === TB.A_SKIP) {
    for (const b of ["btn_pass", "btn_no", "btn_continue"]) if (buttons.includes(b)) return ["actButton", b];
    return null;
  }
  if (a < TB.A_BASE) {                                // place troop t on slot
    const t = Math.floor((a - TB.A_PLACE) / 17);
    const troop = Object.values(gd.my_hand).find((x) => kindOf(x.type) === t && +x.blocked === 0 && sel.includes(`troop_${x.id}`));
    if (troop) return ["actSelect", `troop_${troop.id}`];
    if (buttons.includes("btn_place_troop")) return ["actButton", "btn_place_troop"];
    return null;
  }
  if (a < TB.A_TYPE) {                                // a base: Jumbo / recall / eruption source or destination
    const bid = M.baseId[a - TB.A_BASE];
    const id = pickSelectable(sel, [...baseIds(gd, bid), topTroopId(gd, bid)], bid);
    return id ? ["actSelect", id] : null;
  }
  const t = a - TB.A_TYPE;                            // take a troop back from our discard
  const d = Object.values(gd.my_discard || {}).find((x) => kindOf(x.type) === t && sel.includes(`troop_${x.id}`));
  return d ? ["actSelect", `troop_${d.id}`] : null;
}

// ------------------------------------------------------------------------------------------------ main --
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: !args.headed, viewport: { width: 1400, height: 1000 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await login(page);
  const url = `https://boardgamearena.com/1/toybattle?table=${TABLE}`;
  const mem = { told: false, next: null, place: null, known: [] };
  let M = null, lastKey = "", stuck = 0;
  say(`table ${TABLE}: search ${DEALS} deals x ${SIMS} simulations${DRY ? " (dry run)" : ""}`);

  for (;;) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const f = await gameFrame(page);
    let snap = await snapshot(f);
    const { gd } = snap;
    if (snap.spectator) { say("this account is not a player at this table"); break; }
    if (!M) {
      M = matchTerrain(gd);
      log({ kind: "terrain", board: gd.board_name, ok: M.ok, problems: M.problems, power: M.power });
      if (!M.ok) { say(`terrain ${gd.board_name} does not match ours:`, M.problems.join("; ")); break; }
      say(`terrain ${M.T.name} matched; playing ${myColour(gd, snap.me) === 0 ? "Blue" : "Red"}`);
    }
    if (!mem.told && !DRY) { mem.told = await postChat(page, DISCLOSURE); say(mem.told ? "posted the bot notice in the chat" : "could not find the table chat"); }
    const gs = gd.gamestate;
    if (gs.name === "gameEnd" || +gs.id === 99) { say("game over"); log({ kind: "end", players: gd.players }); break; }
    if (!snap.active) {                               // wait for our turn without reloading
      for (;;) {
        await sleep(2000);
        const st = await f.evaluate(() => ({ a: !!window.gameui.isCurrentPlayerActive(), n: window.gameui.gamedatas.gamestate.name })).catch(() => null);
        if (!st || st.a || st.n === "gameEnd") break;
      }
      continue;
    }

    const a0 = gs.args || {}, sel = a0.selectable || [], buttons = a0.buttons || [], title = a0.titleyou || a0.title || "";
    const key = JSON.stringify([title, sel, buttons, Object.keys(gd.board_troops || {}).length, gd.my_hand.length]);
    stuck = key === lastKey ? stuck + 1 : 0; lastKey = key;
    if (stuck >= 4) { say("the same prompt came back 4 times; stopping so a person can look", title); log({ kind: "stuck", title, sel, buttons }); break; }
    const me = myColour(gd, snap.me), c = { gd, M, me, sel, buttons };
    say(`prompt: ${title.replace(/<[^>]+>/g, "")} | buttons ${buttons.join(",")} | ${sel.length} selectable`);

    let step = null, note = "";
    if (/must confirm/.test(title)) step = ["actButton", ["btn_yes", "btn_continue"].find((b) => buttons.includes(b)) || buttons[0]];
    else if (/can draw 1 Troop/.test(title)) step = ["actButton", ["btn_draw_1", "btn_yes", "btn_continue"].find((b) => buttons.includes(b)) || buttons[0]];
    else if (/cannot (draw|place back)/.test(title)) step = ["actButton", ["btn_continue", "btn_pass", "btn_yes"].find((b) => buttons.includes(b)) || buttons[0]];
    else if (/point a Troop/.test(title) || /lay down/.test(title)) {
      // Battlefield: the troop is pointed at blind, so a uniformly random choice is what the engine assumes
      const opts = sel.filter((x) => /troop/.test(x));
      step = opts.length ? ["actSelect", opts[Math.floor(Math.random() * opts.length)]] : ["actButton", buttons[0]];
      note = "battlefield pin, random";
    } else if (/choose a Troop to place/.test(title) && mem.placePending != null) {
      const st = firstStep(mem.placePending, c);
      if (st && st[0] === "actSelect") { step = st; note = "troop for the planned placement"; }
      mem.placePending = null;
    } else if (/choose a base or change Troop/.test(title) && mem.place !== null) {
      const bid = slotBgaId(M, me, mem.place);
      const id = pickSelectable(sel, baseIds(gd, bid), bid);
      if (id) { step = ["actSelect", id]; note = `base for placement (slot ${mem.place})`; mem.place = null; }
    }

    if (!step) {                                      // a decision for the network
      const s = buildState(gd, M, snap.me, mem);
      const atStart = /must choose an action/.test(title) || buttons.includes("btn_draw_2");
      if (!atStart && mem.next) {                     // inside our turn: the phase our engine expects
        Object.assign(s, { phase: mem.next.phase, src: mem.next.src, nplaced: mem.next.nplaced, qi: mem.next.qi });
        s.placed = mem.next.placed.slice();
      }
      if (/destination base/.test(title)) s.phase = TB.ERUPT_DST;
      const t0 = Date.now(), res = search(s);
      let chosen = null;
      for (const r of res.ranked) { const st = firstStep(r.a, c); if (st) { chosen = r; step = st; break; } }
      if (!chosen) { say("no move the model likes can be made in this prompt; stopping", title, sel, buttons); log({ kind: "nomap", title, sel, buttons, ranked: res.ranked.slice(0, 5), dump: TB.toDump(s) }); break; }
      const after = TB.clone(s); TB.applyAction(after, chosen.a);
      mem.next = after.winner < 0 && after.turn === s.turn ? { phase: after.phase, src: after.src, placed: Array.from(after.placed), nplaced: after.nplaced, qi: after.qi } : null;
      mem.place = chosen.a >= TB.A_PLACE && chosen.a < TB.A_BASE ? (chosen.a - TB.A_PLACE) % 17 : null;
      note = `${actionName(chosen.a)}  (${chosen.n} visits${chosen !== res.ranked[0] ? `, best unmappable was ${actionName(res.ranked[0].a)}` : ""}, value ${res.value.toFixed(2)}, ${Date.now() - t0} ms)`;
      log({ kind: "decision", title, sel, buttons, phase: s.phase, action: chosen.a, name: actionName(chosen.a), value: res.value,
            ranked: res.ranked.slice(0, 6), dump: TB.toDump(s) });
      // the troop is picked first; if BGA instead wanted the "Place 1 Troop" button, the troop comes on the next prompt
      if (step[1] === "btn_place_troop") mem.placePending = chosen.a;
    }
    say(`  ${note}`);
    log({ kind: "step", step, note });
    await perform(f, step[0], step[1]);
    if (DRY) break;
    await sleep(2500);
  }
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
