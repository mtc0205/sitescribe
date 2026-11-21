/**
 * Per official docs: the model download is triggered by the FIRST *.create()
 * call after a user gesture. This script:
 *  1. opens a page, performs a real click (user activation)
 *  2. calls LanguageModel.create() with a downloadprogress monitor
 *  3. dumps chrome://on-device-internals (the REAL diagnostics URL)
 *  4. polls availability for several minutes
 */
import puppeteer from "puppeteer-core";
import { appendFileSync, writeFileSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";
const TOOLS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";
const LOG = TOOLS + "\\nano-download-progress.txt";

function log(line) {
  const ts = new Date().toISOString().slice(11, 19);
  const text = `[${ts}] ${line}`;
  console.log(text);
  appendFileSync(LOG, text + "\n");
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1400,1100"],
});

// page with a clickable element
const page = await browser.newPage();
await page.goto("https://example.com/", { waitUntil: "load" });
await page.evaluate(() => {
  const b = document.createElement("button");
  b.id = "gesture";
  b.textContent = "warm";
  b.style.cssText = "position:fixed;top:10px;left:10px;z-index:9";
  document.body.appendChild(b);
});
await page.click("#gesture"); // real user activation
log("user gesture performed");

// create() with progress monitor — page console captured
page.on("console", (m) => log(`[page-console] ${m.text().slice(0, 160)}`));
const createResult = await page.evaluate(async () => {
  try {
    const session = await LanguageModel.create({
      initialPrompts: [{ role: "system", content: "You are a terse field assistant." }],
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          console.log(`downloadprogress ${Math.round(e.loaded * 100)}%`);
        });
      },
    });
    const answer = await session.prompt("Reply with exactly: OK");
    return { ok: true, answer: answer.slice(0, 60) };
  } catch (e) {
    return { ok: false, name: e && e.name, message: String(e && e.message || e).slice(0, 400) };
  }
});
log("create() result: " + JSON.stringify(createResult));

// internals page (real URL)
const d = await browser.newPage();
try {
  await d.goto("chrome://on-device-internals", { waitUntil: "load", timeout: 10000 });
  await new Promise((r) => setTimeout(r, 2500));
  const text = await d.evaluate(() => document.body.innerText.replace(/\n{3,}/g, "\n\n"));
  log("on-device-internals captured (" + text.length + " chars)");
  writeFileSync(TOOLS + "\\on-device-internals.txt", text, "utf8");
  console.log("===== chrome://on-device-internals =====\n" + text.slice(0, 3000));
  await d.screenshot({ path: TOOLS + "\\on-device-internals.png" });
} catch (e) {
  log("internals page failed: " + String(e).slice(0, 120));
}

// poll availability for 6 minutes
for (let i = 0; i < 36; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const av = await page.evaluate(async () => {
    if (!("LanguageModel" in self)) return "no-api";
    return LanguageModel.availability().catch(() => "ERR");
  });
  if (av !== "unavailable") log(`t+${(i + 1) * 10}s availability=${av}`);
  if (av === "available" || av === "downloading" || av === "downloadable") {
    log("STATE CHANGED: " + av);
    await page.screenshot({ path: TOOLS + `\\nano-create-${av}.png` });
    break;
  }
  if (i % 6 === 5) log(`t+${(i + 1) * 10}s still ${av}`);
}

await browser.close();
log("nano-create.mjs done");
