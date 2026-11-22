// Plays the built page in headless Chromium by clicking like a person would, on every terrain.
//   node tests/browser_check.js <path to standalone html> <screenshot dir>
const { chromium } = require("playwright");

(async () => {
  const [page_path, out_dir] = process.argv.slice(2);
  const browser = await chromium.launch();
  const errors = [];
  for (const [name, width, height, scheme, side] of [["desk", 1200, 900, "light", "0"], ["phone", 400, 850, "dark", "1"]]) {
    const p = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1 });
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.addInitScript(() => { window.TB_FAST = true; });
    await p.goto("file://" + page_path);
    await p.selectOption("#level", "2x30");
    await p.selectOption("#side", side);
    for (let ter = 0; ter < 8; ter++) {
      await p.selectOption("#map", String(ter));
      await p.selectOption("#first", ter % 2 ? "model" : "you");
      await p.click("#new-game");
      const phases = new Set();
      let clicks = 0;
      for (; clicks < 400; clicks++) {
        await p.waitForFunction(() => {
          const s = TB_PAGE.state();
          return s.winner >= 0 || (s.turn === TB_PAGE.human() && !/thinking/.test(document.getElementById("status").textContent));
        }, null, { timeout: 120000 });
        const st = await p.evaluate(() => ({ w: TB_PAGE.state().winner, ph: TB_PAGE.state().phase }));
        if (st.w >= 0) break;
        phases.add(st.ph);
        // everything a person could click right now
        let opts = await p.$$(".target, #rack-you .tile.can:not(.sel), #disc-you .tile.can, #draw:not([disabled]), #skip:not([disabled])");
        const targets = await p.$$(".target");
        if (targets.length && Math.random() < 0.8) opts = targets;
        if (!opts.length) { errors.push(`nothing to click on terrain ${ter}: ` + (await p.textContent("#status"))); break; }
        await opts[Math.floor(Math.random() * opts.length)].click();
      }
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      console.log(name, "|", await p.evaluate(() => document.getElementById("map").selectedOptions[0].textContent), "|", await p.textContent("#status"),
                  "| clicks", clicks, "| phases", [...phases].join(""), "| log", (await p.$$("#log li")).length, "| overflow", overflow);
      if (ter === (name === "desk" ? 0 : 1)) await p.screenshot({ path: `${out_dir}/${name}-end.png`, fullPage: true });
    }
    await p.selectOption("#map", name === "desk" ? "4" : "7");
    await p.selectOption("#first", "you");
    await p.click("#new-game");
    await p.click("#rack-you .tile.can");
    await p.screenshot({ path: `${out_dir}/${name}-start.png`, fullPage: true });
    await p.close();
  }
  console.log("errors:", JSON.stringify(errors));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
