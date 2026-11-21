/**
 * Chrome Canary route: canary typically ships built-in AI enabled by default.
 * Fresh profile + labs injection (belt and braces) + create() trigger +
 * long availability polling. Logs to the shared progress file.
 */
import puppeteer from "puppeteer-core";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const CHROME = "C:\\Users\\user\\AppData\\Local\\Temp\\cft\\chrome\\win64-160.0.8175.1\\chrome-win64\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-canary-profile";
const TOOLS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";
const LOG = TOOLS + "\\nano-download-progress.txt";

function log(line) {
  const ts = new Date().toISOString().slice(11, 19);
  const text = `[${ts}] ${line}`;
  console.log(text);
  appendFileSync(LOG, text + "\n");
}

{
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: false, userDataDir: PROFILE,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  await b.close();
}
await new Promise((r) => setTimeout(r, 2000));

const PREFS = PROFILE + "\\Default\\Preferences";
try {
  const prefs = JSON.parse(readFileSync(PREFS, "utf8"));
  prefs.browser = prefs.browser ?? {};
  prefs.browser.enabled_labs_experiments = [
    "prompt-api-for-gemini-nano@2",
    "prompt-api-for-gemini-nano-multimodal-input@2",
    "gemma4-for-built-in-ai@2",
  ];
  writeFileSync(PREFS, JSON.stringify(prefs));
  log("canary: labs injected");
} catch (e) {
  log("canary: pref injection failed " + String(e).slice(0, 80));
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1000"],
});

const page = await browser.newPage();
await page.goto("https://example.com/", { waitUntil: "load" });
await page.evaluate(() => {
  const b = document.createElement("button");
  b.id = "g";
  document.body.appendChild(b);
});
await page.click("#g");
await new Promise((r) => setTimeout(r, 3000)); // give performance-class a moment

const first = await page.evaluate(async () => {
  if (!("LanguageModel" in self)) return { api: false };
  return { api: true, av: await LanguageModel.availability().catch(() => "ERR") };
});
log("canary probe: " + JSON.stringify(first));

page.on("console", (m) => {
  const t = m.text();
  if (/progress|PROGRESS/i.test(t)) log("[page] " + t.slice(0, 140));
});

if (first.api) {
  const created = await page.evaluate(async () => {
    try {
      const s = await LanguageModel.create({
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => console.log(`PROGRESS ${Math.round(e.loaded * 100)}%`));
        },
      });
      const answer = await s.prompt("Reply with exactly: OK");
      return { ok: true, answer: answer.slice(0, 40) };
    } catch (e) {
      return { ok: false, message: String(e && e.message || e).slice(0, 250) };
    }
  });
  log("canary create(): " + JSON.stringify(created));
  if (created.ok) {
    appendFileSync(TOOLS + "\\nano-onsdevice-proof-console.txt",
      `${new Date().toISOString()} CANARY create() OK: ${JSON.stringify(created)}\n`);
    await page.screenshot({ path: TOOLS + "\\nano-onsdevice-proof-create.png" });
  }
}

// internals page performance class (canary URL exists for sure)
try {
  const d = await browser.newPage();
  await d.goto("chrome://on-device-internals", { waitUntil: "load", timeout: 10000 });
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const txt = await d.evaluate(() => {
      const parts = [];
      const walk = (root, depth) => {
        if (!root || depth > 14) return;
        for (const el of root.querySelectorAll("*")) {
          if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
          if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
            const t = el.textContent.trim();
            if (t) parts.push(t);
          }
        }
      };
      walk(document, 0);
      return parts.join(" | ");
    });
    const m = txt.match(/performance class[^|]*\|?[^|]*/i);
    log(`canary internals perf-class: ${m ? m[0].slice(0, 90) : "not-found"}`);
    if (m && !/loading/i.test(m[0])) break;
  }
} catch (e) {
  log("canary internals failed: " + String(e).slice(0, 80));
}

for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const av = await page.evaluate(async () => LanguageModel.availability().catch(() => "ERR"));
  if (i % 3 === 0) log(`t+${(i + 1) * 10}s canary availability=${av}`);
  if (av === "available") {
    log("CANARY: MODEL AVAILABLE");
    await page.screenshot({ path: TOOLS + "\\nano-canary-available.png" });
    break;
  }
  if (i === 119) log("canary: 20 min exhausted");
}
await browser.close();
log("nano-canary.mjs done");
