/**
 * UI screenshot pass for the product-polish review (T4, run #15).
 * Captures every screen at 1280x800 and 390x844 (demo mode, engine=off,
 * honest badges) into ../tools/ui-*.png for critique.
 *
 * Usage: node scripts/ui-screens.mjs  (expects `npm run dev` on 127.0.0.1:5173)
 */
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.resolve(ROOT, "..", "tools");
const URL_BASE = "http://127.0.0.1:5173/?engine=off";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: path.join(process.env.TEMP ?? ROOT, "ss-ui-profile-" + Date.now()),
  args: ["--no-first-run", "--no-default-browser-check"],
});

async function shoot(name, w, h, fn) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.goto(URL_BASE, { waitUntil: "load", timeout: 30_000 });
  await page.waitForSelector("#project-list .card", { timeout: 30_000 });
  await fn(page);
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, `ui-${name}-${w}x${h}.png`), fullPage: false });
  await page.screenshot({ path: path.join(SHOTS, `ui-${name}-${w}x${h}-full.png`), fullPage: true });
  await page.close();
  console.log(`[ui] ${name} @ ${w}x${h}`);
}

for (const [w, h] of [[1280, 800], [390, 844]]) {
  await shoot("home", w, h, async () => { /* hero + projects + engine panel top */ });
  await shoot("session", w, h, async (p) => { await p.click("#project-list .card"); await p.waitForSelector("#note"); });
  await shoot("capture", w, h, async (p) => {
    await p.click("#project-list .card");
    await p.waitForSelector("#note");
    await p.type("#note", "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long, water seepage with white efflorescence nearby.");
    await p.click("#capture-btn");
    await p.waitForSelector("#capture-result .ai-block", { timeout: 60_000 });
  });
  await shoot("report", w, h, async (p) => {
    await p.click("#project-list .card");
    await p.waitForSelector("#note");
    await p.evaluate(() => document.querySelector("#report-btn")?.scrollIntoView());
  });
}

await browser.close();
console.log("[ui] done → " + SHOTS);
