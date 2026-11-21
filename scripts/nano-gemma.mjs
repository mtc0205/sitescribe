/**
 * Chrome 158's built-in AI model is Gemma 4, gated by #gemma4-for-built-in-ai.
 * Enable it (Preferences labs) + OptimizationGuideOnDeviceModel feature +
 * Prompt API flag, then trigger create() and poll availability.
 */
import puppeteer from "puppeteer-core";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-gemma-profile";
const TOOLS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";
const LOG = TOOLS + "\\nano-download-progress.txt";

function log(line) {
  const ts = new Date().toISOString().slice(11, 19);
  const text = `[${ts}] ${line}`;
  console.log(text);
  appendFileSync(LOG, text + "\n");
}

// first launch to create profile
{
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: false, userDataDir: PROFILE,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  await b.close();
}
await new Promise((r) => setTimeout(r, 2000));

const PREFS = PROFILE + "\\Default\\Preferences";
const prefs = JSON.parse(readFileSync(PREFS, "utf8"));
prefs.browser = prefs.browser ?? {};
prefs.browser.enabled_labs_experiments = [
  "prompt-api-for-gemini-nano@2",
  "prompt-api-for-gemini-nano-multimodal-input@2",
  "gemma4-for-built-in-ai@2",
  "built-in-ai-mtp@2",
];
writeFileSync(PREFS, JSON.stringify(prefs));
log("labs injected: prompt-api x2, gemma4-for-built-in-ai, built-in-ai-mtp");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: [
    "--no-first-run", "--no-default-browser-check",
    "--enable-features=OptimizationGuideOnDeviceModel",
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
log("gemma4 probe: " + JSON.stringify(first));

page.on("console", (m) => {
  const t = m.text();
  if (/progress|download|PROGRESS/i.test(t)) log("[page] " + t.slice(0, 140));
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
  log("gemma4 create(): " + JSON.stringify(created));
  if (created.ok) {
    appendFileSync(TOOLS + "\\nano-onsdevice-proof-console.txt",
      `${new Date().toISOString()} gemma4-profile create() OK: ${JSON.stringify(created)}\n`);
    await page.screenshot({ path: TOOLS + "\\nano-onsdevice-proof-create.png" });
  }
}

for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const av = await page.evaluate(async () => LanguageModel.availability().catch(() => "ERR"));
  if (i % 3 === 0) log(`t+${(i + 1) * 10}s availability=${av}`);
  if (av === "available") {
    log("gemma4: MODEL AVAILABLE");
    await page.screenshot({ path: TOOLS + "\\nano-gemma-available.png" });
    break;
  }
  if (i === 89) log("gemma4: 15 min exhausted");
}
await browser.close();
log("nano-gemma.mjs done");
