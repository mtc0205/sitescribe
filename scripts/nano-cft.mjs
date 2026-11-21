/**
 * Chrome for Testing (independent build, fresh profile, no MSI/enterprise
 * residue): inject Prompt API flags into Preferences, force the on-device
 * model feature, then availability probe + create() download trigger.
 */
import puppeteer from "puppeteer-core";
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const CHROME = "C:\\Users\\user\\AppData\\Local\\Temp\\cft\\chrome\\win64-158.0.8127.36\\chrome-win64\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-cft-profile";
const TOOLS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";
const LOG = TOOLS + "\\nano-download-progress.txt";

function log(line) {
  const ts = new Date().toISOString().slice(11, 19);
  const text = `[${ts}] ${line}`;
  console.log(text);
  appendFileSync(LOG, text + "\n");
}

// 1st launch to materialize the profile, close, inject flags, relaunch.
{
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: PROFILE,
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
  ];
  writeFileSync(PREFS, JSON.stringify(prefs));
  log("flags injected into CFT profile preferences");
} catch (e) {
  log("pref injection failed: " + String(e).slice(0, 120));
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano",
    "--window-size=1280,1000",
  ],
});

const page = await browser.newPage();
await page.goto("https://example.com/", { waitUntil: "load" });
await page.evaluate(() => {
  const b = document.createElement("button");
  b.id = "g";
  document.body.appendChild(b);
});
await page.click("#g");

const first = await page.evaluate(async () => {
  if (!("LanguageModel" in self)) return { api: false };
  return { api: true, av: await LanguageModel.availability().catch(() => "ERR") };
});
log("CFT first probe: " + JSON.stringify(first));

if (first.api && first.av === "unavailable") {
  const created = await page.evaluate(async () => {
    try {
      const s = await LanguageModel.create({
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => console.log(`PROGRESS ${Math.round(e.loaded * 100)}%`));
        },
      });
      return { ok: true, sample: (await s.prompt("Say OK")).slice(0, 30) };
    } catch (e) {
      return { ok: false, message: String(e && e.message || e).slice(0, 250) };
    }
  });
  log("CFT create(): " + JSON.stringify(created));
} else if (first.api) {
  // downloadable/available — create with download monitor
  const created = await page.evaluate(async () => {
    try {
      const s = await LanguageModel.create({
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => console.log(`PROGRESS ${Math.round(e.loaded * 100)}%`));
        },
      });
      return { ok: true, sample: (await s.prompt("Say OK")).slice(0, 30) };
    } catch (e) {
      return { ok: false, message: String(e && e.message || e).slice(0, 250) };
    }
  });
  log("CFT create() (non-unavailable path): " + JSON.stringify(created));
}

page.on("console", (m) => {
  if (m.text().includes("PROGRESS")) log("[page] " + m.text());
});

for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const av = await page.evaluate(async () => LanguageModel.availability().catch(() => "ERR"));
  if (i % 3 === 0) log(`t+${(i + 1) * 10}s availability=${av}`);
  if (av === "available") {
    log("CFT: MODEL AVAILABLE");
    await page.screenshot({ path: TOOLS + "\\nano-cft-available.png" });
    break;
  }
  if (i === 89) log("CFT: 15 min exhausted");
}
await browser.close();
log("nano-cft.mjs done");
