/**
 * Combined bring-up: en-US UI locale (Gemini Nano distribution has been
 * locale-gated historically) + forced OptimizationGuideOnDeviceModel feature
 * + check-for-update click + availability polling.
 */
import puppeteer from "puppeteer-core";
import { appendFileSync } from "node:fs";

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
  ignoreDefaultArgs: [
    "--enable-automation",
    "--disable-background-networking",
    "--disable-component-extensions-with-background-pages",
    "--disable-client-side-phishing-detection",
    "--disable-sync",
  ],
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--lang=en-US",
    "--enable-features=OptimizationGuideOnDeviceModel",
    "--window-size=1280,1000",
  ],
});
log("launched: --lang=en-US + OptimizationGuideOnDeviceModel");

// availability probe page
const p = await browser.newPage();
await p.goto("https://example.com/", { waitUntil: "load" }).catch(() => {});
const first = await p.evaluate(async () => {
  const lang = navigator.language;
  if (!("LanguageModel" in self)) return { lang, api: false };
  return { lang, api: true, av: await LanguageModel.availability().catch(() => "ERR") };
});
log("first probe: " + JSON.stringify(first));

// components page: click check-for-update on all optimization-guide rows
const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 3000));
const clicked = await c.evaluate(() => {
  let n = 0;
  const rows = [];
  for (const el of document.querySelectorAll("span, div")) {
    if (el.children.length > 0) continue;
    if (!/optimization guide/i.test(el.textContent || "")) continue;
    let row = el.parentElement;
    while (row && row !== document.body && !row.querySelector("button")) row = row.parentElement;
    if (!row) continue;
    rows.push((row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 150));
    for (const btn of row.querySelectorAll("button")) {
      if (/check for update|检查是否有更新/i.test(btn.textContent || "")) { btn.click(); n++; }
    }
  }
  return { n, rows };
});
log("components (en-US page now): " + JSON.stringify(clicked.rows, null, 1));
log("clicked: " + clicked.n);

// If availability is downloadable, call create() from a user-gesture context
// (we are in one — this evaluate runs from a puppeteer action).
for (let i = 0; i < 50; i++) {
  await new Promise((r) => setTimeout(r, 12000));
  const s = await p.evaluate(async () => {
    if (!("LanguageModel" in self)) return { api: false };
    const av = await LanguageModel.availability().catch(() => "ERR");
    return { api: true, av };
  }).catch(() => ({ api: true, av: "?" }));
  const og = await c.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("span, div")) {
      if (el.children.length > 0) continue;
      if (!/optimization guide/i.test(el.textContent || "")) continue;
      let row = el.parentElement;
      while (row && row !== document.body && !row.querySelector("button")) row = row.parentElement;
      if (row) out.push((row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 150));
    }
    return out;
  }).catch(() => []);
  log(`t+${((i + 1) * 12) / 60}min av=${s.av} og=${JSON.stringify(og)}`);
  if (s.av === "downloadable" || s.av === "downloading") {
    // trigger download via create() — needs user activation; page.evaluate
    // from puppeteer counts as a gesture in practice for this API.
    const trig = await p.evaluate(async () => {
      try {
        const sess = await LanguageModel.create({
          monitor(m) { m.addEventListener("downloadprogress", (e) => console.log("dl", e.loaded)); },
        });
        const res = await sess.prompt("Reply with exactly: OK");
        return { created: true, sample: res.slice(0, 40) };
      } catch (e) {
        return { created: false, error: String(e && e.message || e).slice(0, 200) };
      }
    });
    log("create() attempt: " + JSON.stringify(trig));
    if (trig.created) {
      appendFileSync(TOOLS + "\\nano-onsdevice-proof-console.txt",
        `${new Date().toISOString()} locale=${(await p.evaluate(() => navigator.language))} create()=${JSON.stringify(trig)}\n`);
      await p.screenshot({ path: TOOLS + "\\nano-onsdevice-proof-create.png" });
    }
  }
  if (s.av === "available") {
    log("MODEL AVAILABLE");
    await c.screenshot({ path: TOOLS + "\\nano-en-available.png" });
    break;
  }
  if (i * 12000 > 10 * 60 * 1000) { log("10 min budget exhausted"); break; }
}

await browser.close();
log("nano-en.mjs done");
