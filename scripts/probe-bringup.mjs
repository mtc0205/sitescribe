/**
 * Full on-device bring-up sequence:
 * 1. launch with flags from Local State (already injected)
 * 2. user-gesture click → LanguageModel.create() with download monitor
 * 3. report download progress; availability transitions
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-component-extensions-with-background-pages", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1000"],
});

const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });

const first = await page.evaluate(async () => ({ availability: await LanguageModel.availability() }));
console.log("[1] availability:", JSON.stringify(first));

// Trigger download via a real user gesture (click our app's card first).
const card = await page.$(".card");
if (card) await card.click();
await new Promise((r) => setTimeout(r, 1000));

console.log("[2] create() to trigger download (first call may fail by design)…");
const create = await page.evaluate(async () => {
  try {
    const session = await LanguageModel.create({
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          console.log("progress", (e.loaded * 100).toFixed(1));
        });
      },
    });
    return { ok: true, maxTokens: session.maxTokens };
  } catch (e) {
    return { ok: false, name: e?.name, message: e?.message };
  }
});
console.log("[2] create:", JSON.stringify(create));

// Poll availability for 10 minutes — download can be GBs.
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const av = await page.evaluate(async () => {
    try { return await LanguageModel.availability(); } catch (e) { return "err:" + String(e).slice(0, 80); }
  });
  console.log(`[t+${(i + 1) * 10}s] availability=${av}`);
  if (av === "available") {
    const answer = await page.evaluate(async () => {
      const s = await LanguageModel.create();
      return await s.prompt("Reply with exactly: NANO-OK");
    });
    console.log("[on-device inference]", JSON.stringify(answer));
    break;
  }
  if (av === "downloadable") {
    console.log("downloadable — issuing create() again…");
    await page.evaluate(async () => {
      try { await LanguageModel.create(); } catch {}
    });
  }
}

await browser.close();
