/**
 * Try explicit ANGLE backend (d3d11) to route Chrome's GPU benchmark away
 * from any virtual display adapter, then probe availability + create().
 */
import puppeteer from "puppeteer-core";
import { appendFileSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-angle-profile";
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
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-features=OptimizationGuideOnDeviceModel",
    "--use-angle=d3d11",
    "--window-size=1280,1000",
  ],
});
log("launched with --use-angle=d3d11 (fresh profile)");

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
log("first probe: " + JSON.stringify(first));

if (first.av === "unavailable") {
  const created = await page.evaluate(async () => {
    try {
      const s = await LanguageModel.create();
      return { ok: true, sample: (await s.prompt("Say OK")).slice(0, 30) };
    } catch (e) {
      return { ok: false, message: String(e && e.message || e).slice(0, 200) };
    }
  });
  log("create(): " + JSON.stringify(created));
}

for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const av = await page.evaluate(async () => LanguageModel.availability().catch(() => "ERR"));
  if (av !== first.av) log(`t+${(i + 1) * 10}s availability=${av}`);
  if (av !== "unavailable") {
    log("STATE CHANGED: " + av);
    await page.screenshot({ path: TOOLS + `\\nano-angle-${av}.png` });
    break;
  }
  if (i === 11) log("angle route: still unavailable after 2 min");
}
await browser.close();
