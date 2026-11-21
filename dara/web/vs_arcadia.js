// Lets the trained network play the single-player Dara bot at arcadiagames.io in a headless browser.
//   node web/vs_arcadia.js [games=3] [sims=300] [screenshot dir]
// Their board is 5 columns x 6 rows (ours is 6 x 5, so it is transposed) and the human side,
// played here by the network, always moves first.  Each turn the position is read back from
// their page, so the two rule implementations cannot drift apart silently.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const Dara = new Function(fs.readFileSync(path.join(__dirname, "dara.js"), "utf8") + "; return Dara;")();
const net = Dara.makeNet(JSON.parse(fs.readFileSync(path.join(__dirname, "dist", "weights.json"), "utf8")));
const [games = 3, sims = 300, shots = null] = process.argv.slice(2);

const toOurs = (i) => (i % 5) * 6 + ((i / 5) | 0);
const toTheirs = (x) => (x % 6) * 5 + ((x / 6) | 0);
const DR = [-1, 1, 0, 0], DC = [0, 0, -1, 1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function choose(state) {
  const search = Dara.makeSearch(net, state);
  search.step(Number(sims));
  return search.result();
}

async function read(p) {
  return p.evaluate(() => {
    const board = document.querySelector(".dara-board");
    const cells = [...board.children].map((e) => {
      const piece = e.querySelector(".dara-piece");
      return piece ? (piece.classList.contains("dark") ? 1 : 2) : 0;
    });
    let n = board;
    for (let k = 0; k < 6; k++) n = n.parentElement;
    const over = document.querySelector(".dara-gameover.visible");
    return { cells, over: over ? over.innerText.replace(/\s+/g, " ") : null, text: n.innerText.split("HOW TO PLAY")[0].replace(/\s+/g, " ") };
  });
}

async function playGame(p, g) {
  await p.goto("https://arcadiagames.io/free/dara?play=1", { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.click("text=/^PLAY$/i");
  await p.waitForTimeout(1000);
  let actions = 0, lastText = "", quiet = 0, values = [];
  for (;;) {
    const { cells, text, over } = await read(p);
    if (text !== lastText) { quiet = 0; lastText = text; } else quiet++;
    const mine = cells.filter((v) => v === 1).length, theirs = cells.filter((v) => v === 2).length;
    if (over) {
      if (shots) await p.screenshot({ path: `${shots}/arcadia_game${g}.png` });
      const f = Dara.newState();           // can the bot still move, by our rules?
      cells.forEach((v, i) => { if (v) f.b[v - 1] |= 1 << toOurs(i); });
      f.hand = [0, 0]; f.phase = Dara.MOVE; f.turn = 1;
      return { text: over, mine, theirs, actions, values, botMoves: Dara.legalActions(f).length, cells: cells.join("") };
    }
    const capturing = /SELECT PIECE TO CAPTURE/i.test(text);
    if (!capturing && !/YOUR TURN/i.test(text)) {
      if (quiet > 40 || /\b(you win|you lose|victory|defeat|game over|you won|you lost|ai wins)\b/i.test(text)) {
        if (shots) await p.screenshot({ path: `${shots}/arcadia_game${g}.png` });
        return { text, mine, theirs, actions, values };
      }
      await sleep(250);
      continue;
    }
    const left = /You: (\d+) left · AI: (\d+) left/.exec(text);
    const hand = left ? [Number(left[1]), Number(left[2])] : [0, 0];
    const s = Dara.newState();
    cells.forEach((v, i) => { if (v) s.b[v - 1] |= 1 << toOurs(i); });
    s.hand = hand;
    s.phase = hand[0] > 0 ? Dara.DROP : (capturing ? Dara.CAPTURE : Dara.MOVE);
    s.ply = Math.min(actions, 150);
    if (!Dara.legalActions(s).length) return { text: "no legal action by our rules: " + text, mine, theirs, actions, values };
    const { action, value } = choose(s);
    values.push(Number(value.toFixed(2)));
    const board = await p.$$(".dara-cell");
    try {
      if (action < 30) await board[toTheirs(action)].click({ timeout: 2000 });
      else if (action < 150) {
        const x = (action - 30) % 30, d = ((action - 30) / 30) | 0;
        const y = (((x / 6) | 0) + DR[d]) * 6 + (x % 6) + DC[d];
        await board[toTheirs(x)].click({ timeout: 2000 });
        await sleep(250);
        await board[toTheirs(y)].click({ timeout: 2000 });
      } else await board[toTheirs(action - 150)].click({ timeout: 2000 });
    } catch (e) { continue; }   // the game-over panel appeared meanwhile
    actions += 2;
    await sleep(500);
  }
}

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  for (let g = 1; g <= Number(games); g++) {
    const r = await playGame(p, g);
    console.log(JSON.stringify({ game: g, network_stones: r.mine, bot_stones: r.theirs, actions: r.actions, bot_legal_moves: r.botMoves, final_board: r.cells,
                                 end: r.text.slice(0, 260), values: r.values.slice(-6) }));
  }
  await browser.close();
})();
