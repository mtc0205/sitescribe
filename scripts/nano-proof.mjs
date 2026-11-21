/**
 * One-shot on-device proof: if/when the model becomes available on this
 * machine, this script produces the canonical evidence triple —
 *   1. console transcript (availability → create → real inference output)
 *   2. screenshot with the answer visible
 *   3. append line in tools/nano-onsdevice-proof-console.txt
 *
 * Usage: node scripts/nano-proof.mjs
 * Exits 2 if the model is still unavailable (see tools/nano-onsdevice-STATUS.md
 * for the 2026-11-22 diagnosis and the unblock checklist).
 */
import puppeteer from "puppeteer-core";
import { appendFileSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-proof-profile";
const TOOLS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-features=OptimizationGuideOnDeviceModel",
    "--window-size=1280,900",
  ],
});

const page = await browser.newPage();
await page.goto("https://example.com/", { waitUntil: "load" });
await page.evaluate(() => {
  const b = document.createElement("button");
  b.id = "g";
  b.textContent = "warm";
  b.style.cssText = "position:fixed;top:8px;left:8px;z-index:9";
  document.body.appendChild(b);
});
await page.click("#g"); // user activation (Prompt API requirement)

const probe = await page.evaluate(async () => {
  if (!("LanguageModel" in self)) return { api: false };
  return { api: true, availability: await LanguageModel.availability().catch(() => "ERR") };
});
console.log("[proof] probe:", JSON.stringify(probe));

if (!probe.api || probe.availability === "unavailable") {
  console.log("[proof] MODEL STILL UNAVAILABLE — see tools/nano-onsdevice-STATUS.md");
  await browser.close();
  process.exit(2);
}

// Real inference through the raw Prompt API (on-device by definition).
const result = await page.evaluate(async () => {
  const session = await LanguageModel.create({
    initialPrompts: [{ role: "system", content: "Answer in one short sentence." }],
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => console.log(`PROGRESS ${Math.round(e.loaded * 100)}%`));
    },
  });
  const q = "Name the defect type when white efflorescence and seepage appear together on a concrete girder.";
  const answer = await session.prompt(q);
  return {
    question: q,
    answer: answer.slice(0, 400),
    contextUsage: await session.measureContextUsage().catch(() => null),
    onDeviceByConstruction: true,
  };
});
const line = `${new Date().toISOString()} PROMPT-API on-device inference OK — ${JSON.stringify(result)}`;
console.log("[proof]", line);
appendFileSync(TOOLS + "\\nano-onsdevice-proof-console.txt", line + "\n");

// Render the answer in the page so the screenshot is self-explanatory.
await page.evaluate((r) => {
  const pre = document.createElement("pre");
  pre.style.cssText = "font:13px/1.5 monospace;white-space:pre-wrap;padding:16px;background:#f6f8fa";
  pre.textContent = `SiteScribe on-device proof (raw Chrome Prompt API)\n\nQ: ${r.question}\n\nA: ${r.answer}\n\n(engine: LanguageModel = Chrome built-in, on-device by construction)`;
  document.body.appendChild(pre);
  document.title = "ON-DEVICE PROOF OK";
}, result);
await page.screenshot({ path: TOOLS + `\\nano-onsdevice-proof-${STAMP}.png` });
console.log("[proof] screenshot → tools/nano-onsdevice-proof-" + STAMP + ".png");

await browser.close();
process.exit(0);
