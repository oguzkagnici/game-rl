// Screenshots the learning-curve page: node tests/story_check.js <html> <out dir>
const { chromium } = require("playwright");
(async () => {
  const [file, out] = process.argv.slice(2);
  const b = await chromium.launch();
  const errors = [];
  for (const [name, width, scheme] of [["story_desk", 1100, "light"], ["story_phone", 400, "dark"]]) {
    const p = await b.newPage({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.setContent("<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'></head><body style='margin:0'>" + require("fs").readFileSync(file, "utf8") + "</body></html>");
    await p.waitForTimeout(1200);
    console.log(name, "overflow:", await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    await p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    await p.close();
  }
  console.log("errors:", JSON.stringify(errors));
  await b.close();
})();
