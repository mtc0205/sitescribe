/** Try en-US locale override — Gemini Nano distribution is known to be locale-gated. */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-component-extensions-with-background-pages", "--disable-sync"],
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--lang=en-US",
    "--window-size=1280,1000",
  ],
});

const p = await browser.newPage();
await p.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
await p.goto("http://127.0.0.1:5173/", { waitUntil: "load" });

for (let i = 0; i < 12; i++) {
  const av = await p.evaluate(async () => {
    try { return await LanguageModel.availability(); } catch (e) { return "err:" + String(e); }
  });
  const locale = await p.evaluate(() => navigator.language);
  console.log(`[t+${i * 10}s] lang=${locale} availability=${av}`);
  if (av === "downloadable" || av === "available" || av === "downloading") break;
  await new Promise((r) => setTimeout(r, 10000));
}

await browser.close();
