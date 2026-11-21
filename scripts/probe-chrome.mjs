/**
 * Chrome on-device AI probe for the Firebase #BuildHybridAI hackathon.
 *
 * Launches the locally installed Chrome with the Prompt API feature enabled,
 * checks `LanguageModel` availability, and (if downloadable) starts the model
 * download to measure real-world viability of the on-device path.
 *
 * Run: node probe-chrome.mjs [--url http://127.0.0.1:5173]
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile";
const url = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "about:blank";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false, // component updater + model download behave best in a real window
  userDataDir: PROFILE,
  args: [
    "--enable-features=PromptAPIMultimodalInput",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--window-size=1280,900",
  ],
});

const page = await browser.newPage();
await page.goto(url === "about:blank" ? "about:blank" : url, { waitUntil: "load", timeout: 30000 });

// Basic API presence + availability probe (no user gesture needed for availability()).
const probe = await page.evaluate(async () => {
  const out = { hasLanguageModel: "LanguageModel" in self, chromeUA: navigator.userAgent };
  if (out.hasLanguageModel) {
    try {
      out.availability = await LanguageModel.availability();
    } catch (e) {
      out.availabilityError = String(e);
    }
  }
  return out;
});
console.log("[probe]", JSON.stringify(probe, null, 2));

if (probe.availability === "downloadable") {
  console.log("[probe] starting model download (no monitor); this may take a while…");
  const dl = await page.evaluate(async () => {
    try {
      const session = await LanguageModel.create({
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            console.log(`downloadprogress ${(e.loaded * 100).toFixed(1)}%`);
          });
        },
      });
      return { ok: true, tokens: session.maxTokens ?? null };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  console.log("[probe] download/create result:", JSON.stringify(dl));
  if (dl.ok) {
    const answer = await page.evaluate(async () => {
      const s = await LanguageModel.create();
      const r = await s.prompt("Reply with exactly: NANO-OK");
      return r;
    });
    console.log("[probe] on-device inference result:", JSON.stringify(answer));
  }
} else if (probe.availability === "available") {
  const answer = await page.evaluate(async () => {
    const s = await LanguageModel.create();
    const r = await s.prompt("Reply with exactly: NANO-OK");
    return r;
  });
  console.log("[probe] on-device inference result:", JSON.stringify(answer));
} else {
  console.log(`[probe] availability=${probe.availability ?? probe.availabilityError ?? "n/a"} — on-device model not usable on this machine/network tonight.`);
}

await page.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\probe-screenshot.png" });
console.log("[probe] screenshot saved.");

// Leave the browser open for 8s so the component updater can log, then close.
await new Promise((r) => setTimeout(r, 8000));
await browser.close();
