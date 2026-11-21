/**
 * Launch Chrome WITHOUT puppeteer's automation-default switches that are known
 * to interfere with built-in AI (–enable-automation) and component downloads
 * (–disable-background-networking), then probe LanguageModel + availability,
 * and if downloadable, kick the real model download.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

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
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1000"],
});

const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));

const probe = await page.evaluate(async () => {
  const out = {
    url: location.href,
    hasLanguageModel: "LanguageModel" in self,
    secureContext: isSecureContext,
  };
  if (out.hasLanguageModel) {
    try { out.availability = await LanguageModel.availability(); } catch (e) { out.availabilityError = String(e); }
  }
  return out;
});
console.log("[no-automation]", JSON.stringify(probe, null, 2));

await page.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\app-first-load.png" });

if (probe.availability === "downloadable") {
  console.log("[no-automation] model downloadable — starting download via user-gesture simulation…");
  // Click the demo app's first project card then capture button = real user gesture.
  const card = await page.$(".card");
  if (card) {
    await card.click();
    await new Promise((r) => setTimeout(r, 1200));
    await page.type("#note", "Longitudinal crack on web of girder G2, about two millimeters wide, three meters long, water seepage with white efflorescence nearby.");
    await page.click("#capture-btn");
    // Watch the engine chip for download progress / result for up to 3 minutes.
    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const state = await page.evaluate(() => ({
        engineChip: document.querySelector("#engine-chip")?.textContent ?? null,
        captureState: document.querySelector("#capture-state")?.textContent ?? null,
        aiBlock: document.querySelector("#capture-result .ai-block")?.textContent?.slice(0, 200) ?? null,
      }));
      console.log(`[t+${(i + 1) * 5}s]`, JSON.stringify(state));
      if (state.aiBlock) break;
    }
    await page.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\app-capture-result.png" });
  }
} else if (probe.availability === "available") {
  console.log("[no-automation] model AVAILABLE — running full capture flow…");
}

await browser.close();
