// Lets the trained network play the built-in AI of "Daka Dara" (Sugarsnapp Games, 2019).
//
// The Windows release is a web game (Construct 3) wrapped in NW.js, so it also runs in a browser.
// Setup, with the installer unpacked by `innoextract` and the app zip appended to dakadara.exe unzipped:
//     cd <unpacked game folder with index.html> && python3 -m http.server 8765 --bind 127.0.0.1
//     node web/vs_dakadara.js [games=5] [sims=300] [screenshot dir] [verbose]
//
// The network plays player 1 (yellow, moves first; the game offers no other seat). Each turn the
// board is read from the game's own board array, and moves are made with real mouse clicks.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const Dara = new Function(fs.readFileSync(path.join(__dirname, "dara.js"), "utf8") + "; return Dara;")();
const net = Dara.makeNet(JSON.parse(fs.readFileSync(path.join(__dirname, "dist", "weights.json"), "utf8")));
const [games = 5, sims = 300, shots = null, verbose = null] = process.argv.slice(2);
const DR = [-1, 1, 0, 0], DC = [0, 0, -1, 1];

const choose = (s) => { const search = Dara.makeSearch(net, s); search.step(Number(sims)); return search.result(); };

// Runs inside the page: the game's variables and its 6x5 board array.
const readGame = () => {
  const rt = window.c3_runtimeInterface.g_aCU;
  const v = {};
  for (const x of rt.g_Od["g_O$"].values()) v[x.g_pP] = x.g_KY;
  const arr = rt.g_afS.find((t) => t.g_pP === "BoardState").g_By[0].g_aaG.g_jJ;
  const cells = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) cells.push(arr[c][r][0]);
  const count = (n) => rt.g_afS.find((t) => t.g_pP === n).g_By.length;
  const shown = new Array(30).fill(0);          // what is drawn: one sprite per stone
  ["Player_Team1Piece", "Player_Team2Piece"].forEach((n, k) => {
    for (const i of rt.g_afS.find((t) => t.g_pP === n).g_By) {
      const c = Math.round((i.g_JH.g_hP - 620) / 138), r = Math.round((i.g_JH.g_hQ - 398) / 138);
      if (c >= 0 && c < 6 && r >= 0 && r < 5) shown[r * 6 + c] = k + 1;
    }
  });
  return { cells, shown, state: v.gameState, turn: v.numCurrentTurn, taken: v.hasTurnTaken, hand: [v.p1PiecesRemaining, v.p2PiecesRemaining],
           on: [v.p1NumPiecesOnBoard, v.p2NumPiecesOnBoard], winner: v.isWinner, sprites: [count("Player_Team1Piece"), count("Player_Team2Piece")] };
};

async function click(p, cell) {
  const x = (620 + 138 * (cell % 6)) * 2 / 3, y = (398 + 138 * ((cell / 6) | 0)) * 2 / 3;
  await p.mouse.move(x, y); await p.waitForTimeout(150);
  await p.mouse.down(); await p.waitForTimeout(150); await p.mouse.up();
}
async function press(p, x, y, wait) {
  await p.mouse.move(x, y); await p.waitForTimeout(200);
  await p.mouse.down(); await p.waitForTimeout(150); await p.mouse.up(); await p.waitForTimeout(wait);
}

// Wait until the game's state has stopped changing for `quiet` ms.
async function settle(p, quiet = 1600, limit = 30000) {
  let last = "", since = Date.now(), g;
  const t0 = Date.now();
  for (;;) {
    g = await p.evaluate(readGame);
    const key = JSON.stringify(g);
    if (key !== last) { last = key; since = Date.now(); }
    if (Date.now() - since >= quiet || Date.now() - t0 > limit) return g;
    await p.waitForTimeout(200);
  }
}

async function playGame(browser, n) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p.on("pageerror", () => {});
  await p.route("**/scripts/main.js", async (route) => {      // run as a plain web export instead of NW.js
    const r = await route.fetch();
    await route.fulfill({ response: r, body: (await r.text()).replace('g_aC_:"nwjs"', 'g_aC_:"html5"') });
  });
  await p.goto("http://127.0.0.1:8765/index.html", { timeout: 60000 });
  await p.waitForTimeout(9000);
  // No save file exists here, which would force the tutorial; a save file clears this same flag.
  await p.evaluate(() => { for (const x of window.c3_runtimeInterface.g_aCU.g_Od["g_O$"].values()) if (x.g_pP === "isInTutorial") x.g_KY = 0; });
  await press(p, 640, 472, 1200); await press(p, 640, 472, 2000);   // PLAY (first click only focuses)
  await press(p, 726, 295, 2000);                                   // HUMAN vs AI
  await press(p, 546, 295, 4000);                                   // CLASSIC
  let turns = 0, stuck = 0, lastKey = "", mismatches = 0;
  const log = [];
  for (;;) {
    const g = await settle(p);
    // The drawn stones are the truth: now and then the game leaves a captured stone behind in its
    // board array, where it can no longer be clicked. The array is only used once the game has ended.
    if (!g.winner && g.cells.join("") !== g.shown.join("")) { mismatches++; g.cells = g.shown; }
    const mine = g.cells.filter((v) => v === 1).length, theirs = g.cells.filter((v) => v === 2).length;
    if (verbose) console.log(JSON.stringify(g));
    const s = Dara.newState();
    g.cells.forEach((v, i) => { if (v === 1 || v === 2) s.b[v - 1] |= 1 << i; });
    s.hand = [g.hand[0], g.hand[1]];
    // Daka Dara has no blockade rule (a side without a move passes); the network was trained with
    // "no legal move = loss", so such a game is stopped here and reported as a blockade.
    const b = Dara.clone(s); b.phase = Dara.MOVE; b.turn = 1;
    const blockade = g.hand[0] === 0 && g.hand[1] === 0 && theirs >= 3 && Dara.legalActions(b).length === 0;
    const over = g.winner || blockade || (g.hand[0] === 0 && g.hand[1] === 0 && (mine < 3 || theirs < 3));
    const key = JSON.stringify(g);
    stuck = key === lastKey ? stuck + 1 : 0; lastKey = key;
    if (over || stuck >= 4 || turns > 400) {
      if (shots) await p.screenshot({ path: `${shots}/dakadara_game${n}.png` });
      const f = Dara.clone(s); f.phase = Dara.MOVE; f.turn = 1;
      const botMoves = Dara.legalActions(f).length;
      f.turn = 0;
      const myMoves = Dara.legalActions(f).length;
      await p.close();
      return { mine: g.on[0], theirs: g.on[1], turns, botMoves, myMoves, flag: g.winner, stuck: stuck >= 4, mismatches, board: g.cells.join(""), log };
    }
    s.phase = g.hand[0] > 0 ? Dara.DROP : Dara.MOVE;
    s.ply = Math.min(turns * 2, 150);
    if (!Dara.legalActions(s).length) { await p.waitForTimeout(1500); continue; }
    let { action, value } = choose(s);
    log.push(action);
    if (action < 30) await click(p, action);
    else {
      const x = (action - 30) % 30, d = ((action - 30) / 30) | 0;
      await click(p, x); await p.waitForTimeout(600);
      await click(p, (((x / 6) | 0) + DR[d]) * 6 + (x % 6) + DC[d]);
    }
    Dara.applyAction(s, action);
    if (s.phase === Dara.CAPTURE && s.turn === 0) {              // we made a three: take a stone
      await p.waitForTimeout(1500);
      action = choose(s).action;
      log.push(action);
      await click(p, action - 150);
    }
    turns++;
    await p.waitForTimeout(800);
  }
}

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
  for (let n = 1; n <= Number(games); n++) {
    const r = await playGame(browser, n);
    console.log(JSON.stringify({ game: n, network_stones: r.mine, bot_stones: r.theirs, turns: r.turns, bot_legal_moves: r.botMoves,
                                 network_legal_moves: r.myMoves, win_flag: r.flag, stuck: r.stuck, array_mismatches: r.mismatches, final_board: r.board, actions: r.log.join(" ") }));
  }
  await browser.close();
})();
