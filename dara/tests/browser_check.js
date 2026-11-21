// Plays the built page in headless Chromium at desktop and phone widths.
//   node tests/browser_check.js <path to html> <screenshot dir>
const { chromium } = require("playwright");

(async () => {
  const [page_path, out_dir] = process.argv.slice(2);
  const browser = await chromium.launch();
  const errors = [];
  for (const [name, width, height, scheme] of [["desk", 1200, 900, "light"], ["phone", 400, 850, "dark"]]) {
    const p = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto("file://" + page_path);
    await p.click("#level-quick");
    const over = () => /win|Draw/.test(document.getElementById("status").textContent);
    for (let i = 0; i < 40; i++) {          // click random playable pits
      await p.waitForFunction(() => document.querySelector(".pit.can") || /win|Draw/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
      if (await p.evaluate(over)) break;
      const can = await p.$$(".pit.can");
      await can[Math.floor(Math.random() * can.length)].click();
    }
    await p.waitForTimeout(700);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    console.log(name, "| status:", await p.textContent("#status"), "| log cells:", (await p.$$("#log span")).length, "| overflow:", overflow);
    await p.screenshot({ path: `${out_dir}/${name}.png`, fullPage: true });
    await p.click("#undo");
    await p.waitForTimeout(300);
    await p.click("#first-model");
    await p.click("#new-game");
    await p.waitForFunction(() => document.querySelector(".pit.can"), null, { timeout: 60000 });
    console.log(name, "| new game, model first:", await p.textContent("#status"), "|", await p.textContent("#count-model"));
    await p.close();
  }
  console.log("errors:", JSON.stringify(errors));
  await browser.close();
})();
