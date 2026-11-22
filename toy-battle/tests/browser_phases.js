// Puts the page into the rarer pick phases (cemetery, eruption, take back) and clicks through them.
//   node tests/browser_phases.js <path to standalone html>
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch(), p = await browser.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.addInitScript(() => { window.TB_FAST = true; });
    await p.goto("file://" + process.argv[2]);
  const setup = async (map, fn) => {
    await p.selectOption("#map", String(map)); await p.selectOption("#first", "you"); await p.click("#new-game");
    await p.evaluate(fn); await p.evaluate(() => TB_PAGE.render());
  };
  // Cursed Cemetery: a discard tile is clickable and comes back into the rack
  await setup(4, () => { const s = TB_PAGE.state(); s.phase = 6; s.disc[3] = 1; s.src = 2; });
  await p.click("#disc-you .tile.can");
  console.log("cemetery:", await p.evaluate(() => TB_PAGE.state().rack[3] >= 1 && TB_PAGE.state().disc[3] === 0), "|", await p.textContent("#log li:last-child"));
  // Volcanic Jungle: pick an enemy troop next to base 2 (v1), then where it lands
  await setup(3, () => { const s = TB_PAGE.state(); s.h[2] = 1; s.st[2 * 12] = 4; s.h[0] = 1; s.st[0] = 8 | 2; s.phase = 4; s.src = 2; s.nplaced = 1; s.placed[0] = 2; s.qi = 1; });
  await p.click(".target"); const mid = await p.textContent("#status"); await p.click(".target");
  console.log("eruption:", mid, "|", await p.textContent("#log li:last-child"));
  // Castle Field: take one of your own troops back
  await setup(0, () => { const s = TB_PAGE.state(); s.h[4] = 1; s.st[4 * 12] = 5; s.h[12] = 1; s.st[12 * 12] = 6; s.phase = 3; s.src = 4; s.nplaced = 1; s.placed[0] = 4; s.qi = 1; });
  const st = await p.textContent("#status"); await p.click(".target");
  console.log("take back:", st, "|", await p.textContent("#log li:nth-last-child(1)"), "| known shown to model:", await p.evaluate(() => TB_PAGE.state().known[6]));
  console.log("errors:", JSON.stringify(errors));
  await browser.close(); process.exit(errors.length ? 1 : 0);
})();
