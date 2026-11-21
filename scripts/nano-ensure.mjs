/**
 * Force the on-device model download with Chromium's test switch
 * --ensure-model-downloaded (starts the model component install at browser
 * startup, no Finch gating), combined with the feature switch that
 * registers the component. Polls availability + component list.
 *
 * Usage: node scripts/nano-ensure.mjs [--proxy]
 */
import puppeteer from "puppeteer-core";
import { appendFileSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";
const TOOLS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";
const LOG = TOOLS + "\\nano-download-progress.txt";
const USE_PROXY = process.argv.includes("--proxy");

const args = [
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1280,1000",
  "--enable-features=OptimizationGuideOnDeviceModel",
  "--ensure-model-downloaded",
];
if (USE_PROXY) args.push("--proxy-server=http://127.0.0.1:7897");

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
  args,
});
log(`launched with --ensure-model-downloaded (proxy=${USE_PROXY})`);

const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
const p = await browser.newPage();
await p.goto("https://example.com/", { waitUntil: "load" }).catch(() => {});

async function snapshot() {
  const rows = await c.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("span, div")) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || "").trim();
      if (/optimization guide/i.test(t)) {
        let row = el.parentElement;
        while (row && row !== document.body && !row.querySelector("button")) row = row.parentElement;
        if (row) out.push((row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220));
      }
    }
    return out;
  }).catch(() => []);
  const av = await p.evaluate(async () => {
    if (!("LanguageModel" in self)) return "no-api";
    try { return await LanguageModel.availability(); } catch { return "ERR"; }
  }).catch(() => "?");
  return { rows, av };
}

let last = "";
for (let i = 0; i < 100; i++) {
  await new Promise((r) => setTimeout(r, 12000));
  try {
    await c.reload({ waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 2000));
  } catch {}
  const s = await snapshot();
  const line = `av=${s.av} | ${JSON.stringify(s.rows)}`;
  if (line !== last) {
    log(line);
    last = line;
    await c.screenshot({ path: TOOLS + "\\nano-ensure-latest.png" });
  }
  if (s.av === "available" || s.av === "downloadable") {
    log(`MODEL ${s.av.toUpperCase()} after ${Math.round((i * 12) / 60)} min`);
    await c.screenshot({ path: TOOLS + `\\nano-ensure-${s.av}.png` });
    break;
  }
  if (i * 12000 > 20 * 60 * 1000) { log("20 min budget exhausted"); break; }
}

log("RESULT: availability=" + (await snapshot()).av);
await browser.close();
